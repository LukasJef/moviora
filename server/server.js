// =====================================================
// Moviora – API server
// Proměnné prostředí: PORT, PREHRAJTO_EMAIL, PREHRAJTO_PASSWORD
// =====================================================
import express from 'express';
import cors from 'cors';
import { csfd } from 'node-csfd-api';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// Povolíme CORS pro přístup z frontendu
app.use(cors());
app.use(express.json());
app.set('trust proxy', true); // za Cloudflare – skutečná IP klienta z hlaviček

// ==========================================
// Omezení počtu požadavků na IP (ochrana VPS a účtu)
// ==========================================
const RATE_WINDOW = 60 * 1000;
const RATE_LIMIT = 120; // požadavků za minutu z jedné IP
const rateHits = new Map();

app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    const now = Date.now();
    const entry = rateHits.get(ip);
    if (!entry || now - entry.start > RATE_WINDOW) {
        rateHits.set(ip, { start: now, count: 1 });
        return next();
    }
    if (++entry.count > RATE_LIMIT) {
        res.set('Retry-After', String(Math.ceil((entry.start + RATE_WINDOW - now) / 1000)));
        return res.status(429).json({ error: 'Příliš mnoho požadavků, zkus to za chvíli.' });
    }
    next();
});

setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of rateHits) if (now - e.start > RATE_WINDOW) rateHits.delete(ip);
}, RATE_WINDOW).unref();

// ==========================================
// Stav serveru – frontend podle něj pozná, že je API online
// ==========================================
app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// ==========================================
// ČSFD – keš + omezení souběžných dotazů
// (ČSFD odmítá velké množství dotazů naráz, proto chyběly plakáty)
// ==========================================
const CSFD_TTL = 24 * 60 * 60 * 1000;
const CSFD_MAX_CACHE = 2000;
const CSFD_CONCURRENCY = 3;
const csfdCache = new Map();
const csfdInflight = new Map();
let csfdActive = 0;
const csfdQueue = [];

function csfdSlot() {
    if (csfdActive < CSFD_CONCURRENCY) { csfdActive++; return Promise.resolve(); }
    return new Promise(resolve => csfdQueue.push(resolve));
}
function csfdRelease() {
    const next = csfdQueue.shift();
    if (next) next(); else csfdActive--;
}

async function csfdMovieCached(id) {
    const hit = csfdCache.get(id);
    if (hit && Date.now() - hit.t < CSFD_TTL) return hit.movie;
    if (csfdInflight.has(id)) return csfdInflight.get(id);

    const job = (async () => {
        await csfdSlot();
        try {
            let lastErr;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const movie = await csfd.movie(id);
                    if (csfdCache.size >= CSFD_MAX_CACHE) csfdCache.delete(csfdCache.keys().next().value);
                    csfdCache.set(id, { t: Date.now(), movie });
                    return movie;
                } catch (e) {
                    lastErr = e;
                    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
                }
            }
            throw lastErr;
        } finally {
            csfdRelease();
            csfdInflight.delete(id);
        }
    })();
    csfdInflight.set(id, job);
    return job;
}

// ==========================================
// PŘEHRAJ.TO – přihlášená session přímo z VPS
// ==========================================
// Anonymní požadavky z datacenter dostávají prázdný výpis,
// přihlášený účet projde. Údaje se berou z proměnných prostředí.
const PJ_EMAIL = process.env.PREHRAJTO_EMAIL;
const PJ_PASSWORD = process.env.PREHRAJTO_PASSWORD;
const PJ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (!PJ_EMAIL || !PJ_PASSWORD) {
    console.warn('⚠️  Chybí PREHRAJTO_EMAIL / PREHRAJTO_PASSWORD – vyhledávání streamů nebude fungovat.');
}

// Jednoduchý cookie jar pro prehraj.to
const pjCookies = new Map();

function storeCookies(res) {
    for (const c of res.headers['set-cookie'] || []) {
        const pair = c.split(';')[0];
        const i = pair.indexOf('=');
        if (i < 1) continue;
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (!value || /max-age=0/i.test(c)) pjCookies.delete(name);
        else pjCookies.set(name, value);
    }
}

const cookieHeader = () => [...pjCookies].map(([k, v]) => `${k}=${v}`).join('; ');

let loginPromise = null;

function pjLogin() {
    // Souběžné požadavky počkají na jedno společné přihlášení
    if (loginPromise) return loginPromise;

    loginPromise = (async () => {
        if (!PJ_EMAIL || !PJ_PASSWORD) {
            throw new Error('Chybí přihlašovací údaje k prehraj.to (PREHRAJTO_EMAIL / PREHRAJTO_PASSWORD)');
        }

        pjCookies.clear();

        // Nette chrání formuláře cookie _nss (SameSite) – nejdřív ji získáme
        const pre = await axios.get('https://prehraj.to/', {
            headers: { 'User-Agent': PJ_UA },
            responseType: 'text',
            timeout: 15000
        });
        storeCookies(pre);

        const body = new URLSearchParams({
            email: PJ_EMAIL,
            password: PJ_PASSWORD,
            remember_login: 'on',
            login: 'Přihlásit se',
            _do: 'loginDialog-login-loginForm-submit'
        });

        const res = await axios.post('https://prehraj.to/?frm=loginDialog-login-loginForm', body.toString(), {
            headers: {
                'User-Agent': PJ_UA,
                'Referer': 'https://prehraj.to/',
                'Origin': 'https://prehraj.to',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader()
            },
            maxRedirects: 0,               // cookies chceme zachytit z přesměrování
            validateStatus: s => s < 400,
            responseType: 'text',
            timeout: 15000
        });

        storeCookies(res);

        if (!pjCookies.has('access_token')) {
            console.error('Přihlášení selhalo – status:', res.status, 'set-cookie:', res.headers['set-cookie']);
            throw new Error('Přihlášení na prehraj.to selhalo');
        }

        console.log('✅ Přihlášeno na prehraj.to');
    })().finally(() => {
        loginPromise = null;
    });

    return loginPromise;
}

async function pjGet(url, retry = true) {
    if (!pjCookies.has('access_token')) await pjLogin();

    const res = await axios.get(url, {
        headers: {
            'User-Agent': PJ_UA,
            'Referer': 'https://prehraj.to/',
            'Cookie': cookieHeader()
        },
        timeout: 15000,
        responseType: 'text'
    });

    storeCookies(res); // server průběžně posílá obnovený access_token

    const html = String(res.data || '');

    // Přihlášená stránka obsahuje odkaz na odhlášení – když chybí, session vypršela
    if (retry && !html.includes('odhlasit-se')) {
        console.log('↻ Session na prehraj.to vypršela, přihlašuji znovu…');
        await pjLogin();
        return pjGet(url, false);
    }

    return html;
}

// Paměťová keš pro výsledky vyhledávání streamů (10 minut TTL)
const streamsCache = new Map();
const STREAMS_TTL = 10 * 60 * 1000;

// ==========================================
// 1. ENDPOINT: /search
// ==========================================
app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: "Chybí parametr 'q'" });

    const CZDB_API = `https://api.czdb.cz/search?q=${encodeURIComponent(query)}`;
    const IMDB_API = `https://imdb.iamidiotareyoutoo.com/search?q=${encodeURIComponent(query)}`;

    try {
        const [csfdRes, czdbRes, imdbRes] = await Promise.allSettled([
            csfd.search(query).catch(() => null),
            fetch(CZDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => null),
            fetch(IMDB_API, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => null)
        ]);

        const csfdItems = (csfdRes.status === 'fulfilled' && csfdRes.value?.movies) ? csfdRes.value.movies : [];
        const czdbItems = (czdbRes.status === 'fulfilled' && czdbRes.value?.results) ? czdbRes.value.results : [];
        const imdbResults = (imdbRes.status === 'fulfilled' && imdbRes.value?.description) ? imdbRes.value.description : [];

        const finalResults = [];
        const seenKeys = new Set();
        const normalizeStr = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // KROK 1: ČSFD výsledky
        csfdItems.forEach(csfdMovie => {
            const title = csfdMovie.title || csfdMovie.titleCz;
            const key = `${normalizeStr(title)}_${csfdMovie.year || ''}`;
            seenKeys.add(key);

            const matchedImdb = imdbResults.find(im => {
                const imTitle = normalizeStr(im["#TITLE"]);
                const imAka = normalizeStr(im["#AKA"]);
                const tNorm = normalizeStr(title);
                return imTitle === tNorm || imAka === tNorm;
            });

            if (matchedImdb) matchedImdb.wasMatched = true;

            const matchedCzdb = czdbItems.find(cz => normalizeStr(cz.nazev) === normalizeStr(title));
            if (matchedCzdb) matchedCzdb.wasMatched = true;

            finalResults.push({
                id: String(csfdMovie.id || Math.random()),
                title: title,
                originalTitle: csfdMovie.titleOriginal || (matchedImdb ? matchedImdb["#TITLE"] : ''),
                year: csfdMovie.year || '---',
                poster: csfdMovie.poster || (matchedImdb ? matchedImdb["#IMG_POSTER"] : ''),
                actors: matchedImdb ? matchedImdb["#ACTORS"] : '',
                source: 'csfd',
                imdbLink: matchedImdb ? (matchedImdb["#IMDB_URL"] || `https://www.imdb.com/title/${matchedImdb["#IMDB_ID"]}`) : null,
                csfdLink: csfdMovie.url || (csfdMovie.id ? `https://www.csfd.cz/film/${csfdMovie.id}` : null),
                csfd_url: csfdMovie.url || (csfdMovie.id ? `https://www.csfd.cz/film/${csfdMovie.id}` : null)
            });
        });

        // KROK 2: CZDB výsledky
        czdbItems.forEach(czItem => {
            if (czItem.wasMatched) return;

            const czTitle = normalizeStr(czItem.nazev);
            const czYear = parseInt(czItem.rok) || 0;
            const key = `${czTitle}_${czYear}`;

            if (seenKeys.has(key)) return;
            seenKeys.add(key);

            let bestMatch = null;
            let highestScore = 0;

            imdbResults.forEach(imItem => {
                if (imItem.wasMatched) return;
                const imTitle = normalizeStr(imItem["#TITLE"]);
                const imYear = parseInt(imItem["#YEAR"]) || 0;

                let score = 0;
                if (czTitle === imTitle) score += 10;
                if (czYear > 0 && czYear === imYear) score += 5;

                if (score > highestScore) {
                    highestScore = score;
                    bestMatch = imItem;
                }
            });

            if (bestMatch && highestScore >= 5) {
                bestMatch.wasMatched = true;
            }

            finalResults.push({
                id: String(czItem.csfd_id || czItem.id || Math.random()),
                title: czItem.nazev,
                originalTitle: czItem.original || (bestMatch ? bestMatch["#TITLE"] : ''),
                year: czItem.rok || (bestMatch ? bestMatch["#YEAR"] : '---'),
                poster: (bestMatch && bestMatch["#IMG_POSTER"]) ? bestMatch["#IMG_POSTER"] : '',
                actors: bestMatch ? bestMatch["#ACTORS"] : '',
                source: 'czdb',
                imdbLink: bestMatch ? (bestMatch["#IMDB_URL"] || `https://www.imdb.com/title/${bestMatch["#IMDB_ID"]}`) : null,
                csfdLink: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`,
                csfd_url: czItem.csfd_url || `https://www.csfd.cz/film/${czItem.csfd_id}`
            });
        });

        // KROK 3: IMDb výsledky
        imdbResults.forEach(imItem => {
            if (imItem.wasMatched) return;

            const imTitle = normalizeStr(imItem["#TITLE"]);
            const key = `${imTitle}_${imItem["#YEAR"] || ''}`;

            if (seenKeys.has(key)) return;
            seenKeys.add(key);

            finalResults.push({
                id: imItem["#IMDB_ID"] || String(Math.random()),
                title: imItem["#TITLE"] || imItem["#AKA"] || "Neznámý název",
                originalTitle: imItem["#TITLE"] || '',
                year: imItem["#YEAR"] || '---',
                poster: imItem["#IMG_POSTER"] || '',
                actors: imItem["#ACTORS"] || '',
                source: 'imdb',
                imdbLink: imItem["#IMDB_URL"] || `https://www.imdb.com/title/${imItem["#IMDB_ID"]}`,
                csfdLink: null,
                csfd_url: null
            });
        });

        res.json({ results: finalResults.slice(0, 20) });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. ENDPOINT: /csfd-scrape
// ==========================================
app.get('/csfd-scrape', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Chybí parametr 'url'" });

    try {
        const idMatch = url.match(/\/film\/(\d+)/);
        if (!idMatch) throw new Error("Z adresy se nepodařilo získat ID filmu.");

        const movieId = parseInt(idMatch[1], 10);
        const movie = await csfdMovieCached(movieId);

        if (!movie) throw new Error("Film nebyl na ČSFD nalezen.");

        const description = (movie.descriptions && movie.descriptions.length > 0)
            ? movie.descriptions[0]
            : (movie.plot || "Popis není k dispozici.");

        const typeLower = String(movie.type || '').toLowerCase();
        const descLower = String(description).toLowerCase();

        const isSeries =
            typeLower.includes('series') ||
            typeLower.includes('tv') ||
            typeLower.includes('show') ||
            typeLower.includes('season') ||
            typeLower.includes('episode') ||
            (movie.genres && movie.genres.some(g => g.toLowerCase().includes('seriál'))) ||
            descLower.includes('sezón') ||
            descLower.includes('seriál');

        res.set('Cache-Control', 'public, max-age=3600');
        res.json({
            poster: movie.poster || null,
            description: description,
            cast: movie.creators?.actors
                ? movie.creators.actors.slice(0, 12).map(actor => actor.name).join(', ')
                : "",
            genres: movie.genres ? movie.genres.join(', ') : "Neznámý žánr",
            rating: movie.rating || null,
            duration: movie.duration || null, // délka v minutách – frontend podle ní řadí streamy
            isSeries: Boolean(isSeries)
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. ENDPOINT: /get-streams
// ==========================================
app.get('/get-streams', async (req, res) => {
    const title = req.query.title;
    if (!title) return res.status(400).json({ error: "Chybí parametr 'title'" });

    const cacheKey = title.toLowerCase().trim();

    // Kontrola keše (pouze pokud v keši leží reálné výsledky)
    const cached = streamsCache.get(cacheKey);
    if (cached && cached.data.length > 0 && (Date.now() - cached.timestamp < STREAMS_TTL)) {
        return res.json({ streams: cached.data });
    }

    const targetUrl = `https://prehraj.to/hledej/${encodeURIComponent(title)}`;

    try {
        const html = await pjGet(targetUrl);

        const streams = [];
        const seenLinks = new Set();

        // Stejně jako originální get-streams.js: celý blok <a class="video--link">…</a>,
        // uvnitř jsou název (h3), velikost i délka
        const videoBlockRegex = /<a[^>]+class="[^"]*video--link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        const titleRegex = /<h3[^>]+class="[^"]*video__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i;
        const sizeRegex = /<div[^>]+class="[^"]*video__tag--size[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
        const durationRegex = /<div[^>]+class="[^"]*video__tag--time[^"]*"[^>]*>([\s\S]*?)<\/div>/i;

        let match;
        while ((match = videoBlockRegex.exec(html)) !== null) {
            const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
            const innerHtml = match[1];

            const hrefMatch = openTag.match(/href="([^"]+)"/i);
            if (!hrefMatch) continue;
            const link = hrefMatch[1];
            if (seenLinks.has(link)) continue;

            const titleMatch = innerHtml.match(titleRegex);
            const titleAttrMatch = openTag.match(/title="([^"]+)"/i);
            const rawTitle = (titleMatch ? titleMatch[1] : (titleAttrMatch ? titleAttrMatch[1] : ''))
                .replace(/<[^>]*>/g, '')
                .trim();
            if (!rawTitle) continue;

            seenLinks.add(link);

            const sizeMatch = innerHtml.match(sizeRegex);
            const durationMatch = innerHtml.match(durationRegex);
            const size = sizeMatch ? sizeMatch[1].replace(/<[^>]*>/g, '').trim() : 'Neznámá velikost';
            const duration = durationMatch ? durationMatch[1].replace(/<[^>]*>/g, '').trim() : '';

            // Detekce rozlišení
            let label = "Standardní kvalita";
            if (/1080p/i.test(rawTitle)) label = "HD rozlišení (1080p)";
            else if (/720p/i.test(rawTitle)) label = "SD rozlišení (720p)";
            else if (/2160p|4k/i.test(rawTitle)) label = "UltraHD rozlišení (4K)";

            // Detekce jazyka pomocí slovních hranic (\b)
            const isCz = /\b(cz|czdab|czdabing|dabing|cesky|česky)\b/i.test(rawTitle);
            const isEn = /\b(en|eng|english)\b/i.test(rawTitle);
            const isSub = /\b(tit|titulky|sub|subs)\b/i.test(rawTitle);

            let langTag = "";
            if (isCz) langTag = "[CZ Dabing]";
            else if (isEn) langTag = "[EN Znění]";
            else if (isSub) langTag = "[Titulky]";

            if (langTag) label += ` ${langTag}`;

            streams.push({
                link: link,
                title: rawTitle, // originální název souboru z Přehraj.to pro frontend
                name: `${label} — ${size} (${duration})`,
                size: size,
                duration: duration
            });
        }

        // Kešujeme pouze tehdy, pokud jsme nalezli alespoň jeden stream
        if (streams.length > 0) {
            streamsCache.set(cacheKey, { timestamp: Date.now(), data: streams });
        }

        res.json({ streams });

    } catch (err) {
        console.error("Chyba při stahování z Přehraj.to:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. ENDPOINT: /get-video
// ==========================================
app.get('/get-video', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: "Chybí parametr 'url'" });

    const targetUrl = videoUrl.startsWith('http') ? videoUrl : `https://prehraj.to${videoUrl}`;

    // Jen prehraj.to – endpoint nesmí sloužit jako otevřená proxy
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return res.status(400).json({ error: "Neplatná URL" });
    }
    if (parsed.hostname !== 'prehraj.to') {
        return res.status(400).json({ error: "Povolené jsou jen odkazy na prehraj.to" });
    }

    try {
        const html = await pjGet(parsed.toString());

        const sourcesRegex = /var\s+sources\s*=\s*(\[[^\]]+\])/;
        const sourcesMatch = html.match(sourcesRegex);

        const tracksRegex = /var\s+tracks\s*=\s*(\[[^\]]+\])/;
        const tracksMatch = html.match(tracksRegex);

        if (!sourcesMatch) {
            return res.status(404).json({ error: "Nepodařilo se najít zdroj videa. Je video dostupné?" });
        }

        const cleanJsonString = (rawJsArray) => {
            return rawJsArray
                .replace(/'/g, '"')
                .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
        };

        let sources = [];
        let tracks = [];

        try {
            sources = JSON.parse(cleanJsonString(sourcesMatch[1]));
        } catch (e) {
            return res.status(500).json({ error: "Chyba při zpracování video zdrojů", debug: sourcesMatch[1] });
        }

        if (tracksMatch) {
            try {
                tracks = JSON.parse(cleanJsonString(tracksMatch[1]));
            } catch (e) {
                // Ignorujeme chybu titulků
            }
        }

        res.set('Cache-Control', 'no-cache');
        res.json({ sources, tracks });

    } catch (err) {
        console.error("Chyba při načítání videa z Přehraj.to:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Spuštění serveru
app.listen(PORT, () => {
    console.log(`🎬 API Backend běží na portu ${PORT}`);
});
