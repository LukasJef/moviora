// =====================================================
// MOVIORA – frontend
// Backend běží na VPS (server.js), sem jde jen statika.
// =====================================================
const API_URL = 'https://api.moviora.win';

const FALLBACK_POSTER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#231214"/><rect x="97" y="110" width="6" height="80" fill="#e50914"/></svg>'
);
const SOURCES_VISIBLE = 8;

// --- Prvky stránky ---
const $ = (id) => document.getElementById(id);
const searchInput = $('searchQuery');
const libraryContainer = $('libraryContainer');
const resultsContainer = $('resultsContainer');
const resultsDiv = $('results');
const movieDetail = $('movieDetail');
const detailContent = $('detailContent');
const videoPlayer = $('videoPlayer');
const playerEl = $('player');

// --- Stav ---
let currentMovieData = null;
let activeStreams = [];
let selectedStreamIdx = 0;
let showAllSources = false;
let currentSeason = 1;
let currentEpisode = 1;
let selectedLanguage = 'cz'; // nastaví se v init() podle uložené volby / jazyka prohlížeče
let currentFetchController = null;
let searchRequestId = 0;
let detailRequestId = 0;

// =====================================================
// Pomocné funkce
// =====================================================
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
}

function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* plné úložiště */ }
}

// Stavy, které vrací Cloudflare, když VPS neodpovídá
const OUTAGE_STATUSES = [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530];

async function apiGet(path, options = {}) {
    let res;
    try {
        res = await fetch(`${API_URL}${path}`, options);
    } catch (err) {
        if (err.name !== 'AbortError') reportPossibleOutage();
        throw err;
    }
    if (OUTAGE_STATUSES.includes(res.status)) reportPossibleOutage();
    let data = {};
    try { data = await res.json(); } catch { /* neplatná odpověď */ }
    if (!res.ok && !data.error) data.error = t('serverError', { s: res.status });
    return data;
}

// =====================================================
// Jazyk rozhraní (CS / EN)
// =====================================================
const I18N = {
    cs: {
        homeLink: 'Moviora – domů', uiLangGroup: 'Jazyk stránky',
        searchPlaceholder: 'Hledat film nebo seriál',
        introTitle: 'Co si dnes pustíš?',
        introText: 'Napiš název filmu nebo seriálu do vyhledávání nahoře. Co začneš sledovat, najdeš pak tady i s místem, kde jsi skončil.',
        continueWatching: 'Pokračovat ve sledování', favorites: 'Oblíbené',
        resultsFor: 'Výsledky pro „{q}“', searching: 'Hledám v ČSFD a IMDb…',
        searchFailed: 'Vyhledávání selhalo: {e}',
        noResults: 'Nic jsme nenašli. Zkus jiný název nebo originální anglický název.',
        serverDown: 'Server neodpovídá. Zkontroluj připojení a zkus to znovu.',
        serverError: 'Server odpověděl chybou {s}.', untitled: 'Bez názvu',
        loadingDetail: 'Načítám informace z ČSFD…', series: 'Seriál', rating: 'ČSFD {n} %',
        onCsfd: 'Na ČSFD', onImdb: 'Na IMDb',
        findingSources: 'Hledám zdroje…', unavailable: 'Nedostupné', play: 'Přehrát', resumeFrom: 'Pokračovat od {t}',
        audioGroup: 'Jazyk zvuku', audioCz: 'CZ dabing', audioOrig: 'Původní znění',
        inFavorites: 'V oblíbených', addFavorite: 'Přidat do oblíbených',
        added: 'Přidáno do oblíbených', removed: 'Odebráno z oblíbených',
        prevEp: 'Předchozí díl', nextEp: 'Další díl', season: 'Řada', episode: 'Díl', cast: 'Hrají:',
        sources: 'Zdroje', sourcesFor: 'Zdroje pro {ep}', searchingSources: 'Hledám na Přehraj.to…',
        sourcesFailed: 'Zdroje se nepodařilo načíst: {e}',
        noSourcesFilm: 'Pro tento film jsme na Přehraj.to nic nenašli. Zkus přepnout na {other}.',
        noSourcesEp: 'Pro díl {ep} jsme na Přehraj.to nic nenašli. Zkus přepnout na {other} nebo jiný díl.',
        showAll: 'Zobrazit všech {n}', downloadSelected: 'Stáhnout vybraný', unknownFile: 'Neznámý soubor',
        videoGone: 'Video na Přehraj.to už není dostupné.',
        preparingDownload: 'Připravuji odkaz ke stažení…', downloadFailed: 'Stažení se nepodařilo: {e}',
        loadingVideo: 'Načítám video…', resumingAt: 'Pokračuješ od {t}', pickOther: 'Vybrat jiný zdroj',
        seasonEp: 'Řada {s}, díl {e}', pause: 'Pozastavit', mute: 'Ztlumit', unmute: 'Zapnout zvuk',
        findingNext: 'Hledám další díl…', nextNotFound: 'Díl {ep} jsme na Přehraj.to nenašli.',
        backToDetail: 'Zpět na detail', episodeEnded: 'Díl skončil.', playNext: 'Přehrát další díl',
        cantPlay: 'Tento soubor se v prohlížeči nepodařilo přehrát. Zkus jiný zdroj, ideálně s jiným formátem nebo kvalitou.',
        quality: 'Kvalita', qualityN: 'Kvalita {n}',
        playerLabel: 'Přehrávač', closePlayer: 'Zavřít přehrávač', seekLabel: 'Pozice ve videu',
        back10: 'Zpět o 10 sekund', fwd10: 'Vpřed o 10 sekund', volume: 'Hlasitost',
        subtitles: 'Titulky', fullscreen: 'Celá obrazovka',
        installApp: 'Stáhnout aplikaci', installTitle: 'Nainstalovat Movioru', gotIt: 'Rozumím',
        installIos: 'V Safari klepni dole na tlačítko Sdílet a zvol „Přidat na plochu“. Moviora se pak otevře jako aplikace přes celou obrazovku.',
        installMacSafari: 'V Safari zvol v menu Soubor položku „Přidat do Docku“.',
        installFirefox: 'Firefox na počítači aplikace instalovat neumí. Otevři Movioru v Chrome nebo Edge a klikni na „Stáhnout aplikaci“.',
        installGeneric: 'V menu prohlížeče zvol „Nainstalovat aplikaci“ nebo „Přidat na plochu“. V Chrome a Edge je na to i ikona vpravo v adresním řádku.',
        installed: 'Moviora je nainstalovaná',
        offlineTitle: 'Server je offline',
        offlineText: 'Moviora se teď nemůže spojit se svým serverem. Jakmile bude zase dostupný, stránka se načte sama.',
        offlineTitleNet: 'Jsi offline',
        offlineTextNet: 'Zařízení není připojené k internetu. Až se připojení vrátí, Moviora pokračuje tam, kde jsi byl.',
        retryNow: 'Zkusit znovu', retrying: 'Zkouším se připojit…', nextRetry: 'Další pokus za {s} s',
        backOnline: 'Server je zase online',
        tvModeOn: 'Režim pro televizi', tvModeOff: 'Vypnout režim pro televizi',
        tvEnabled: 'Režim pro televizi zapnutý – ovládej šipkami', tvDisabled: 'Režim pro televizi vypnutý',
        tvHintMove: 'pohyb', tvHintOk: 'vybrat', tvHintBack: 'zpět',
        seasonsCount: '{n} řad', seasonsCount1: '1 řada', seasonsCount2: '{n} řady',
        loadingEpisodes: 'Načítám díly…', lastEpisode: 'Tohle byl poslední díl seriálu.'
    },
    en: {
        homeLink: 'Moviora – home', uiLangGroup: 'Site language',
        searchPlaceholder: 'Search movies and TV shows',
        introTitle: 'What are you watching tonight?',
        introText: 'Type a movie or show title into the search above. Anything you start watching shows up here, along with where you left off.',
        continueWatching: 'Continue watching', favorites: 'Favourites',
        resultsFor: 'Results for “{q}”', searching: 'Searching ČSFD and IMDb…',
        searchFailed: 'Search failed: {e}',
        noResults: 'Nothing found. Try another title, or the original English title.',
        serverDown: 'The server isn’t responding. Check your connection and try again.',
        serverError: 'The server returned error {s}.', untitled: 'Untitled',
        loadingDetail: 'Loading details from ČSFD…', series: 'TV series', rating: 'ČSFD {n}%',
        onCsfd: 'View on ČSFD', onImdb: 'View on IMDb',
        findingSources: 'Finding sources…', unavailable: 'Unavailable', play: 'Play', resumeFrom: 'Resume from {t}',
        audioGroup: 'Audio language', audioCz: 'Czech dub', audioOrig: 'Original audio',
        inFavorites: 'In favourites', addFavorite: 'Add to favourites',
        added: 'Added to favourites', removed: 'Removed from favourites',
        prevEp: 'Previous episode', nextEp: 'Next episode', season: 'Season', episode: 'Episode', cast: 'Cast:',
        sources: 'Sources', sourcesFor: 'Sources for {ep}', searchingSources: 'Searching Přehraj.to…',
        sourcesFailed: 'Couldn’t load sources: {e}',
        noSourcesFilm: 'Nothing found on Přehraj.to for this movie. Try switching to {other}.',
        noSourcesEp: 'Nothing found on Přehraj.to for episode {ep}. Try switching to {other} or another episode.',
        showAll: 'Show all {n}', downloadSelected: 'Download selected', unknownFile: 'Unknown file',
        videoGone: 'This video is no longer available on Přehraj.to.',
        preparingDownload: 'Preparing the download link…', downloadFailed: 'Download failed: {e}',
        loadingVideo: 'Loading video…', resumingAt: 'Resuming at {t}', pickOther: 'Choose another source',
        seasonEp: 'Season {s}, episode {e}', pause: 'Pause', mute: 'Mute', unmute: 'Unmute',
        findingNext: 'Finding the next episode…', nextNotFound: 'Episode {ep} isn’t on Přehraj.to.',
        backToDetail: 'Back to details', episodeEnded: 'Episode finished.', playNext: 'Play next episode',
        cantPlay: 'Your browser couldn’t play this file. Try another source, ideally in a different format or quality.',
        quality: 'Quality', qualityN: 'Quality {n}',
        playerLabel: 'Player', closePlayer: 'Close player', seekLabel: 'Video position',
        back10: 'Back 10 seconds', fwd10: 'Forward 10 seconds', volume: 'Volume',
        subtitles: 'Subtitles', fullscreen: 'Full screen',
        installApp: 'Download app', installTitle: 'Install Moviora', gotIt: 'Got it',
        installIos: 'In Safari, tap the Share button at the bottom and choose “Add to Home Screen”. Moviora then opens full screen like an app.',
        installMacSafari: 'In Safari, choose File → “Add to Dock”.',
        installFirefox: 'Firefox on desktop can’t install apps. Open Moviora in Chrome or Edge and click “Download app”.',
        installGeneric: 'In your browser menu, choose “Install app” or “Add to Home screen”. Chrome and Edge also show an install icon on the right of the address bar.',
        installed: 'Moviora is installed',
        offlineTitle: 'The server is offline',
        offlineText: 'Moviora can’t reach its server right now. The page reloads by itself as soon as the server is back.',
        offlineTitleNet: 'You’re offline',
        offlineTextNet: 'This device isn’t connected to the internet. When the connection is back, Moviora picks up where you were.',
        retryNow: 'Try again', retrying: 'Connecting…', nextRetry: 'Next try in {s} s',
        backOnline: 'The server is back online',
        tvModeOn: 'TV mode', tvModeOff: 'Turn off TV mode',
        tvEnabled: 'TV mode on – use the arrow keys', tvDisabled: 'TV mode off',
        tvHintMove: 'move', tvHintOk: 'select', tvHintBack: 'back',
        seasonsCount: '{n} seasons', seasonsCount1: '1 season', seasonsCount2: '{n} seasons',
        loadingEpisodes: 'Loading episodes…', lastEpisode: 'That was the last episode of the series.'
    }
};

// Má prohlížeč češtinu nebo slovenštinu?
const BROWSER_CZSK = (navigator.languages || [navigator.language || ''])
    .some(l => /^(cs|sk)\b/i.test(String(l)));

// První návštěva = v úložišti zatím nic není (zjistit dřív, než cokoli uložíme)
const FIRST_VISIT = (() => {
    try { return localStorage.length === 0; } catch { return false; }
})();

let uiLang = (() => {
    const saved = readJSON('ui_lang', null);
    if (saved === 'cs' || saved === 'en') return saved;
    return BROWSER_CZSK ? 'cs' : 'en';
})();

function t(key, vars = {}) {
    const str = (I18N[uiLang] && I18N[uiLang][key]) ?? I18N.cs[key] ?? key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

function filesCount(n) {
    if (uiLang === 'en') return `${n} ${n === 1 ? 'file' : 'files'}`;
    return `${n} ${n === 1 ? 'soubor' : n < 5 ? 'soubory' : 'souborů'}`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const episodeTag = (s = currentSeason, e = currentEpisode) => `S${pad2(s)}E${pad2(e)}`;

function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

let toastTimer = null;
function toast(text, ms = 3500) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
};

// =====================================================
// Bodování streamů
// =====================================================
function parseSizeToGB(stream) {
    if (typeof stream.size === 'number') return stream.size / (1024 ** 3);
    const text = `${stream.size || ''} ${stream.title || ''}`.toLowerCase();
    const gb = text.match(/(\d+(?:[.,]\d+)?)\s*gb/);
    if (gb) return parseFloat(gb[1].replace(',', '.'));
    const mb = text.match(/(\d+(?:[.,]\d+)?)\s*mb/);
    if (mb) return parseFloat(mb[1].replace(',', '.')) / 1024;
    return 0;
}

// Backend posílá délku jako "02:10:46" nebo "45:12"
function parseStreamMinutes(stream) {
    const dur = String(stream.duration || '').trim();
    let m = dur.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) return +m[1] * 60 + +m[2];
    m = dur.match(/^(\d{1,3}):(\d{2})$/);
    if (m) return +m[1];
    const text = `${stream.title || ''} ${stream.name || ''}`;
    m = text.match(/\((\d{1,2}):(\d{2}):(\d{2})\)/);
    if (m) return +m[1] * 60 + +m[2];
    return null;
}

// Délka z ČSFD – číslo, "136 min" nebo "2 h 16 min"
function parseRuntime(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return value > 0 ? value : null;
    const str = String(value).toLowerCase();
    const h = str.match(/(\d+)\s*h/);
    const min = str.match(/(\d+)\s*min/);
    if (h) return +h[1] * 60 + (min ? +min[1] : 0);
    if (min) return +min[1];
    const num = str.match(/\d+/);
    return num ? +num[0] : null;
}

function detectQuality(title) {
    if (/2160p|\b4k\b|uhd/i.test(title)) return { label: '4K', cls: 'uhd' };
    if (/1080p|full\s?hd|fhd/i.test(title)) return { label: '1080p', cls: '' };
    if (/720p|\bhd\b/i.test(title)) return { label: '720p', cls: '' };
    if (/480p|dvdrip|xvid/i.test(title)) return { label: '480p', cls: '' };
    return { label: 'SD', cls: '' };
}

function detectLanguage(title) {
    if (/\b(sk|skdab|slovensky)\b/i.test(title) && !/\b(cz|czdab|cze|cesky|česky)\b/i.test(title)) return 'SK';
    if (/\b(cz|czdab|czdabing|dabing|cesky|česky|cze)\b/i.test(title)) return 'CZ';
    if (/\b(en|eng|english)\b/i.test(title)) return 'EN';
    if (/\b(tit|titulky|sub|subs)\b/i.test(title)) return 'TIT';
    return '';
}

function calculateStreamScore(stream, movie, lang) {
    let score = 100;
    const rawTitle = (stream.title || '').toLowerCase();
    const fullText = `${rawTitle} ${(stream.name || '').toLowerCase()}`;
    const targetTitle = (movie.title || '').toLowerCase();
    const targetYear = String(movie.year || '').match(/\d{4}/)?.[0] || '';

    // Čtyřmístná čísla z názvu (např. 2049) musí být i v souboru
    (targetTitle.match(/\b(19\d{2}|20\d{2})\b/g) || []).forEach(num => {
        if (!rawTitle.includes(num)) score -= 500;
    });

    // Jiný rok vydání
    if (targetYear) {
        (rawTitle.match(/\b(19\d{2}|20\d{2})\b/g) || []).forEach(y => {
            if (y !== targetYear && !targetTitle.includes(y)) score -= 400;
        });
    }

    // Stopáž – jen u filmů
    if (!movie.isSeries) {
        const streamMin = parseStreamMinutes(stream);
        const expected = parseRuntime(movie.runtime);
        if (streamMin && expected) {
            const diff = Math.abs(streamMin - expected);
            score += diff <= 3 ? 100 : diff <= 8 ? 10 : -500;
        }
    }

    // Velikost
    const gb = parseSizeToGB(stream);
    if (gb > 0) {
        if (gb >= 1.3) score += 30;
        if (gb < 0.4) score -= 80;
    }

    // Jazyk
    const hasCz = /\b(cz|czdab|czdabing|dabing|cesky|česky)\b/i.test(rawTitle);
    const hasEn = /\b(en|eng|english)\b/i.test(rawTitle);
    if (lang === 'cz') {
        if (hasCz) score += 150;
        if (hasEn && !hasCz) score -= 250;
    } else {
        if (hasEn) score += 150;
        if (hasCz && !hasEn) score -= 250;
    }

    // Ukázky a soundtracky
    if (/soundtrack|trailer|ukázka|\bost\b/i.test(fullText)) score -= 400;

    return score;
}

// =====================================================
// Navigace (funguje i tlačítko Zpět v prohlížeči)
// =====================================================
function setView(view) {
    libraryContainer.hidden = view !== 'home';
    resultsContainer.hidden = view !== 'results';
    movieDetail.hidden = view !== 'detail';
    window.scrollTo({ top: 0 });
}

function showMainPage(push = true) {
    if (push) history.pushState({ view: 'home' }, '', location.pathname);
    document.title = 'Moviora';
    searchInput.value = '';
    setView('home');
    loadLibrary();
}

let suppressNextPop = false;

window.addEventListener('popstate', (e) => {
    if (suppressNextPop) { suppressNextPop = false; return; }
    const state = e.state || { view: 'home' };

    // Zpět při otevřeném přehrávači jen zavře přehrávač
    if (!playerEl.hidden && !state.player) {
        closePlayer(true);
        return;
    }
    renderRoute(state);
});

function renderRoute(state) {
    state = state || { view: 'home' };
    if (state.view === 'results' && state.q) return search(state.q, false);
    if (state.view === 'detail' && state.movie) return openMovieDetail(state.movie, false);
    showMainPage(false);
}

// =====================================================
// Vyhledávání
// =====================================================
$('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    search(searchInput.value);
});

$('brandLink').addEventListener('click', (e) => {
    e.preventDefault();
    showMainPage();
});

// "/" skočí do vyhledávání
document.addEventListener('keydown', (e) => {
    if (e.key === '/' && playerEl.hidden && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

async function search(rawQuery, push = true) {
    const query = String(rawQuery ?? searchInput.value).trim();
    if (!query) return;

    searchInput.value = query;
    searchInput.blur();
    if (push) history.pushState({ view: 'results', q: query }, '', `#hledat=${encodeURIComponent(query)}`);
    document.title = `${query} – Moviora`;

    setView('results');
    $('resultsTitle').textContent = t('resultsFor', { q: query });
    resultsDiv.innerHTML = `<p class="status">${t('searching')}</p>`;

    try {
        const data = await apiGet(`/search?q=${encodeURIComponent(query)}`);
        if (data.error) {
            resultsDiv.innerHTML = `<p class="status error">${t('searchFailed', { e: escapeHtml(data.error) })}</p>`;
            return;
        }
        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = `<p class="status">${t('noResults')}</p>`;
            return;
        }
        renderGrid(data.results, resultsDiv, { lazyPosters: true });
        tvFocusFirst('#results .poster', true);
    } catch {
        resultsDiv.innerHTML = `<p class="status error">${t('serverDown')}</p>`;
    }
}

// =====================================================
// Plakáty
// =====================================================
function renderGrid(movies, target, { lazyPosters = false } = {}) {
    target.innerHTML = '';

    movies.forEach(movie => {
        const title = movie.nazev || movie.title || t('untitled');
        const year = movie.rok || movie.year || '';
        const csfdUrl = movie.csfd_url || movie.csfdLink;
        const normalized = { ...movie, title, year, csfdLink: csfdUrl };

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'poster';
        card.addEventListener('click', () => openMovieDetail(normalized));

        const frame = document.createElement('span');
        frame.className = 'poster-frame';

        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = movie.poster || FALLBACK_POSTER;
        img.onerror = () => { if (img.src !== FALLBACK_POSTER) img.src = FALLBACK_POSTER; };
        frame.appendChild(img);

        const progress = getWatchProgressForCard(title, movie.isSeries);
        if (progress && progress.percent > 1 && progress.percent < 98) {
            const bar = document.createElement('span');
            bar.className = 'playhead';
            bar.innerHTML = `<span style="width:${Math.min(100, progress.percent).toFixed(1)}%"></span>`;
            frame.appendChild(bar);
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'poster-title';
        titleEl.textContent = title;

        const y = document.createElement('span');
        y.className = 'poster-year';
        const lastEp = movie.isSeries ? readJSON(`last_ep_${title}`, null) : null;
        y.textContent = lastEp ? `${year ? year + ', ' : ''}${episodeTag(lastEp.season, lastEp.episode)}` : year;

        card.append(frame, titleEl, y);
        target.appendChild(card);

        if (lazyPosters && csfdUrl) {
            apiGet(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`)
                .then(d => {
                    if (d.poster && d.poster.trim()) {
                        normalized.poster = d.poster;
                        img.src = d.poster;
                    }
                })
                .catch(() => {});
        }
    });
}

// =====================================================
// Detail filmu / seriálu
// =====================================================
async function openMovieDetail(movie, push = true) {
    const reqId = ++detailRequestId;
    currentMovieData = { ...movie };
    activeStreams = [];
    showAllSources = false;

    if (push) history.pushState({ view: 'detail', movie }, '', '#film');
    document.title = `${movie.title} – Moviora`;
    setView('detail');

    $('detailBackdrop').style.backgroundImage = 'none';
    detailContent.innerHTML = `<p class="status">${t('loadingDetail')}</p>`;

    const csfdUrl = movie.csfd_url || movie.csfdLink;
    const details = {
        poster: movie.poster || '',
        description: movie.description || '',
        actors: movie.actors || '',
        genres: movie.genres || '',
        rating: movie.rating || null,
        isSeries: Boolean(movie.isSeries),
        runtime: movie.runtime || null,
        imdbLink: movie.imdbLink || movie.imdb_url || movie.imdbUrl || null,
        seasons: null
    };

    if (csfdUrl) {
        try {
            const d = await apiGet(`/csfd-scrape?details=1&url=${encodeURIComponent(csfdUrl)}`);
            if (!d.error) {
                if (d.imdbUrl) details.imdbLink = d.imdbUrl;
                details.seasons = Array.isArray(d.seasons) && d.seasons.length ? d.seasons : null;
                if (d.poster && d.poster.trim()) details.poster = d.poster;
                details.description = d.description || details.description;
                details.actors = d.cast || details.actors;
                details.genres = d.genres || details.genres;
                details.rating = d.rating || details.rating;
                details.isSeries = Boolean(d.isSeries);
                details.runtime = parseRuntime(d.duration ?? d.runtime) || details.runtime;
            }
        } catch { /* ČSFD nedostupné – zobrazíme, co máme */ }
    }

    if (reqId !== detailRequestId) return; // mezitím otevřen jiný film

    Object.assign(currentMovieData, details);

    if (currentMovieData.isSeries) {
        const lastEp = readJSON(`last_ep_${currentMovieData.title}`, { season: 1, episode: 1 });
        currentSeason = parseInt(lastEp.season, 10) || 1;
        currentEpisode = parseInt(lastEp.episode, 10) || 1;
        const seasons = currentMovieData.seasons;
        if (seasons && !seasons.some(s => s.number === currentSeason)) {
            currentSeason = seasons[0].number;
            currentEpisode = 1;
        }
    }

    renderDetail();
    addToHistory(currentMovieData);
    if (currentMovieData.isSeries && currentMovieData.seasons) {
        await loadEpisodes();
        if (reqId !== detailRequestId) return;
    }
    fetchAndRenderStreams();
}

function renderDetail() {
    const m = currentMovieData;
    const imdbUrl = m.imdbLink || m.imdb_url || m.imdbUrl;
    const csfdUrl = m.csfd_url || m.csfdLink;
    const poster = m.poster || FALLBACK_POSTER;

    if (m.poster) {
        $('detailBackdrop').style.backgroundImage = `url("${encodeURI(m.poster).replace(/"/g, '%22')}")`;
    }

    const facts = [];
    if (m.year && m.year !== '---') facts.push(`<li>${escapeHtml(m.year)}</li>`);
    if (m.isSeries) {
        facts.push(`<li>${t('series')}</li>`);
        const n = m.seasons ? m.seasons.length : 0;
        if (n) facts.push(`<li>${n === 1 ? t('seasonsCount1') : n < 5 ? t('seasonsCount2', { n }) : t('seasonsCount', { n })}</li>`);
    }
    else if (m.runtime) facts.push(`<li>${escapeHtml(m.runtime)} min</li>`);
    if (m.genres) facts.push(`<li>${escapeHtml(m.genres)}</li>`);
    if (m.rating) facts.push(`<li class="rating">${t('rating', { n: escapeHtml(m.rating) })}</li>`);

    const showOriginal = m.originalTitle && m.originalTitle.toLowerCase() !== String(m.title).toLowerCase();
    const fav = isMovieInFavorites(m.title);

    const episodePicker = m.isSeries ? `
        <div class="episode-picker">
            <button class="icon-btn" id="epPrev" aria-label="${t('prevEp')}">${ICONS.prev}</button>
            <label>${t('season')}
                <select id="seasonSelect">${seasonNumbers().map(i => `<option value="${i}" ${i === currentSeason ? 'selected' : ''}>${i}</option>`).join('')}</select>
            </label>
            <label>${t('episode')}
                <select id="episodeSelect">${episodeOptionsHtml()}</select>
            </label>
            <button class="icon-btn" id="epNext" aria-label="${t('nextEp')}">${ICONS.next}</button>
        </div>` : '';

    const links = [
        csfdUrl ? `<a class="ext-btn ext-csfd" href="${escapeHtml(csfdUrl)}" target="_blank" rel="noopener">${t('onCsfd')}</a>` : '',
        imdbUrl ? `<a class="ext-btn ext-imdb" href="${escapeHtml(imdbUrl)}" target="_blank" rel="noopener">${t('onImdb')}</a>` : ''
    ].join('');

    detailContent.innerHTML = `
        <div class="detail-hero">
            <img class="detail-poster" src="${escapeHtml(poster)}" alt="" referrerpolicy="no-referrer"
                 onerror="this.onerror=null;this.src='${FALLBACK_POSTER}'">
            <div class="detail-main">
                <h1 class="detail-title">${escapeHtml(m.title)}</h1>
                ${showOriginal ? `<p class="detail-original">${escapeHtml(m.originalTitle)}</p>` : ''}
                ${facts.length ? `<ul class="facts">${facts.join('')}</ul>` : ''}

                <div class="actions">
                    <button class="btn btn-primary" id="playBtn" disabled>${ICONS.play}<span>${t('findingSources')}</span></button>
                    <div class="segmented" role="group" aria-label="${t('audioGroup')}">
                        <button type="button" data-lang="cz" aria-pressed="${selectedLanguage === 'cz'}">${t('audioCz')}</button>
                        <button type="button" data-lang="en" aria-pressed="${selectedLanguage === 'en'}">${t('audioOrig')}</button>
                    </div>
                    <button class="btn btn-quiet" id="favBtn" aria-pressed="${fav}">${ICONS.star}<span>${fav ? t('inFavorites') : t('addFavorite')}</span></button>
                </div>

                ${episodePicker}

                ${m.description ? `<p class="plot">${escapeHtml(m.description)}</p>` : ''}
                ${m.actors ? `<p class="cast"><strong>${t('cast')}</strong> ${escapeHtml(m.actors)}</p>` : ''}
                ${links ? `<div class="ext-links">${links}</div>` : ''}
            </div>
        </div>

        <section class="shelf" aria-labelledby="sourcesTitle">
            <div class="sources-head">
                <h2 class="shelf-title" id="sourcesTitle">${m.isSeries ? sourcesTitleText() : t('sources')}</h2>
                <span class="count" id="sourcesCount"></span>
            </div>
            <div id="sourcesBody"><p class="status">${t('searchingSources')}</p></div>
        </section>
    `;

    $('playBtn').addEventListener('click', () => startStreaming());
    $('favBtn').addEventListener('click', toggleFavoriteCurrent);
    detailContent.querySelectorAll('.segmented button').forEach(b =>
        b.addEventListener('click', () => onLanguageChange(b.dataset.lang)));

    if (m.isSeries) {
        $('seasonSelect').addEventListener('change', onEpisodeOrSeasonChange);
        $('episodeSelect').addEventListener('change', onEpisodeOrSeasonChange);
        $('epPrev').addEventListener('click', () => stepEpisode(-1));
        $('epNext').addEventListener('click', () => stepEpisode(1));
        updateEpisodeButtons();
    }
    tvFocusFirst('#playBtn:not([disabled]), .segmented button[aria-pressed="true"]', true);
}

function range(from, to) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function onLanguageChange(lang) {
    if (lang === selectedLanguage) return;
    selectedLanguage = lang;
    writeJSON('lang', lang);
    detailContent.querySelectorAll('.segmented button').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    fetchAndRenderStreams();
}

// ---------- Řady a díly (z ČSFD) ----------
const episodesCache = new Map();   // id řady → [{ number, title }]
let episodesRequestId = 0;

function currentSeasonData() {
    const seasons = currentMovieData && currentMovieData.seasons;
    return seasons ? seasons.find(s => s.number === currentSeason) || null : null;
}

function currentEpisodes() {
    const season = currentSeasonData();
    if (!season) return null;
    return season.episodes || episodesCache.get(season.id) || null;
}

function seasonNumbers() {
    const seasons = currentMovieData && currentMovieData.seasons;
    return seasons ? seasons.map(s => s.number) : range(1, 30);
}

function episodeOptionsHtml() {
    const eps = currentEpisodes();
    if (eps && eps.length) {
        return eps.map(e => `<option value="${e.number}" ${e.number === currentEpisode ? 'selected' : ''}>${e.number}${e.title ? '. ' + escapeHtml(e.title) : ''}</option>`).join('');
    }
    if (currentSeasonData()) return `<option value="${currentEpisode}">${t('loadingEpisodes')}</option>`;
    return range(1, 60).map(i => `<option value="${i}" ${i === currentEpisode ? 'selected' : ''}>${i}</option>`).join('');
}

function currentEpisodeTitle() {
    const eps = currentEpisodes();
    const ep = eps && eps.find(e => e.number === currentEpisode);
    return ep && ep.title ? ep.title : '';
}

function sourcesTitleText() {
    const name = currentEpisodeTitle();
    return t('sourcesFor', { ep: episodeTag() }) + (name ? ` – ${name}` : '');
}

function refreshEpisodeUi() {
    const sSel = $('seasonSelect');
    if (sSel) sSel.value = String(currentSeason);
    const eSel = $('episodeSelect');
    if (eSel) {
        eSel.innerHTML = episodeOptionsHtml();
        eSel.value = String(currentEpisode);
    }
    const title = $('sourcesTitle');
    if (title) title.textContent = sourcesTitleText();
    updateEpisodeButtons();
}

// Načte díly aktuální řady (z keše nebo ze serveru) a srovná vybraný díl
async function loadEpisodes() {
    const season = currentSeasonData();
    if (!season) { refreshEpisodeUi(); return null; }
    if (!season.episodes && !episodesCache.has(season.id)) {
        refreshEpisodeUi();                   // "Načítám díly…"
        const reqId = ++episodesRequestId;
        try {
            const d = await apiGet(`/csfd-episodes?id=${season.id}`);
            if (!d.error && Array.isArray(d.episodes)) episodesCache.set(season.id, d.episodes);
        } catch { /* bez seznamu dílů se použije prosté číslo */ }
        if (reqId !== episodesRequestId) return null;
    }
    const eps = currentEpisodes();
    if (eps && eps.length && !eps.some(e => e.number === currentEpisode)) currentEpisode = eps[0].number;
    if (eps && !eps.length) episodesCache.delete(season.id);
    refreshEpisodeUi();
    return eps;
}

async function onEpisodeOrSeasonChange(e) {
    const newSeason = parseInt($('seasonSelect').value, 10) || 1;
    const seasonChanged = newSeason !== currentSeason;
    currentSeason = newSeason;
    if (seasonChanged) {
        currentEpisode = 1;
        await loadEpisodes();
    } else {
        currentEpisode = parseInt($('episodeSelect').value, 10) || 1;
        refreshEpisodeUi();
    }
    fetchAndRenderStreams();
}

// Posun o díl dopředu/dozadu, i přes hranici řady. Vrací false, když už další díl není.
async function stepEpisode(delta) {
    const seasons = currentMovieData && currentMovieData.seasons;
    const eps = currentEpisodes();

    if (seasons && eps && eps.length) {
        const idx = eps.findIndex(e => e.number === currentEpisode);
        const nextIdx = (idx === -1 ? 0 : idx) + delta;
        if (nextIdx >= 0 && nextIdx < eps.length) {
            currentEpisode = eps[nextIdx].number;
        } else {
            const sIdx = seasons.findIndex(s => s.number === currentSeason);
            const target = seasons[sIdx + (delta > 0 ? 1 : -1)];
            if (!target) return false;
            currentSeason = target.number;
            currentEpisode = delta > 0 ? 1 : Infinity;
            const newEps = await loadEpisodes();
            if (delta < 0) {
                currentEpisode = newEps && newEps.length ? newEps[newEps.length - 1].number : 1;
                refreshEpisodeUi();
            }
        }
    } else {
        const next = currentEpisode + delta;
        if (next < 1) return false;
        currentEpisode = next;
        const sel = $('episodeSelect');
        if (sel && ![...sel.options].some(o => +o.value === next)) sel.add(new Option(next, next));
    }
    refreshEpisodeUi();
    await fetchAndRenderStreams();
    return true;
}

function updateEpisodeButtons() {
    const prev = $('epPrev');
    const next = $('epNext');
    const seasons = currentMovieData && currentMovieData.seasons;
    const eps = currentEpisodes();
    if (seasons && eps && eps.length) {
        const first = seasons[0].number === currentSeason && eps[0].number === currentEpisode;
        const last = seasons[seasons.length - 1].number === currentSeason && eps[eps.length - 1].number === currentEpisode;
        if (prev) prev.disabled = first;
        if (next) next.disabled = last;
    } else {
        if (prev) prev.disabled = currentEpisode <= 1 && currentSeason <= 1;
        if (next) next.disabled = false;
    }
}

// =====================================================
// Zdroje z Přehraj.to
// =====================================================
async function fetchStreams(query, signal) {
    const data = await apiGet(`/get-streams?title=${encodeURIComponent(query)}`, { signal });
    if (data.error) throw new Error(data.error);
    return data.streams || [];
}

async function fetchAndRenderStreams() {
    if (!currentMovieData || !$('sourcesBody')) return;

    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const { signal } = currentFetchController;
    const reqId = ++searchRequestId;
    const isCurrent = () => reqId === searchRequestId;

    activeStreams = [];
    selectedStreamIdx = 0;
    showAllSources = false;
    setPlayButton('loading');
    $('sourcesCount').textContent = '';
    $('sourcesBody').innerHTML = `<p class="status">${t('searchingSources')}</p>`;

    const m = currentMovieData;
    const suffix = selectedLanguage === 'en' ? ' ENG' : '';
    const queries = [];

    if (m.isSeries) {
        writeJSON(`last_ep_${m.title}`, { season: currentSeason, episode: currentEpisode });
        queries.push(`${m.title} ${episodeTag()}${suffix}`);
        queries.push(`${m.title} ${currentSeason}x${pad2(currentEpisode)}${suffix}`);
    } else {
        const year = String(m.year || '').match(/\d{4}/);
        if (year) queries.push(`${m.title} ${year[0]}${suffix}`);
        queries.push(`${m.title}${suffix}`);
        if (m.originalTitle && m.originalTitle.toLowerCase() !== m.title.toLowerCase()) {
            queries.push(`${m.originalTitle}${year ? ' ' + year[0] : ''}${suffix}`);
        }
    }

    try {
        let raw = [];
        for (const q of queries) {
            raw = await fetchStreams(q, signal);
            if (!isCurrent()) return;
            if (raw.length) break;
        }

        activeStreams = raw
            .map(s => ({ ...s, score: calculateStreamScore(s, m, selectedLanguage) }))
            .sort((a, b) => b.score - a.score);

        renderSources();
    } catch (e) {
        if (e.name === 'AbortError' || !isCurrent()) return;
        setPlayButton('none');
        $('sourcesBody').innerHTML = `<p class="status error">${t('sourcesFailed', { e: escapeHtml(e.message) })}</p>`;
    }
}

function setPlayButton(state) {
    const btn = $('playBtn');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (state === 'loading') { btn.disabled = true; label.textContent = t('findingSources'); }
    else if (state === 'none') { btn.disabled = true; label.textContent = t('unavailable'); }
    else {
        btn.disabled = false;
        const p = getWatchProgress();
        label.textContent = p && p.time > 30 && p.percent < 97 ? t('resumeFrom', { t: formatTime(p.time) }) : t('play');
    }
}

function renderSources() {
    const body = $('sourcesBody');
    if (!body) return;

    if (activeStreams.length === 0) {
        setPlayButton('none');
        $('sourcesCount').textContent = '';
        const other = selectedLanguage === 'cz' ? t('audioOrig') : t('audioCz');
        body.innerHTML = `<p class="status">${currentMovieData.isSeries
            ? t('noSourcesEp', { ep: episodeTag(), other })
            : t('noSourcesFilm', { other })}</p>`;
        return;
    }

    setPlayButton('ready');
    // Na TV po načtení zdrojů skočit na Přehrát, pokud uživatel ještě nic nevybral
    if (isTv() && document.activeElement?.closest('.segmented')) tvFocus($('playBtn'));
    $('sourcesCount').textContent = filesCount(activeStreams.length);

    const wanted = selectedLanguage === 'cz' ? ['CZ', 'SK'] : ['EN', 'TIT'];
    const visible = showAllSources ? activeStreams : activeStreams.slice(0, SOURCES_VISIBLE);

    const items = visible.map((s, idx) => {
        const title = s.title || s.name || t('unknownFile');
        const q = detectQuality(title);
        const lang = detectLanguage(title);
        const gb = parseSizeToGB(s);
        const size = gb > 0 ? (gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(gb * 1024)} MB`) : '';
        return `
            <li>
                <button type="button" class="source" data-idx="${idx}" aria-pressed="${idx === selectedStreamIdx}" title="${escapeHtml(title)}">
                    <span class="tag-q ${q.cls}">${q.label}</span>
                    <span class="tag-lang ${wanted.includes(lang) ? 'match' : ''}">${lang || '–'}</span>
                    <span class="source-name">${escapeHtml(title)}</span>
                    <span class="source-size">${size}</span>
                    <span class="source-dur">${escapeHtml(s.duration || '')}</span>
                </button>
            </li>`;
    }).join('');

    const moreBtn = !showAllSources && activeStreams.length > SOURCES_VISIBLE
        ? `<button class="btn btn-quiet" id="moreSources">${t('showAll', { n: activeStreams.length })}</button>` : '';

    body.innerHTML = `
        <ol class="source-list">${items}</ol>
        <div class="source-actions">
            ${moreBtn}
            <button class="btn btn-quiet" id="downloadBtn">${ICONS.download}<span>${t('downloadSelected')}</span></button>
        </div>`;

    body.querySelectorAll('.source').forEach(btn => {
        btn.addEventListener('click', () => {
            selectSource(+btn.dataset.idx);
            if (isTv()) startStreaming(); // na TV OK na zdroji rovnou přehraje
        });
        btn.addEventListener('dblclick', () => { selectSource(+btn.dataset.idx); startStreaming(); });
    });
    $('moreSources')?.addEventListener('click', () => { showAllSources = true; renderSources(); });
    $('downloadBtn').addEventListener('click', startDownloading);
}

function selectSource(idx) {
    selectedStreamIdx = idx;
    document.querySelectorAll('.source').forEach(b =>
        b.setAttribute('aria-pressed', String(+b.dataset.idx === idx)));
}

function getSelectedStream() {
    return activeStreams[selectedStreamIdx] || activeStreams[0] || null;
}

async function getVideoData(stream) {
    const data = await apiGet(`/get-video?url=${encodeURIComponent(stream.link)}`);
    if (data.error) throw new Error(data.error);
    if (!data.sources || data.sources.length === 0) throw new Error(t('videoGone'));
    return data;
}

async function startDownloading() {
    const stream = getSelectedStream();
    if (!stream) return;
    toast(t('preparingDownload'));
    try {
        const data = await getVideoData(stream);
        const file = data.sources[0].file || data.sources[0].src;
        const a = document.createElement('a');
        a.href = file;
        a.target = '_blank';
        a.rel = 'noopener';
        a.download = `${currentMovieData.title}${currentMovieData.isSeries ? ' ' + episodeTag() : ''}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        toast(t('downloadFailed', { e: e.message }));
    }
}

// =====================================================
// Přehrávač
// =====================================================
const P = {
    center: $('playerCenter'),
    play: $('pPlay'), back: $('pBack'), fwd: $('pFwd'),
    mute: $('pMute'), volume: $('pVolume'), time: $('pTime'),
    seek: $('pSeek'), fill: $('pFill'), head: $('pHead'), buffer: $('pBuffer'), tip: $('pTip'),
    next: $('pNext'), subs: $('pSubs'), quality: $('pQuality'), qualityMenu: $('pQualityMenu'),
    full: $('pFull'), close: $('pClose'), title: $('pTitle'), subtitle: $('pSubtitle')
};
let idleTimer = null;
let lastSave = 0;
let currentSources = [];
let lastFocus = null;
let savedScrollY = 0;

function playerMessage(html, interactive = false) {
    P.center.innerHTML = html;
    P.center.classList.toggle('interactive', interactive);
}

async function startStreaming(streamOverride) {
    const stream = streamOverride || getSelectedStream();
    if (!stream) return;

    openPlayer();
    playerMessage(`<div class="spinner"></div><p class="player-msg">${t('loadingVideo')}</p>`);

    try {
        const data = await getVideoData(stream);
        if (playerEl.hidden) return; // uživatel mezitím zavřel

        currentSources = data.sources;
        videoPlayer.innerHTML = '';
        videoPlayer.src = data.sources[0].file || data.sources[0].src;

        // Titulky – Přehraj.to posílá adresu v poli "src"
        const tracks = (data.tracks || []).filter(t => t.src || t.file);
        tracks.forEach((t, i) => {
            const el = document.createElement('track');
            el.kind = 'subtitles';
            el.label = t.label || 'Titulky';
            el.srclang = t.srclang || 'cs';
            el.src = t.src || t.file;
            if (i === 0) el.default = true;
            videoPlayer.appendChild(el);
        });
        P.subs.hidden = tracks.length === 0;
        P.subs.setAttribute('aria-pressed', String(tracks.length > 0));

        renderQualityMenu(0);

        const saved = getWatchProgress();
        videoPlayer.addEventListener('loadedmetadata', () => {
            if (videoPlayer.textTracks[0]) videoPlayer.textTracks[0].mode = tracks.length ? 'showing' : 'disabled';
            if (saved && saved.time > 5 && saved.percent < 97) {
                videoPlayer.currentTime = saved.time;
                toast(t('resumingAt', { t: formatTime(saved.time) }));
            }
        }, { once: true });

        videoPlayer.load();
        videoPlayer.play().catch(() => playerMessage('', false));
    } catch (e) {
        playerMessage(`<p class="player-msg">${escapeHtml(e.message)}</p><button class="btn" id="pTryOther">${t('pickOther')}</button>`, true);
        $('pTryOther').addEventListener('click', () => closePlayer());
    }
}

function openPlayer() {
    const m = currentMovieData;
    lastFocus = document.activeElement;
    P.title.textContent = m.title;
    P.subtitle.textContent = m.isSeries
        ? t('seasonEp', { s: currentSeason, e: currentEpisode }) + (currentEpisodeTitle() ? ` – ${currentEpisodeTitle()}` : '')
        : (m.year && m.year !== '---' ? String(m.year) : '');
    P.next.hidden = !m.isSeries;
    P.qualityMenu.hidden = true;

    if (playerEl.hidden) {
        savedScrollY = window.scrollY;
        playerEl.hidden = false;
        document.body.classList.add('player-open');
        history.pushState({ ...(history.state || {}), player: true }, '', location.href);
    }
    updatePlayButton();
    updateMuteButton();
    wakeControls();
    // Na TV začíná výběr na časové ose: šipky do stran rovnou přetáčí
    (isTv() ? P.seek : P.play).focus({ preventScroll: true });
}

function closePlayer(fromPopState = false) {
    if (playerEl.hidden) return;
    saveProgress(true);
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.innerHTML = '';
    videoPlayer.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

    playerEl.hidden = true;
    document.body.classList.remove('player-open');
    window.scrollTo(0, savedScrollY);
    playerMessage('');
    clearTimeout(idleTimer);

    if (!fromPopState && history.state?.player) {
        suppressNextPop = true; // návrat v historii nemá znovu načítat detail
        history.back();
    }
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });

    // Obnovit "Pokračovat od…" a ukazatele postupu
    setPlayButton(activeStreams.length ? 'ready' : 'none');
}

function renderQualityMenu(activeIdx) {
    P.quality.hidden = currentSources.length <= 1;
    P.qualityMenu.innerHTML = currentSources.map((s, i) =>
        `<li><button role="menuitemradio" aria-checked="${i === activeIdx}" data-idx="${i}">${escapeHtml(s.label || s.res || t('qualityN', { n: i + 1 }))}</button></li>`
    ).join('');
    P.qualityMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        changeVideoQuality(+b.dataset.idx);
        P.qualityMenu.hidden = true;
        P.quality.setAttribute('aria-expanded', 'false');
    }));
}

function changeVideoQuality(idx) {
    const src = currentSources[idx];
    if (!src) return;
    const time = videoPlayer.currentTime;
    const wasPlaying = !videoPlayer.paused;
    videoPlayer.src = src.file || src.src;
    videoPlayer.addEventListener('loadedmetadata', () => {
        videoPlayer.currentTime = time;
        if (wasPlaying) videoPlayer.play().catch(() => {});
    }, { once: true });
    videoPlayer.load();
    renderQualityMenu(idx);
}

function togglePlay() {
    if (videoPlayer.paused) videoPlayer.play().catch(() => {});
    else videoPlayer.pause();
}

function skip(seconds) {
    if (!isFinite(videoPlayer.duration)) return;
    videoPlayer.currentTime = Math.max(0, Math.min(videoPlayer.duration, videoPlayer.currentTime + seconds));
    wakeControls();
}

function updatePlayButton() {
    const paused = videoPlayer.paused;
    P.play.innerHTML = paused ? ICONS.play : ICONS.pause;
    P.play.setAttribute('aria-label', paused ? t('play') : t('pause'));
}

function updateMuteButton() {
    const muted = videoPlayer.muted || videoPlayer.volume === 0;
    P.mute.innerHTML = muted ? ICONS.mute : ICONS.vol;
    P.mute.setAttribute('aria-label', muted ? t('unmute') : t('mute'));
    P.volume.value = videoPlayer.muted ? 0 : videoPlayer.volume;
}

function updateTimeline() {
    const d = videoPlayer.duration;
    const cur = videoPlayer.currentTime;
    const pct = isFinite(d) && d > 0 ? (cur / d) * 100 : 0;
    P.fill.style.width = `${pct}%`;
    P.head.style.left = `${pct}%`;
    P.time.textContent = `${formatTime(cur)} / ${formatTime(d)}`;
    P.seek.setAttribute('aria-valuenow', pct.toFixed(0));
    P.seek.setAttribute('aria-valuetext', formatTime(cur));

    if (videoPlayer.buffered.length && isFinite(d) && d > 0) {
        P.buffer.style.width = `${(videoPlayer.buffered.end(videoPlayer.buffered.length - 1) / d) * 100}%`;
    }
}

function seekFromEvent(e) {
    const rect = P.seek.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return { ratio, x: ratio * rect.width };
}

function wakeControls() {
    playerEl.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        if (!videoPlayer.paused && P.qualityMenu.hidden) playerEl.classList.add('idle');
    }, 3000);
}

function saveProgress(force = false) {
    if (!currentMovieData || !isFinite(videoPlayer.duration) || videoPlayer.duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    const key = getWatchKey();
    if (key) writeJSON(key, {
        time: videoPlayer.currentTime,
        percent: (videoPlayer.currentTime / videoPlayer.duration) * 100
    });
}

async function playNextEpisode() {
    if (!currentMovieData?.isSeries) return;
    saveProgress(true);
    videoPlayer.pause();
    playerMessage(`<div class="spinner"></div><p class="player-msg">${t('findingNext')}</p>`);
    const moved = await stepEpisode(1);
    if (playerEl.hidden) return;
    if (!moved) {
        playerMessage(`<p class="player-msg">${t('lastEpisode')}</p><button class="btn" id="pTryOther">${t('backToDetail')}</button>`, true);
        $('pTryOther').addEventListener('click', () => closePlayer());
        return;
    }
    if (activeStreams.length) {
        startStreaming(activeStreams[0]);
    } else {
        playerMessage(`<p class="player-msg">${t('nextNotFound', { ep: episodeTag() })}</p><button class="btn" id="pTryOther">${t('backToDetail')}</button>`, true);
        $('pTryOther').addEventListener('click', () => closePlayer());
    }
}

// --- Události videa ---
videoPlayer.addEventListener('play', () => { updatePlayButton(); wakeControls(); });
videoPlayer.addEventListener('pause', () => { updatePlayButton(); wakeControls(); saveProgress(true); });
videoPlayer.addEventListener('playing', () => playerMessage(''));
videoPlayer.addEventListener('waiting', () => playerMessage('<div class="spinner"></div>'));
videoPlayer.addEventListener('timeupdate', () => { updateTimeline(); saveProgress(); });
videoPlayer.addEventListener('progress', updateTimeline);
videoPlayer.addEventListener('durationchange', updateTimeline);
videoPlayer.addEventListener('volumechange', updateMuteButton);
videoPlayer.addEventListener('ended', () => {
    saveProgress(true);
    if (currentMovieData?.isSeries) {
        playerMessage(`<p class="player-msg">${t('episodeEnded')}</p><button class="btn btn-primary" id="pEndedNext">${t('playNext')}</button>`, true);
        $('pEndedNext').addEventListener('click', playNextEpisode);
    }
});
videoPlayer.addEventListener('error', () => {
    if (playerEl.hidden || !videoPlayer.getAttribute('src')) return;
    playerMessage(`<p class="player-msg">${t('cantPlay')}</p><button class="btn" id="pTryOther">${t('pickOther')}</button>`, true);
    $('pTryOther').addEventListener('click', () => closePlayer());
});
// Na dotyku první klepnutí jen ukáže ovládání, myší klik rovnou pozastaví
let wasIdleOnPointer = false;
videoPlayer.addEventListener('pointerdown', (e) => {
    wasIdleOnPointer = e.pointerType !== 'mouse' && playerEl.classList.contains('idle');
});
videoPlayer.addEventListener('click', () => {
    if (wasIdleOnPointer) { wakeControls(); return; }
    togglePlay();
});
videoPlayer.addEventListener('dblclick', toggleFullscreen);

// --- Ovládací prvky ---
P.play.addEventListener('click', togglePlay);
P.back.addEventListener('click', () => skip(-10));
P.fwd.addEventListener('click', () => skip(10));
P.close.addEventListener('click', () => closePlayer());
P.next.addEventListener('click', playNextEpisode);
P.mute.addEventListener('click', () => {
    if (videoPlayer.muted || videoPlayer.volume === 0) {
        videoPlayer.muted = false;
        if (videoPlayer.volume === 0) videoPlayer.volume = 0.5;
    } else videoPlayer.muted = true;
});
P.volume.addEventListener('input', () => {
    videoPlayer.volume = +P.volume.value;
    videoPlayer.muted = +P.volume.value === 0;
    writeJSON('volume', videoPlayer.volume);
});
P.subs.addEventListener('click', () => {
    const track = videoPlayer.textTracks[0];
    if (!track) return;
    const on = track.mode !== 'showing';
    track.mode = on ? 'showing' : 'disabled';
    P.subs.setAttribute('aria-pressed', String(on));
});
P.quality.addEventListener('click', () => {
    const open = P.qualityMenu.hidden;
    P.qualityMenu.hidden = !open;
    P.quality.setAttribute('aria-expanded', String(open));
    wakeControls();
});
P.full.addEventListener('click', toggleFullscreen);

const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;

function toggleFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    } else if (playerEl.requestFullscreen) {
        playerEl.requestFullscreen()
            .then(() => {
                // Na telefonu ve fullscreenu otočit na šířku (Android; iPhone to neumí)
                if (IS_TOUCH && screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
            })
            .catch(() => {});
    } else if (videoPlayer.webkitEnterFullscreen) {
        videoPlayer.webkitEnterFullscreen(); // iPhone
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && screen.orientation?.unlock) {
        try { screen.orientation.unlock(); } catch { /* nepodporováno */ }
    }
    wakeControls();
});

// Posuvník – klik i tažení
let seeking = false;
P.seek.addEventListener('pointerdown', (e) => {
    if (!isFinite(videoPlayer.duration)) return;
    seeking = true;
    P.seek.setPointerCapture(e.pointerId);
    videoPlayer.currentTime = seekFromEvent(e).ratio * videoPlayer.duration;
});
P.seek.addEventListener('pointermove', (e) => {
    if (!isFinite(videoPlayer.duration)) return;
    const { ratio, x } = seekFromEvent(e);
    P.tip.hidden = false;
    P.tip.style.left = `${x}px`;
    P.tip.textContent = formatTime(ratio * videoPlayer.duration);
    if (seeking) videoPlayer.currentTime = ratio * videoPlayer.duration;
    wakeControls();
});
P.seek.addEventListener('pointerup', () => { seeking = false; });
P.seek.addEventListener('pointerleave', () => { if (!seeking) P.tip.hidden = true; });
P.seek.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); skip(-5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); skip(5); }
});

playerEl.addEventListener('pointermove', wakeControls);
playerEl.addEventListener('touchstart', wakeControls, { passive: true });

// Klávesové zkratky v přehrávači
document.addEventListener('keydown', (e) => {
    if (playerEl.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    const onButton = tag === 'BUTTON' || tag === 'INPUT';
    switch (e.key) {
        case ' ':
        case 'k':
            if (onButton && e.key === ' ') return; // mezerník na tlačítku ho stiskne
            e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': if (tag !== 'INPUT') { e.preventDefault(); skip(-10); } break;
        case 'ArrowRight': if (tag !== 'INPUT') { e.preventDefault(); skip(10); } break;
        case 'ArrowUp': e.preventDefault(); videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1); videoPlayer.muted = false; break;
        case 'ArrowDown': e.preventDefault(); videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1); break;
        case 'f': toggleFullscreen(); break;
        case 'm': videoPlayer.muted = !videoPlayer.muted; break;
        case 'c': if (!P.subs.hidden) P.subs.click(); break;
        case 'n': if (!P.next.hidden) playNextEpisode(); break;
        case 'Escape':
            if (!P.qualityMenu.hidden) { P.qualityMenu.hidden = true; P.quality.setAttribute('aria-expanded', 'false'); }
            else if (!document.fullscreenElement) closePlayer();
            break;
        default: return;
    }
    wakeControls();
});

// Uložení pozice při zavření záložky
window.addEventListener('pagehide', () => { if (!playerEl.hidden) saveProgress(true); });

// =====================================================
// Pozice sledování, historie, oblíbené
// (stejné klíče jako dřív – stará historie zůstane)
// =====================================================
function getWatchKey() {
    if (!currentMovieData) return '';
    return currentMovieData.isSeries
        ? `progress_${currentMovieData.title}_${episodeTag()}`
        : `progress_${currentMovieData.title}`;
}

function getWatchProgress() {
    const key = getWatchKey();
    return key ? readJSON(key, null) : null;
}

function getWatchProgressForCard(title, isSeries) {
    let key = `progress_${title}`;
    if (isSeries) {
        const lastEp = readJSON(`last_ep_${title}`, null);
        if (lastEp) key = `progress_${title}_${episodeTag(lastEp.season, lastEp.episode)}`;
    }
    return readJSON(key, null);
}

function loadLibrary() {
    const favorites = readJSON('favorites', []);
    const history = readJSON('watch_history', []);

    $('historySection').hidden = history.length === 0;
    $('favoritesSection').hidden = favorites.length === 0;
    $('homeIntro').hidden = history.length > 0 || favorites.length > 0;

    if (history.length) renderGrid(history, $('historyGrid'));
    if (favorites.length) renderGrid(favorites, $('favoritesGrid'));
    tvFocusFirst('#historyGrid .poster, #favoritesGrid .poster, #searchQuery', true);
}

// Do knihovny ukládáme jen to, co je potřeba pro kartu a detail
function libraryEntry(m) {
    const { title, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source } = m;
    return { title, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source };
}

function addToHistory(movie) {
    const history = readJSON('watch_history', []).filter(h => h.title !== movie.title);
    history.unshift(libraryEntry(movie));
    writeJSON('watch_history', history.slice(0, 20));
}

function isMovieInFavorites(title) {
    return readJSON('favorites', []).some(f => f.title === title);
}

function toggleFavoriteCurrent() {
    if (!currentMovieData) return;
    const favorites = readJSON('favorites', []);
    const idx = favorites.findIndex(f => f.title === currentMovieData.title);
    const added = idx === -1;

    if (added) favorites.unshift(libraryEntry(currentMovieData));
    else favorites.splice(idx, 1);
    writeJSON('favorites', favorites);

    const btn = $('favBtn');
    if (btn) {
        btn.setAttribute('aria-pressed', String(added));
        btn.querySelector('span').textContent = added ? t('inFavorites') : t('addFavorite');
    }
    toast(added ? t('added') : t('removed'), 2000);
}

// =====================================================
// Přepínání jazyka rozhraní
// =====================================================
function applyStaticI18n() {
    document.documentElement.lang = uiLang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.querySelectorAll('[data-ui-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.uiLang === uiLang)));
    updatePlayButton();
    updateMuteButton();
}

function setUiLang(lang) {
    if (lang !== 'cs' && lang !== 'en') return;
    uiLang = lang;
    writeJSON('ui_lang', lang);
    applyStaticI18n();
    setTvMode(isTv());
    updateOfflineTexts();

    // Překreslit, co je zrovna vidět
    if (!movieDetail.hidden && currentMovieData && $('playBtn')) {
        const loading = $('playBtn').disabled && !activeStreams.length && $('sourcesBody')?.querySelector('.status:not(.error)');
        renderDetail();
        if (activeStreams.length) renderSources();
        else if (loading) setPlayButton('loading');
        else fetchAndRenderStreams();
    } else if (!resultsContainer.hidden) {
        $('resultsTitle').textContent = t('resultsFor', { q: searchInput.value });
    }
    if (!playerEl.hidden && currentMovieData) {
        P.subtitle.textContent = currentMovieData.isSeries ? t('seasonEp', { s: currentSeason, e: currentEpisode }) : P.subtitle.textContent;
    }
}

document.querySelectorAll('[data-ui-lang]').forEach(b =>
    b.addEventListener('click', () => setUiLang(b.dataset.uiLang)));

// Jednorázové upozornění pro návštěvníky bez češtiny/slovenštiny v prohlížeči
function maybeShowForeignNotice() {
    if (BROWSER_CZSK || !FIRST_VISIT || readJSON('notice_seen', false)) return;
    const dlg = $('foreignNotice');
    if (!dlg || typeof dlg.showModal !== 'function') return;

    writeJSON('notice_seen', true);
    writeJSON('ui_lang', 'en');
    writeJSON('lang', 'en');

    $('noticeOk').addEventListener('click', () => dlg.close());
    $('noticeCs').addEventListener('click', () => { dlg.close(); setUiLang('cs'); });
    dlg.showModal();
    $('noticeOk').focus();
}

// =====================================================
// Výpadek serveru / připojení
// =====================================================
const offlineScreen = $('offlineScreen');
let offlineKind = null;          // null | 'server' | 'network'
let retryTimer = null;
let retryCountdown = null;
let checkingServer = false;

async function checkServer() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store', signal: ctrl.signal });
        // 404 = starší server bez /health, ale odpovídá → online
        return !OUTAGE_STATUSES.includes(res.status);
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

async function reportPossibleOutage() {
    if (offlineKind || checkingServer) return;
    checkingServer = true;
    const ok = navigator.onLine !== false && await checkServer();
    checkingServer = false;
    if (!ok) showOffline(navigator.onLine === false ? 'network' : 'server');
}

function showOffline(kind) {
    const first = !offlineKind;
    offlineKind = kind;
    document.body.classList.add('is-offline');
    offlineScreen.hidden = false;
    libraryContainer.hidden = true;
    resultsContainer.hidden = true;
    movieDetail.hidden = true;
    updateOfflineTexts();
    if (first) {
        if (!playerEl.hidden) closePlayer();
        window.scrollTo(0, 0);
        scheduleRetry(10);
        tvFocusFirst('#offlineRetry', true);
    }
}

function updateOfflineTexts() {
    if (!offlineKind) return;
    const net = offlineKind === 'network';
    $('offlineTitle').textContent = t(net ? 'offlineTitleNet' : 'offlineTitle');
    $('offlineText').textContent = t(net ? 'offlineTextNet' : 'offlineText');
}

function scheduleRetry(seconds) {
    clearTimeout(retryTimer);
    clearInterval(retryCountdown);
    let left = seconds;
    const status = $('offlineStatus');
    status.textContent = t('nextRetry', { s: left });
    retryCountdown = setInterval(() => {
        left = Math.max(0, left - 1);
        status.textContent = t('nextRetry', { s: left });
    }, 1000);
    retryTimer = setTimeout(retryConnection, seconds * 1000);
}

async function retryConnection() {
    clearTimeout(retryTimer);
    clearInterval(retryCountdown);
    $('offlineStatus').textContent = t('retrying');
    if (navigator.onLine !== false && await checkServer()) {
        hideOffline();
    } else {
        showOffline(navigator.onLine === false ? 'network' : 'server');
        scheduleRetry(15);
    }
}

function hideOffline() {
    if (!offlineKind) return;
    offlineKind = null;
    clearTimeout(retryTimer);
    clearInterval(retryCountdown);
    document.body.classList.remove('is-offline');
    offlineScreen.hidden = true;
    toast(t('backOnline'), 2500);
    renderRoute(history.state);   // znovu načíst, co bylo otevřené
}

$('offlineRetry').addEventListener('click', retryConnection);
window.addEventListener('offline', () => showOffline('network'));
window.addEventListener('online', () => { if (offlineKind) retryConnection(); });

// =====================================================
// Instalace aplikace (PWA)
// =====================================================
const installBtn = $('installBtn');
let deferredInstall = null;

const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;

function installHelpText() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return t('installIos');
    if (/Firefox\//.test(ua) && !/Android/.test(ua)) return t('installFirefox');
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return t('installMacSafari');
    return t('installGeneric');
}

installBtn.addEventListener('click', async () => {
    if (deferredInstall) {
        deferredInstall.prompt();
        const choice = await deferredInstall.userChoice.catch(() => null);
        deferredInstall = null;
        if (choice && choice.outcome === 'accepted') installBtn.hidden = true;
        return;
    }
    $('installText').textContent = installHelpText();
    const dlg = $('installDialog');
    if (typeof dlg.showModal === 'function') { dlg.showModal(); tvFocus($('installClose')); }
    else toast(installHelpText(), 8000);
});
$('installClose').addEventListener('click', () => $('installDialog').close());

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (!IS_STANDALONE) installBtn.hidden = false;
});
window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installBtn.hidden = true;
    toast(t('installed'), 3000);
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* bez SW web funguje dál */ });
    });
}

// =====================================================
// Režim pro televizi – ovládání šipkami (prostorová navigace)
// =====================================================
const TV_UA = /SMART-?TV|SmartTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|HbbTV|Roku|Viera|VIDAA|Hisense|Philips|PhilipsTV|Opera TV|NETTV|CrKey|AppleTV|Xbox|PlayStation/i;
const KEY = {
    left: [37, 'ArrowLeft', 'Left'], up: [38, 'ArrowUp', 'Up'], right: [39, 'ArrowRight', 'Right'], down: [40, 'ArrowDown', 'Down'],
    ok: [13, 'Enter'],
    back: [27, 461, 10009, 'Escape', 'GoBack', 'BrowserBack', 'XF86Back'],
    playPause: [179, 10252, 'MediaPlayPause'], play: [415, 'MediaPlay'], pause: [19, 'MediaPause'],
    ff: [417, 'MediaFastForward'], rew: [412, 'MediaRewind'], stop: [413, 'MediaStop'], next: [176, 'MediaTrackNext']
};
function keyIs(e, name) { return KEY[name].includes(e.key) || KEY[name].includes(e.keyCode); }

function isTv() { return document.documentElement.classList.contains('tv'); }

function initialTvMode() {
    const param = new URLSearchParams(location.search).get('tv');
    if (param === '1' || param === '0') writeJSON('tv_mode', param === '1');
    const saved = readJSON('tv_mode', null);
    if (typeof saved === 'boolean') return saved;
    return TV_UA.test(navigator.userAgent);
}

function setTvMode(on, announce = false) {
    document.documentElement.classList.toggle('tv', on);
    const btn = $('tvToggle');
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span').textContent = t(on ? 'tvModeOff' : 'tvModeOn');
    if (announce) {
        writeJSON('tv_mode', on);
        toast(t(on ? 'tvEnabled' : 'tvDisabled'), 3000);
        if (on) tvFocusFirst('#main .poster, #playBtn, #searchQuery', true);
    }
}
$('tvToggle').addEventListener('click', () => setTvMode(!isTv(), true));

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function isVisible(el) {
    if (!el || el === document.body || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden';
}

function focusScope() {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) return dlg;
    if (!playerEl.hidden) return playerEl;
    return document.body;
}

function focusCandidates() {
    const scope = focusScope();
    return Array.from(scope.querySelectorAll(FOCUSABLE)).filter(el =>
        isVisible(el) && !el.closest('[hidden]') && (scope !== document.body || !playerEl.contains(el)));
}

function tvFocus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    if (!isTv()) return;
    // posunout jen obsah, ne lištu nahoře
    if (!el.closest('.topbar') && !el.closest('.player')) {
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); }
        catch { el.scrollIntoView(false); }
    }
}

// Na TV po změně obrazovky přesunout výběr na první rozumný prvek
function tvFocusFirst(selector, onlyIfLost = false) {
    if (!isTv()) return;
    const active = document.activeElement;
    if (onlyIfLost && isVisible(active) && active !== document.body && focusScope().contains(active)
        && !active.closest('[hidden]')) return;
    const el = Array.from(document.querySelectorAll(selector)).find(n => isVisible(n) && !n.closest('[hidden]'));
    if (el) tvFocus(el);
}

// Najde nejbližší prvek ve směru šipky
function moveFocus(dir) {
    const cands = focusCandidates();
    if (!cands.length) return;
    const cur = document.activeElement;
    if (!cands.includes(cur)) { tvFocus(cands[0]); return; }

    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;

    for (const el of cands) {
        if (el === cur || el.contains(cur) || cur.contains(el)) continue;
        const c = el.getBoundingClientRect();
        const ex = c.left + c.width / 2, ey = c.top + c.height / 2;
        let primary, overlapGap;
        if (dir === 'right') { if (ex <= cx + 1 || c.left < r.left + 1) continue; primary = Math.max(0, c.left - r.right); overlapGap = Math.max(0, Math.max(r.top, c.top) - Math.min(r.bottom, c.bottom)); }
        if (dir === 'left')  { if (ex >= cx - 1 || c.right > r.right - 1) continue; primary = Math.max(0, r.left - c.right); overlapGap = Math.max(0, Math.max(r.top, c.top) - Math.min(r.bottom, c.bottom)); }
        if (dir === 'down')  { if (ey <= cy + 1 || c.top < r.top + 1) continue; primary = Math.max(0, c.top - r.bottom); overlapGap = Math.max(0, Math.max(r.left, c.left) - Math.min(r.right, c.right)); }
        if (dir === 'up')    { if (ey >= cy - 1 || c.bottom > r.bottom - 1) continue; primary = Math.max(0, r.top - c.bottom); overlapGap = Math.max(0, Math.max(r.left, c.left) - Math.min(r.right, c.right)); }
        const centerOffset = (dir === 'left' || dir === 'right') ? Math.abs(ey - cy) : Math.abs(ex - cx);
        const score = primary + overlapGap * 4 + centerOffset * 0.1;
        if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) tvFocus(best);
}

// Viditelný rámeček kolem vybraného prvku (bez :focus-visible kvůli starším TV)
document.addEventListener('focusin', (e) => {
    document.querySelectorAll('.tv-focus').forEach(n => n.classList.remove('tv-focus'));
    if (isTv() && e.target && e.target.classList) e.target.classList.add('tv-focus');
});
document.addEventListener('focusout', (e) => {
    if (e.target && e.target.classList) e.target.classList.remove('tv-focus');
});

function tvBack() {
    const dlg = document.querySelector('dialog[open]');
    if (dlg) { dlg.close(); return true; }
    if (!playerEl.hidden) { closePlayer(); return true; }
    const view = history.state && history.state.view;
    if (view && view !== 'home') { history.back(); return true; }
    return false; // domovská obrazovka – nechat TV, ať aplikaci zavře
}

function handleTvPlayerKey(e) {
    const idle = playerEl.classList.contains('idle');
    const active = document.activeElement;
    const onSeek = active === P.seek;
    const inMenu = !P.qualityMenu.hidden && P.qualityMenu.contains(active);
    const dir = keyIs(e, 'left') ? 'left' : keyIs(e, 'right') ? 'right' : keyIs(e, 'up') ? 'up' : keyIs(e, 'down') ? 'down' : null;

    if (keyIs(e, 'playPause')) { togglePlay(); return true; }
    if (keyIs(e, 'play')) { videoPlayer.play().catch(() => {}); return true; }
    if (keyIs(e, 'pause')) { videoPlayer.pause(); return true; }
    if (keyIs(e, 'ff')) { skip(30); return true; }
    if (keyIs(e, 'rew')) { skip(-30); return true; }
    if (keyIs(e, 'next')) { if (!P.next.hidden) playNextEpisode(); return true; }
    if (keyIs(e, 'stop')) { closePlayer(); return true; }

    if (keyIs(e, 'back')) {
        if (!P.qualityMenu.hidden) { P.qualityMenu.hidden = true; P.quality.setAttribute('aria-expanded', 'false'); tvFocus(P.quality); return true; }
        closePlayer();
        return true;
    }

    if (keyIs(e, 'ok')) {
        // Tlačítka v přehrávači se stisknou sama, jinde OK = pauza/přehrát
        if (idle || onSeek || !active || active === document.body || active === videoPlayer) {
            togglePlay();
            wakeControls();
            return true;
        }
        return false;
    }

    if (dir) {
        // Skryté ovládání nebo výběr na časové ose: šipky do stran přetáčí
        if ((dir === 'left' || dir === 'right') && (idle || onSeek || !playerEl.contains(active))) {
            skip(dir === 'left' ? -10 : 10);
            if (!onSeek) tvFocus(P.seek);
            return true;
        }
        if (idle || !playerEl.contains(active)) {
            wakeControls();
            tvFocus(dir === 'down' ? P.play : P.seek);
            return true;
        }
        if (inMenu || playerEl.contains(active)) {
            moveFocus(dir);
            wakeControls();
            return true;
        }
    }
    return false;
}

document.addEventListener('keydown', (e) => {
    if (!isTv() || e.ctrlKey || e.metaKey || e.altKey) return;

    const done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const active = document.activeElement;
    const tag = active && active.tagName;

    if (!playerEl.hidden) {
        if (handleTvPlayerKey(e)) done();
        return;
    }

    // Výběr řady/dílu: OK přepne do úprav, šipky nahoru/dolů mění hodnotu
    if (tag === 'SELECT') {
        if (active.classList.contains('tv-editing')) {
            if (keyIs(e, 'up') || keyIs(e, 'down')) {
                const step = keyIs(e, 'up') ? -1 : 1;
                const i = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + step));
                if (i !== active.selectedIndex) { active.selectedIndex = i; active.dispatchEvent(new Event('change', { bubbles: true })); }
                return done();
            }
            if (keyIs(e, 'ok') || keyIs(e, 'back') || keyIs(e, 'left') || keyIs(e, 'right')) {
                active.classList.remove('tv-editing');
                if (keyIs(e, 'left') || keyIs(e, 'right')) moveFocus(keyIs(e, 'left') ? 'left' : 'right');
                return done();
            }
        } else if (keyIs(e, 'ok')) {
            active.classList.add('tv-editing');
            return done();
        }
    }

    // Vyhledávací pole: šipky do stran posouvají kurzor v textu
    if (tag === 'INPUT') {
        if (keyIs(e, 'left') || keyIs(e, 'right')) return;
        if (keyIs(e, 'back') && e.key === 'Backspace') return;
    }

    if (keyIs(e, 'back')) {
        if (e.key === 'Backspace' && (tag === 'INPUT' || tag === 'TEXTAREA')) return;
        if (tvBack()) done();
        return;
    }
    if (keyIs(e, 'left')) { moveFocus('left'); return done(); }
    if (keyIs(e, 'right')) { moveFocus('right'); return done(); }
    if (keyIs(e, 'up')) { moveFocus('up'); return done(); }
    if (keyIs(e, 'down')) { moveFocus('down'); return done(); }
}, true);

// =====================================================
// Start
// =====================================================
(function init() {
    // Zvuk: uložená volba, jinak u cizinců rovnou původní znění
    const savedAudio = readJSON('lang', null);
    selectedLanguage = savedAudio === 'en' || savedAudio === 'cz' ? savedAudio : (BROWSER_CZSK ? 'cz' : 'en');
    applyStaticI18n();
    setTvMode(initialTvMode());
    if (!isTv()) maybeShowForeignNotice();

    // Tlačítko "Stáhnout aplikaci": ne v nainstalované aplikaci a ne na TV
    installBtn.hidden = IS_STANDALONE || isTv();

    if (navigator.onLine === false) showOffline('network');
    else checkServer().then(ok => { if (!ok) showOffline('server'); });

    const vol = readJSON('volume', null);
    if (typeof vol === 'number') videoPlayer.volume = Math.max(0, Math.min(1, vol));
    updatePlayButton();
    updateMuteButton();

    const hashQuery = location.hash.match(/^#hledat=(.+)$/);
    if (hashQuery) {
        history.replaceState({ view: 'results', q: decodeURIComponent(hashQuery[1]) }, '', location.href);
        search(decodeURIComponent(hashQuery[1]), false);
    } else {
        history.replaceState({ view: 'home' }, '', location.pathname);
        showMainPage(false);
    }
})();
