// =====================================================
// Moviora – ovládací panel (HTTPS na vlastním portu, výchozí 8443)
// Přihlášení: jméno + heslo (scrypt hash v config.json), zámek po opakovaných chybách,
// relace v HttpOnly cookie, každý požadavek API musí nést hlavičku X-Moviora-Admin.
// =====================================================
import express from 'express';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const hash = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, admin) {
    if (!admin?.salt || !admin?.hash) return false;
    const { hash } = hashPassword(password, admin.salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(admin.hash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
}

function safeEqualText(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
}

// Certifikát pro HTTPS: vlastní (admin-cert.pem/admin-key.pem), jinak se vygeneruje self-signed
function loadCertificate(dir) {
    const certFile = path.join(dir, 'admin-cert.pem');
    const keyFile = path.join(dir, 'admin-key.pem');
    if (!existsSync(certFile) || !existsSync(keyFile)) {
        execFileSync('openssl', [
            'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
            '-subj', '/CN=Moviora admin', '-keyout', keyFile, '-out', certFile
        ], { stdio: 'ignore' });
        console.log('🔐 Vytvořen certifikát pro ovládací panel');
    }
    return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
}

export function startAdmin({ port, settings, saveSettings, serverDir, logBuffer, getStatus, actions }) {
    if (!port) return;

    let tls;
    try {
        tls = loadCertificate(serverDir);
    } catch (e) {
        console.error('Ovládací panel nejde spustit (chybí openssl / certifikát):', e.message);
        return;
    }
    if (!settings.admin) {
        console.warn('⚠️ Ovládací panel nemá nastavený účet – spusť: node tools/set-admin.mjs <jméno>');
    }

    const admin = express();
    admin.disable('x-powered-by');
    admin.use(express.json({ limit: '20kb' }));

    admin.use((req, res, next) => {
        res.set({
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Strict-Transport-Security': 'max-age=31536000',
            'Cache-Control': 'no-store'
        });
        next();
    });

    // ---------- relace a zámek ----------
    const SESSION_TTL = 12 * 60 * 60 * 1000;
    const sessions = new Map();            // token → { user, expires }
    const attempts = new Map();            // ip → { count, lockedUntil }
    let globalFails = [];                  // časy chyb ze všech IP (proti hádání z více adres)

    const cookieOf = (req) => {
        const m = String(req.headers.cookie || '').match(/(?:^|;\s*)mw_admin=([a-f0-9]{64})/);
        return m ? m[1] : null;
    };
    const sessionOf = (req) => {
        const token = cookieOf(req);
        const s = token && sessions.get(token);
        if (!s) return null;
        if (s.expires < Date.now()) { sessions.delete(token); return null; }
        s.expires = Date.now() + SESSION_TTL;
        return { token, ...s };
    };

    function requireAuth(req, res, next) {
        if (req.get('X-Moviora-Admin') !== '1') return res.status(403).json({ error: 'Chybí hlavička.' });
        const s = sessionOf(req);
        if (!s) return res.status(401).json({ error: 'Nejsi přihlášený.' });
        req.session = s;
        next();
    }

    setInterval(() => {
        const now = Date.now();
        for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
        for (const [ip, a] of attempts) if ((a.lockedUntil || 0) < now && a.count === 0) attempts.delete(ip);
        globalFails = globalFails.filter(t => now - t < 15 * 60 * 1000);
    }, 60000).unref();

    // ---------- stránka ----------
    admin.get('/', (req, res) => {
        res.type('html').send(readFileSync(path.join(serverDir, 'admin.html'), 'utf8'));
    });
    admin.get('/logo.png', (req, res) => {
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(path.join(serverDir, 'admin-logo.png'));
    });

    // ---------- přihlášení ----------
    admin.post('/api/login', async (req, res) => {
        if (req.get('X-Moviora-Admin') !== '1') return res.status(403).json({ error: 'Chybí hlavička.' });
        const ip = req.socket.remoteAddress;
        const now = Date.now();
        const a = attempts.get(ip) || { count: 0, lockedUntil: 0 };
        if (a.lockedUntil > now) {
            return res.status(429).json({ error: `Příliš mnoho pokusů. Zkus to za ${Math.ceil((a.lockedUntil - now) / 60000)} min.` });
        }
        if (globalFails.filter(t => now - t < 15 * 60 * 1000).length >= 30) {
            return res.status(429).json({ error: 'Přihlašování je dočasně zablokované. Zkus to za 15 minut.' });
        }
        if (!settings.admin) return res.status(503).json({ error: 'Účet není nastavený (node tools/set-admin.mjs).' });

        const { username = '', password = '' } = req.body || {};
        // Hash se počítá vždy, aby odpověď netrvala jinak dlouho podle jména
        const passOk = verifyPassword(password, settings.admin);
        const userOk = safeEqualText(username, settings.admin.username);
        await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

        if (!passOk || !userOk) {
            a.count++;
            globalFails.push(now);
            if (a.count >= 5) {
                a.lockedUntil = now + 15 * 60 * 1000;
                a.count = 0;
                console.warn(`🔒 Ovládací panel: IP ${ip} zablokována na 15 min po 5 chybných přihlášeních`);
            }
            attempts.set(ip, a);
            return res.status(401).json({ error: 'Špatné jméno nebo heslo.' });
        }
        attempts.delete(ip);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { user: settings.admin.username, expires: now + SESSION_TTL, ip });
        console.log(`🔑 Ovládací panel: přihlášení z ${ip}`);
        res.set('Set-Cookie', `mw_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
        res.json({ ok: true, user: settings.admin.username });
    });

    admin.post('/api/logout', requireAuth, (req, res) => {
        sessions.delete(req.session.token);
        res.set('Set-Cookie', 'mw_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
        res.json({ ok: true });
    });

    // ---------- stav a přepínače ----------
    admin.get('/api/status', requireAuth, (req, res) => {
        res.json({
            user: req.session.user,
            apiEnabled: settings.apiEnabled,
            syncEnabled: settings.syncEnabled,
            ...getStatus()
        });
    });

    admin.post('/api/toggle', requireAuth, (req, res) => {
        const { key, value } = req.body || {};
        if (!['apiEnabled', 'syncEnabled'].includes(key) || typeof value !== 'boolean') {
            return res.status(400).json({ error: 'Neplatné nastavení.' });
        }
        settings[key] = value;
        saveSettings();
        console.log(`⚙️ Ovládací panel: ${key} = ${value}`);
        res.json({ ok: true, [key]: value });
    });

    // ---------- prehraj.to ----------
    admin.get('/api/prehrajto', requireAuth, (req, res) => {
        res.json(actions.getPrehrajto());
    });

    admin.post('/api/prehrajto', requireAuth, async (req, res) => {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!email || !password) return res.status(400).json({ error: 'Vyplň e-mail i heslo.' });
        try {
            res.json({ ok: true, message: await actions.setPrehrajto(email, password) });
        } catch (e) {
            res.status(502).json({ error: 'Údaje uloženy, ale přihlášení selhalo: ' + e.message });
        }
    });

    // ---------- akce ----------
    admin.post('/api/action', requireAuth, async (req, res) => {
        const name = req.body?.name;
        try {
            if (name === 'restart') {
                console.log('♻️ Ovládací panel: restart procesu');
                res.json({ ok: true, message: 'Server se restartuje…' });
                setTimeout(() => process.exit(0), 500); // pm2 ho znovu spustí
                return;
            }
            const fn = { refreshDiscover: actions.refreshDiscover, clearCaches: actions.clearCaches, relogin: actions.relogin }[name];
            if (!fn) return res.status(400).json({ error: 'Neznámá akce.' });
            res.json({ ok: true, message: await fn() });
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    admin.get('/api/logs', requireAuth, (req, res) => {
        const since = Number(req.query.since) || 0;
        res.json({ lines: logBuffer.filter(l => l.t > since) });
    });

    // ---------- účet správce ----------
    admin.post('/api/account', requireAuth, (req, res) => {
        const { currentPassword = '', username = '', newPassword = '' } = req.body || {};
        if (!verifyPassword(currentPassword, settings.admin)) return res.status(401).json({ error: 'Současné heslo nesedí.' });
        const user = String(username).trim() || settings.admin.username;
        if (!/^[\w.@-]{3,40}$/.test(user)) return res.status(400).json({ error: 'Jméno: 3–40 znaků (písmena, číslice, . _ - @).' });
        if (newPassword && String(newPassword).length < 8) return res.status(400).json({ error: 'Nové heslo musí mít aspoň 8 znaků.' });
        settings.admin = newPassword ? { username: user, ...hashPassword(newPassword) } : { ...settings.admin, username: user };
        saveSettings();
        // Ostatní relace odhlásit
        for (const t of sessions.keys()) if (t !== req.session.token) sessions.delete(t);
        sessions.get(req.session.token).user = user;
        console.log('👤 Ovládací panel: účet správce změněn');
        res.json({ ok: true, user });
    });

    admin.use((req, res) => res.status(404).json({ error: 'Nenalezeno.' }));

    https.createServer(tls, admin).listen(port, () => {
        console.log(`🛠️ Ovládací panel běží na https://<ip>:${port}`);
    }).on('error', (e) => console.error('Ovládací panel:', e.message));
}
