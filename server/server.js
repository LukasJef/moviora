// =====================================================
// Moviora – API server
// Proměnné prostředí: PORT, PREHRAJTO_EMAIL, PREHRAJTO_PASSWORD
// =====================================================
import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
            typeLower === 'series' ||
            typeLower.includes('series') ||
            typeLower.includes('tv') ||
            typeLower.includes('show') ||
            typeLower.includes('season') ||
            typeLower.includes('episode') ||
            (movie.genres && movie.genres.some(g => g.toLowerCase().includes('seriál'))) ||
            descLower.includes('sezón') ||
            descLower.includes('seriál');

        // Detail (details=1): navíc odkaz na IMDb a řady seriálu
        const wantDetails = req.query.details === '1';
        const [imdbUrl, seasons] = wantDetails
            ? await Promise.all([resolveImdb(movie, isSeries).catch(() => null), Promise.resolve(isSeries ? mapSeasons(movie) : null)])
            : [undefined, undefined];

        res.set('Cache-Control', 'public, max-age=3600');
        res.json({
            ...(wantDetails ? { imdbUrl, seasons } : {}),
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
// IMDb odkaz k filmu z ČSFD
// 1) Wikidata (ČSFD ID → IMDb ID), 2) záloha: našeptávač IMDb podle názvu a roku
// ==========================================
const IMDB_TTL = 7 * 24 * 60 * 60 * 1000;
const imdbCache = new Map();
const EN_COUNTRIES = ['USA', 'Velká Británie', 'Kanada', 'Austrálie', 'Irsko', 'Nový Zéland'];

async function fetchJson(url, headers = {}, timeout = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
        const r = await fetch(url, { headers, signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    } finally {
        clearTimeout(timer);
    }
}

async function imdbFromWikidata(csfdId) {
    const q = `SELECT ?imdb WHERE { ?item wdt:P2529 "${Number(csfdId)}"; wdt:P345 ?imdb. } LIMIT 1`;
    const j = await fetchJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
        'User-Agent': 'Moviora/1.0 (https://moviora.win)',
        Accept: 'application/sparql-results+json'
    });
    const id = j?.results?.bindings?.[0]?.imdb?.value;
    return /^tt\d+$/.test(id || '') ? id : null;
}

const normTitle = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

async function imdbFromSuggest(titles, year, isSeries) {
    for (const title of titles) {
        if (!title) continue;
        const d = await fetchJson(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(title)}.json`, { 'User-Agent': 'Mozilla/5.0' });
        const want = normTitle(title);
        const hit = (d.d || []).find(x =>
            /^tt\d+$/.test(x.id || '') &&
            normTitle(x.l) === want &&
            (!year || !x.y || Math.abs(x.y - year) <= 1) &&
            (isSeries ? /series/i.test(x.qid || '') : !/series|episode/i.test(x.qid || ''))
        );
        if (hit) return hit.id;
    }
    return null;
}

async function resolveImdb(movie, isSeries) {
    const key = movie.id;
    const hit = imdbCache.get(key);
    if (hit && Date.now() - hit.t < IMDB_TTL) return hit.url;

    let id = null;
    try { id = await imdbFromWikidata(movie.id); } catch { /* Wikidata nedostupná */ }
    if (!id) {
        const other = Array.isArray(movie.titlesOther) ? movie.titlesOther : [];
        const english = other.filter(o => EN_COUNTRIES.includes(o.country)).map(o => o.title);
        const rest = other.filter(o => !EN_COUNTRIES.includes(o.country) && o.country !== 'Slovensko').map(o => o.title);
        const titles = [...new Set([...english, ...rest, movie.title])].slice(0, 3);
        try { id = await imdbFromSuggest(titles, parseInt(movie.year, 10) || null, isSeries); } catch { /* IMDb nedostupné */ }
    }
    const url = id ? `https://www.imdb.com/title/${id}/` : null;
    if (imdbCache.size > 5000) imdbCache.delete(imdbCache.keys().next().value);
    imdbCache.set(key, { t: Date.now(), url });
    return url;
}

// Řady a díly seriálu z ČSFD
const numFrom = (text, fallback) => {
    const m = String(text || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : fallback;
};

function mapEpisodes(list) {
    return (list || []).map((e, i) => {
        const code = String(e.info || '').match(/S(\d+)E(\d+)/i);
        return { id: e.id, number: code ? parseInt(code[2], 10) : i + 1, title: e.title || '' };
    });
}

function mapSeasons(movie) {
    if (Array.isArray(movie.seasons) && movie.seasons.length) {
        return movie.seasons.map((s, i) => ({
            id: s.id,
            number: numFrom(s.title, i + 1),
            title: s.title || '',
            year: numFrom(s.info, null)
        }));
    }
    // Seriál bez řad (minisérie) – díly přímo pod seriálem
    if (Array.isArray(movie.episodes) && movie.episodes.length) {
        return [{ id: movie.id, number: 1, title: '', year: parseInt(movie.year, 10) || null, episodes: mapEpisodes(movie.episodes) }];
    }
    return null;
}

// ==========================================
// ENDPOINT: /csfd-episodes – díly jedné řady (id řady z /csfd-scrape)
// ==========================================
app.get('/csfd-episodes', async (req, res) => {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: "Chybí parametr 'id'" });
    try {
        const season = await csfdMovieCached(id);
        res.set('Cache-Control', 'public, max-age=21600');
        res.json({ episodes: mapEpisodes(season?.episodes) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// NABÍDKA NA HLAVNÍ STRÁNCE (z ČSFD)
// Nejnavštěvovanější filmy a seriály, žebříčky a žánry.
// Stahuje se jednou za 24 h, ukládá se na disk a mezitím se servíruje uložená verze.
// ==========================================
const CSFD_BASE = 'https://www.csfd.cz';
const CSFD_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'cs-CZ,cs;q=0.9',
    Accept: 'text/html,application/xhtml+xml'
};
const DISCOVER_TTL = 24 * 60 * 60 * 1000;
const DISCOVER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'discover-cache.json');

// Žánry, které dávají smysl jako řada na hlavní stránce (id podle ČSFD)
const GENRE_WHITELIST = ['Akční', 'Animovaný', 'Dobrodružný', 'Dokumentární', 'Drama', 'Fantasy', 'Historický', 'Horor',
    'Katastrofický', 'Komedie', 'Krimi', 'Muzikál', 'Mysteriózní', 'Pohádka', 'Psychologický', 'Rodinný', 'Romantický',
    'Sci-Fi', 'Sportovní', 'Thriller', 'Válečný', 'Western', 'Životopisný'];

async function csfdHtml(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(url, { headers: CSFD_HEADERS, signal: ctrl.signal });
        if (!r.ok) throw new Error(`ČSFD ${r.status}`);
        return await r.text();
    } finally {
        clearTimeout(timer);
    }
}

const decodeEntities = (s) => String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// Plakát v lepším rozlišení (ČSFD nabízí i větší varianty stejného obrázku)
function bigPoster(src) {
    if (!src) return '';
    let url = src.startsWith('//') ? 'https:' + src : src;
    return url.replace(/\/cache\/resized\/[^/]+\//, '/cache/resized/w360h510/');
}

// Z kusu HTML vytáhne karty filmů (funguje pro hlavní stránku i žebříčky)
function parseFilmArticles(html, { isSeries = false, excludeShorts = true, excludeDocs = false } = {}) {
    const out = [];
    const seen = new Set();
    for (const chunk of html.split(/<article\b/).slice(1)) {
        const link = chunk.match(/href="(\/film\/(\d+)-[^"/]+\/(?:[^"]*?)?)"/);
        if (!link) continue;
        const id = parseInt(link[2], 10);
        if (seen.has(id)) continue;

        const titleM = chunk.match(/class="film-title-name"[^>]*>\s*([^<]+?)\s*</);
        if (!titleM) continue;
        const yearM = chunk.match(/film-title-info[\s\S]*?(\d{4})/);
        const imgM = chunk.match(/<img[^>]+src="([^"]+)"/);
        const originM = chunk.match(/class="info-country">([^<]+)</);
        const genresM = chunk.match(/film-origins-genres[\s\S]*?<span class="bullet"><\/span>([^<]+)</);
        const ratingM = chunk.match(/rating-average[^>]*>\s*([\d,]+)\s*%/);
        const genres = genresM ? decodeEntities(genresM[1]).split(',').map(g => g.trim()).filter(Boolean) : [];

        if (excludeShorts && genres.includes('Krátkometrážní')) continue;
        if (excludeDocs && genres.includes('Dokumentární')) continue;
        if (imgM && /\/assets\/images\/|poster-free|no-poster/.test(imgM[1])) imgM[1] = '';

        seen.add(id);
        out.push({
            id,
            title: decodeEntities(titleM[1]),
            year: yearM ? parseInt(yearM[1], 10) : null,
            poster: imgM ? bigPoster(imgM[1]) : '',
            origin: originM ? decodeEntities(originM[1]).trim() : '',
            genres,
            rating: ratingM ? Math.round(parseFloat(ratingM[1].replace(',', '.'))) : null,
            isSeries,
            csfdUrl: `${CSFD_BASE}/film/${id}/prehled/`
        });
    }
    return out;
}

function sectionAfterHeading(html, heading) {
    const i = html.indexOf(`<h2>${heading}</h2>`);
    if (i === -1) return '';
    const end = html.indexOf('</section>', i);
    return html.slice(i, end === -1 ? i + 60000 : end);
}

// Adresa filtrovaného žebříčku (ČSFD kóduje filtr jako JSON → base64 → ROT13)
const rot13 = (s) => s.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
function genreChartUrl(genreId, isSeries) {
    const filter = { type: isSeries ? 3 : 1, country_id: null, genre: [genreId], year_from: null, year_to: null, actor: [], director: [] };
    return `${CSFD_BASE}/zebricky/vlastni-vyber/?filter=${encodeURIComponent(rot13(Buffer.from(JSON.stringify(filter)).toString('base64').replace(/=+$/, '')))}`;
}

async function buildDiscover() {
    const [home, topMovies, topSeries, chartPage] = await Promise.all([
        csfdHtml(`${CSFD_BASE}/`),
        csfdHtml(`${CSFD_BASE}/zebricky/filmy/nejlepsi/`),
        csfdHtml(`${CSFD_BASE}/zebricky/serialy/nejlepsi/`),
        csfdHtml(`${CSFD_BASE}/zebricky/vlastni-vyber/`)
    ]);

    const genres = [];
    for (const m of chartPage.matchAll(/name="genre\[\]"[^>]*value="(\d+)"[\s\S]*?class="label-name">([^<]+)</g)) {
        const name = decodeEntities(m[2]).trim();
        if (GENRE_WHITELIST.includes(name)) genres.push({ id: parseInt(m[1], 10), name });
    }

    const sections = [
        { id: 'popular-movies', items: parseFilmArticles(sectionAfterHeading(home, 'Nejnavštěvovanější filmy')) },
        { id: 'popular-series', items: parseFilmArticles(sectionAfterHeading(home, 'Nejnavštěvovanější seriály'), { isSeries: true }) },
        { id: 'top-movies', items: parseFilmArticles(topMovies) },
        { id: 'top-series', items: parseFilmArticles(topSeries, { isSeries: true }) }
    ];
    if (sections.every(s => !s.items.length)) throw new Error('ČSFD nevrátilo žádné tituly (změnila se stránka?)');
    return { updated: new Date().toISOString(), sections, genres };
}

let discoverData = null;
let discoverRefreshing = null;
const genreCache = new Map();

async function loadDiscoverFromDisk() {
    try {
        const saved = JSON.parse(await readFile(DISCOVER_FILE, 'utf8'));
        if (saved && saved.discover) discoverData = saved.discover;
        for (const [k, v] of Object.entries(saved.genres || {})) genreCache.set(k, v);
        console.log('📁 Nabídka načtena z disku', discoverData?.updated || '');
    } catch { /* první spuštění */ }
}

async function saveDiscoverToDisk() {
    try {
        await writeFile(DISCOVER_FILE, JSON.stringify({ discover: discoverData, genres: Object.fromEntries(genreCache) }));
    } catch (e) { console.warn('Nabídku se nepodařilo uložit:', e.message); }
}

function refreshDiscover() {
    if (discoverRefreshing) return discoverRefreshing;
    discoverRefreshing = buildDiscover()
        .then(async data => {
            discoverData = data;
            await saveDiscoverToDisk();
            console.log('🔄 Nabídka z ČSFD obnovena:', data.sections.map(s => `${s.id}=${s.items.length}`).join(', '));
            return data;
        })
        .catch(e => { console.warn('Obnova nabídky selhala:', e.message); if (!discoverData) throw e; return discoverData; })
        .finally(() => { discoverRefreshing = null; });
    return discoverRefreshing;
}

const isStale = (iso) => !iso || Date.now() - new Date(iso).getTime() > DISCOVER_TTL;

app.get('/discover', async (req, res) => {
    try {
        if (!discoverData) await refreshDiscover();
        else if (isStale(discoverData.updated)) refreshDiscover(); // na pozadí, hned vrátit uložené
        res.set('Cache-Control', 'public, max-age=1800');
        res.json(discoverData);
    } catch (err) {
        res.status(502).json({ error: 'Nabídku z ČSFD se nepodařilo načíst: ' + err.message });
    }
});

app.get('/discover/genre', async (req, res) => {
    const id = parseInt(req.query.id, 10);
    const isSeries = req.query.type === 'series';
    if (!id) return res.status(400).json({ error: "Chybí parametr 'id'" });
    const key = `${id}-${isSeries ? 's' : 'm'}`;
    try {
        let entry = genreCache.get(key);
        if (!entry || isStale(entry.updated)) {
            const html = await csfdHtml(genreChartUrl(id, isSeries));
            const isDocGenre = (discoverData?.genres || []).some(g => g.id === id && g.name === 'Dokumentární');
            const items = parseFilmArticles(html, { isSeries, excludeDocs: !isDocGenre });
            if (items.length || !entry) entry = { updated: new Date().toISOString(), items };
            genreCache.set(key, entry);
            saveDiscoverToDisk();
        }
        res.set('Cache-Control', 'public, max-age=1800');
        res.json(entry);
    } catch (err) {
        const old = genreCache.get(key);
        if (old) return res.json(old);
        res.status(502).json({ error: 'Žánr se nepodařilo načíst: ' + err.message });
    }
});

// Podobné tituly k filmu (pro řadu „Protože jsi sledoval…“)
const similarCache = new Map();
app.get('/csfd-similar', async (req, res) => {
    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: "Chybí parametr 'id'" });
    try {
        const hit = similarCache.get(id);
        if (hit && Date.now() - hit.t < 7 * DISCOVER_TTL) return res.json({ items: hit.items });

        const movie = await csfdMovieCached(id);
        const list = [...(movie.similar || []), ...(movie.related || [])]
            .filter((v, i, a) => v && v.id && a.findIndex(x => x.id === v.id) === i)
            .slice(0, 12);
        const items = (await Promise.all(list.map(async (s) => {
            try {
                const m = await csfdMovieCached(s.id);
                const type = String(m.type || '').toLowerCase();
                if (type === 'season' || type === 'episode') return null;
                return {
                    id: s.id,
                    title: m.title || s.title,
                    year: parseInt(m.year, 10) || null,
                    poster: m.poster || '',
                    genres: Array.isArray(m.genres) ? m.genres : [],
                    rating: m.rating || null,
                    isSeries: type === 'series',
                    csfdUrl: `${CSFD_BASE}/film/${s.id}/prehled/`
                };
            } catch { return null; }
        }))).filter(Boolean);
        if (similarCache.size > 500) similarCache.delete(similarCache.keys().next().value);
        similarCache.set(id, { t: Date.now(), items });
        res.set('Cache-Control', 'public, max-age=21600');
        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Nabídka: načíst z disku, obnovit při startu, když je stará, a pak každou hodinu zkontrolovat
loadDiscoverFromDisk().then(() => {
    if (!discoverData || isStale(discoverData.updated)) refreshDiscover().catch(() => {});
});
setInterval(() => {
    if (!discoverData || isStale(discoverData.updated)) refreshDiscover().catch(() => {});
}, 60 * 60 * 1000).unref();

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
