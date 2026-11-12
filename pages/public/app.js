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
        loadingEpisodes: 'Načítám díly…', lastEpisode: 'Tohle byl poslední díl seriálu.',
        popularMovies: 'Nejnavštěvovanější filmy', popularSeries: 'Nejnavštěvovanější seriály',
        topMovies: 'Nejlépe hodnocené filmy', topSeries: 'Nejlépe hodnocené seriály',
        genresTitle: 'Žánry', becauseWatched: 'Protože jsi sledoval {title}', seeAll: 'Zobrazit vše',
        typeMovies: 'Filmy', typeSeries: 'Seriály', discoverFailed: 'Nabídku z ČSFD se teď nepodařilo načíst.',
        listEmpty: 'Tady zatím nic není.', scrollLeft: 'Posunout doleva', scrollRight: 'Posunout doprava',
        exitFullscreen: 'Ukončit celou obrazovku',
        kbLabel: 'Klávesnice', kbSpace: 'Mezera', kbDelete: 'Smazat', kbClear: 'Vymazat vše', kbSearch: 'Hledat',
        kbPlaceholder: 'Napiš název filmu nebo seriálu',
        kbHint: 'Čísla na ovladači píšou jako na mobilu: opakovaným stiskem 2 napíšeš a, b, c…',
        removeFromHistory: 'Odebrat z historie', removedFromHistory: 'Odebráno z historie: {title}',
        notAvailable: 'Tento titul na Moviora není dostupný.',
        homeTitle: 'Moviora – filmy a seriály online', mainNav: 'Hlavní nabídka', tabHome: 'Domů', tabSeries: 'Seriály', tabMovies: 'Filmy', tabFavorites: 'Oblíbené', tabContinue: 'Pokračovat',
        heroLast: 'Naposledy jsi sledoval', heroPopular: 'Teď nejsledovanější', heroResume: 'Pokračovat', heroResumeEp: 'Pokračovat {ep}',
        heroPlayEp: 'Přehrát {ep}', heroDetail: 'Detail', heroLeft: 'Zbývá {t}', heroMore: 'Další nabídka',
        favoritesEmpty: 'Oblíbené zatím nemáš. Přidáš je hvězdičkou v detailu filmu nebo seriálu.',
        continueEmpty: 'Tady se objeví, co začneš sledovat – i s místem, kde jsi skončil.',
        removeFromFavorites: 'Odebrat z oblíbených', removedFromFavorites: 'Odebráno z oblíbených: {title}',
        filters: 'Filtry', filterType: 'Typ', filterAll: 'Vše', filterGenre: 'Žánr', anyGenre: 'Všechny žánry', filterYear: 'Rok vydání',
        applyFilters: 'Zobrazit', clearFilters: 'Zrušit filtry', editFilters: 'Upravit filtry', removeFilter: 'Zrušit filtr',
        browseTitle: 'Procházet', yearsFrom: 'od {y}', yearsTo: 'do {y}',
        filteredCount: 'Filtrům odpovídá {n} z {total}', noFilterMatch: 'Filtrům nic neodpovídá. Zkus je upravit nebo zrušit.',
        options: 'Možnosti', close: 'Zavřít', cancel: 'Zrušit', back: 'Zpět',
        optProfile: 'Profil', optProfileNote: 'Historie, rozkoukané díly, oblíbené a nastavení se ukládají jen v tomhle prohlížeči. Profil si můžeš uložit do souboru a načíst jinde.',
        exportProfile: 'Exportovat profil', exportProfileSub: 'Uloží soubor .mw', importProfile: 'Importovat profil',
        importProfileSub: 'Načte soubor .mw a sloučí ho s tímto profilem', exported: 'Profil uložen do souboru {f}',
        importDone: 'Profil načten – v historii {h}, v oblíbených {f}', importBad: 'Tohle není platný soubor profilu Moviora.',
        optSync: 'Rychlá synchronizace', optSyncNote: 'Přenese profil do jiného zařízení pomocí kódu. Na našem serveru zůstane nejvýš minutu a po přenesení se hned smaže.',
        syncSend: 'Odeslat z tohoto zařízení', syncSendSub: 'Dostaneš šestimístný kód', syncReceive: 'Přijmout do tohoto zařízení',
        syncReceiveSub: 'Zadáš kód z druhého zařízení', syncCodeHelp: 'Na druhém zařízení otevři Možnosti → Přijmout do tohoto zařízení a zadej kód:',
        syncLeft: 'Kód platí ještě {s} s', syncExpired: 'Kód vypršel. Pokud se profil nepřenesl, vytvoř nový.',
        syncCodeLabel: 'Kód z druhého zařízení', syncReceiveBtn: 'Přijmout profil', syncFailed: 'Synchronizace se nepovedla: {e}',
        syncInvalidCode: 'Zadej šestimístný kód.', optApp: 'Aplikace', installAppSub: 'Moviora jako aplikace na ploše',
        tvModeSub: 'Ovládání šipkami a dálkovým ovladačem',
        share: 'Sdílet', linkCopied: 'Odkaz zkopírován', sharedLoading: 'Otevírám sdílený titul…',
        sharedNotFound: 'Sdílený film se nepodařilo najít.', goHome: 'Na hlavní stránku'
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
        loadingEpisodes: 'Loading episodes…', lastEpisode: 'That was the last episode of the series.',
        popularMovies: 'Most viewed movies', popularSeries: 'Most viewed TV shows',
        topMovies: 'Top rated movies', topSeries: 'Top rated TV shows',
        genresTitle: 'Genres', becauseWatched: 'Because you watched {title}', seeAll: 'See all',
        typeMovies: 'Movies', typeSeries: 'TV shows', discoverFailed: 'Couldn’t load recommendations from ČSFD right now.',
        listEmpty: 'Nothing here yet.', scrollLeft: 'Scroll left', scrollRight: 'Scroll right',
        exitFullscreen: 'Exit full screen',
        kbLabel: 'Keyboard', kbSpace: 'Space', kbDelete: 'Delete', kbClear: 'Clear', kbSearch: 'Search',
        kbPlaceholder: 'Type a movie or show title',
        kbHint: 'Number keys on the remote type like an old phone: press 2 repeatedly for a, b, c…',
        removeFromHistory: 'Remove from history', removedFromHistory: 'Removed from history: {title}',
        notAvailable: 'This title isn’t available on Moviora.',
        homeTitle: 'Moviora – movies and TV shows online', mainNav: 'Main menu', tabHome: 'Home', tabSeries: 'TV shows', tabMovies: 'Movies', tabFavorites: 'Favourites', tabContinue: 'Continue',
        heroLast: 'You last watched', heroPopular: 'Most watched right now', heroResume: 'Resume', heroResumeEp: 'Resume {ep}',
        heroPlayEp: 'Play {ep}', heroDetail: 'Details', heroLeft: '{t} left', heroMore: 'More to watch',
        favoritesEmpty: 'No favourites yet. Add them with the star on a movie or show page.',
        continueEmpty: 'Anything you start watching shows up here, along with where you left off.',
        removeFromFavorites: 'Remove from favourites', removedFromFavorites: 'Removed from favourites: {title}',
        filters: 'Filters', filterType: 'Type', filterAll: 'All', filterGenre: 'Genre', anyGenre: 'All genres', filterYear: 'Release year',
        applyFilters: 'Show results', clearFilters: 'Clear filters', editFilters: 'Edit filters', removeFilter: 'Remove filter',
        browseTitle: 'Browse', yearsFrom: 'from {y}', yearsTo: 'until {y}',
        filteredCount: '{n} of {total} match your filters', noFilterMatch: 'Nothing matches your filters. Try changing or clearing them.',
        options: 'Options', close: 'Close', cancel: 'Cancel', back: 'Back',
        optProfile: 'Profile', optProfileNote: 'History, episode progress, favourites and settings are stored only in this browser. You can save your profile to a file and load it somewhere else.',
        exportProfile: 'Export profile', exportProfileSub: 'Saves a .mw file', importProfile: 'Import profile',
        importProfileSub: 'Loads a .mw file and merges it into this profile', exported: 'Profile saved as {f}',
        importDone: 'Profile loaded – {h} in history, {f} in favourites', importBad: 'This isn’t a valid Moviora profile file.',
        optSync: 'Quick sync', optSyncNote: 'Moves your profile to another device with a code. It stays on our server for a minute at most and is deleted as soon as it’s transferred.',
        syncSend: 'Send from this device', syncSendSub: 'You’ll get a six-digit code', syncReceive: 'Receive on this device',
        syncReceiveSub: 'Enter the code from your other device', syncCodeHelp: 'On your other device, open Options → Receive on this device and enter:',
        syncLeft: 'Code valid for {s} more s', syncExpired: 'The code expired. If the profile didn’t transfer, create a new one.',
        syncCodeLabel: 'Code from your other device', syncReceiveBtn: 'Receive profile', syncFailed: 'Sync failed: {e}',
        syncInvalidCode: 'Enter the six-digit code.', optApp: 'App', installAppSub: 'Moviora as an app on your desktop or home screen',
        tvModeSub: 'Control with arrow keys and a remote',
        share: 'Share', linkCopied: 'Link copied', sharedLoading: 'Opening shared title…',
        sharedNotFound: 'Couldn’t find the shared title.', goHome: 'Go to home page'
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
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
    fsEnter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
    backspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 5H8l-6 7 6 7h13z"/><path d="M12 9l6 6M18 9l-6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
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

// V angličtině ukázat anglický (nebo původní) název, když ho známe. Hledání zdrojů dál používá český.
function displayTitle(m) {
    if (!m) return '';
    if (uiLang === 'en') return m.titleEn || (m.source === 'imdb' ? m.title : m.originalTitle) || m.title || '';
    return m.title || '';
}

// Text pro porovnávání: malá písmena, bez diakritiky, oddělovače jako mezery
const normText = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[._\-+()\[\]{}|,:;!?'"\/]+/g, ' ').replace(/\s+/g, ' ').trim();

// Jazyk souboru podle názvu
function languageInfo(fileTitle) {
    const n = ` ${normText(fileTitle)} `;
    const enDub = /\b(eng?|english|anglicky)\s*(dab|dabing)\b|\b(engdab|endab|engdabing)\b/.test(n);
    const en = enDub || /\b(eng?|english|anglicky|anglictina|angl|orig|original|originalni zneni)\b/.test(n);
    const czSub = /\b(cz|cze|czech|cs)\s*(tit|titl|titulky|sub|subs|subtitles)\b|\b(cztit|czsub|titulky)\b/.test(n);
    // „dabing“ bez jazyka = český, ale ne když jde o anglický nebo slovenský dabing
    const withoutEnDub = n.replace(/\b(eng?|english|anglicky|sk|slovensky)\s*(dab|dabing)\b/g, ' ');
    const czDub = /\b(cz|cze|czech)\s*(dab|dabing)\b|\b(czdab|czdabing|cesky|cestina)\b|\bdabing\b/.test(withoutEnDub)
        || (/\b(cz|cze)\b/.test(withoutEnDub) && !czSub);
    const skDub = /\b(sk)\s*(dab|dabing)\b|\b(skdab|slovensky)\b/.test(n);
    return { en, enDub, czDub, czSub, skDub };
}

// Číslo dílu v názvu souboru (S01E02, 1x02)
function episodeCodeOf(fileTitle) {
    const n = normText(fileTitle);
    let m = n.match(/\bs\s?(\d{1,2})\s?e\s?(\d{1,3})\b/);
    if (m) return { s: +m[1], e: +m[2] };
    m = n.match(/\b(\d{1,2})x(\d{1,3})\b/);
    if (m) return { s: +m[1], e: +m[2] };
    return null;
}

function detectQuality(title) {
    if (/2160p|\b4k\b|uhd/i.test(title)) return { label: '4K', cls: 'uhd' };
    if (/1080p|full\s?hd|fhd/i.test(title)) return { label: '1080p', cls: '' };
    if (/720p|\bhd\b/i.test(title)) return { label: '720p', cls: '' };
    if (/480p|dvdrip|xvid/i.test(title)) return { label: '480p', cls: '' };
    return { label: 'SD', cls: '' };
}

function detectLanguage(title) {
    const l = languageInfo(title);
    if (l.czDub) return 'CZ';
    if (l.skDub) return 'SK';
    if (l.en) return 'EN';
    if (l.czSub || /\b(tit|sub|subs)\b/i.test(title)) return 'TIT';
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
    const l = languageInfo(stream.title);
    if (lang === 'cz') {
        if (l.czDub) score += 150;
        else if (l.skDub) score += 60;
        else if (l.en) score -= 250;
        else if (l.czSub) score -= 60;          // původní zvuk s titulky
    } else {
        if (l.enDub) score += 170;
        else if (l.en) score += 150;
        else if (l.czSub) score += 80;          // původní zvuk + české titulky
        if (l.czDub && !l.en) score -= 250;
        // původní / anglický název v souboru
        const orig = normText(movie.titleEn || movie.originalTitle);
        if (orig && orig !== normText(movie.title) && orig.length >= 3 && normText(stream.title).includes(orig)) score += 60;
    }

    // Seriály: správný díl a jeho název
    if (movie.isSeries) {
        const code = episodeCodeOf(stream.title);
        if (code) score += (code.s === currentSeason && code.e === currentEpisode) ? 80 : -300;
        const epName = normText(currentEpisodeTitle());
        if (epName.length >= 4 && normText(stream.title).includes(epName)) score += 120;
    }

    // Ukázky a soundtracky
    if (/soundtrack|trailer|ukázka|\bost\b/i.test(fullText)) score -= 400;

    return score;
}

// =====================================================
// Navigace: záložky, historie prohlížeče, odkazy v adrese
// =====================================================
const TABS = ['home', 'series', 'movies', 'favorites', 'continue'];
const TAB_HASH = { home: '', series: '#serialy', movies: '#filmy', favorites: '#oblibene', continue: '#pokracovat' };
const TAB_LABEL = { home: 'tabHome', series: 'tabSeries', movies: 'tabMovies', favorites: 'tabFavorites', continue: 'tabContinue' };
let currentTab = 'home';

function setView(view) {
    if (view !== 'results') $('resultsTools').innerHTML = '';
    libraryContainer.hidden = view !== 'home';
    resultsContainer.hidden = view !== 'results';
    movieDetail.hidden = view !== 'detail';
    $('hero').hidden = !(view === 'home' && currentTab === 'home');
    updateTabs(view === 'home' ? currentTab : null);
    window.scrollTo({ top: 0 });
}

function updateTabs(active) {
    document.querySelectorAll('[data-tab]').forEach(b => {
        if (b.dataset.tab === active) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
    });
}

function showTab(tab = 'home', push = true) {
    if (!TABS.includes(tab)) tab = 'home';
    currentTab = tab;
    if (push) history.pushState({ view: 'home', tab }, '', TAB_HASH[tab] || location.pathname);
    document.title = tab === 'home' ? t('homeTitle') : `${t(TAB_LABEL[tab])} – Moviora`;
    searchInput.value = '';
    setView('home');
    loadLibrary();
}

function showMainPage(push = true) {
    showTab('home', push);
}

document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.tab === currentTab && !libraryContainer.hidden) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    showTab(b.dataset.tab);
}));

let suppressNextPop = false;

window.addEventListener('popstate', (e) => {
    if (suppressNextPop) { suppressNextPop = false; return; }

    // Zpět při otevřeném přehrávači jen zavře přehrávač
    if (!playerEl.hidden && !(e.state && e.state.player)) {
        closePlayer(true);
        return;
    }
    if (!e.state) { routeFromHash(false); return; }
    renderRoute(e.state);
});

// Adresu změnil někdo jiný než aplikace (vložený odkaz, ruční úprava)
window.addEventListener('hashchange', () => {
    if (history.state && history.state.view) return;
    routeFromHash(false);
});

function renderRoute(state) {
    state = state || { view: 'home' };
    if (state.view === 'results' && state.q) return search(state.q, false, state.filters || emptyFilters());
    if (state.view === 'browse') { searchFilters = { ...emptyFilters(), ...(state.filters || {}) }; return browse(false); }
    if (state.view === 'list' && state.list) return openList(state.list, false);
    if (state.view === 'genre' && state.id) return openGenre(state.id, state.name, state.type, false);
    if (state.view === 'detail' && state.movie) return openMovieDetail(state.movie, false);
    if (state.view === 'shared' && state.spec) return openShared(state.spec);
    showTab(state.tab || 'home', false);
}

// #film=tt0133093&9499, #hledat=matrix&typ=movie, #prochazet&zanr=1, #filmy…
function stateFromHash(hash) {
    let m;
    if ((m = hash.match(/^#film=([^#]+)$/))) return { view: 'shared', spec: decodeURIComponent(m[1]) };
    if ((m = hash.match(/^#hledat=([^&]+)(?:&(.*))?$/))) {
        let q = m[1];
        try { q = decodeURIComponent(q); } catch { /* neplatné kódování */ }
        return { view: 'results', q, filters: filtersFromParams(m[2]) };
    }
    if ((m = hash.match(/^#prochazet(?:&(.*))?$/))) return { view: 'browse', filters: filtersFromParams(m[1]) };
    if (/^#(top|popular)-(movies|series)$/.test(hash)) return { view: 'list', list: hash.slice(1) };
    const tab = TABS.find(k => TAB_HASH[k] && TAB_HASH[k] === hash);
    if (tab) return { view: 'home', tab };
    return null;
}

function routeFromHash(isInit) {
    const state = stateFromHash(location.hash);
    if (!state) {
        history.replaceState({ view: 'home', tab: 'home' }, '', location.pathname + (isInit ? location.search : ''));
        showTab('home', false);
        return;
    }
    if (isInit && !(state.view === 'home' && state.tab === 'home')) {
        // pod otevřený odkaz vložit domovskou stránku, ať tlačítko Zpět nevede pryč z webu
        const url = location.href;
        history.replaceState({ view: 'home', tab: 'home' }, '', location.pathname + location.search);
        history.pushState(state, '', url);
    } else {
        history.replaceState(state, '', location.href);
    }
    renderRoute(state);
}

// Sdílený odkaz: dohledat film podle IMDb a/nebo ČSFD id
async function openShared(spec) {
    const parts = String(spec).split(/[&,;]/).map(s => s.trim());
    const imdb = parts.find(p => /^tt\d{5,10}$/.test(p));
    const csfdId = parts.find(p => /^\d{1,9}$/.test(p));
    if (!imdb && !csfdId) { showTab('home', false); return; }

    const reqId = ++detailRequestId;
    document.title = 'Moviora';
    setView('detail');
    $('detailBackdrop').style.backgroundImage = 'none';
    detailContent.innerHTML = `<p class="status">${t('sharedLoading')}</p>`;
    try {
        const qs = [imdb ? `imdb=${imdb}` : '', csfdId ? `csfd=${csfdId}` : ''].filter(Boolean).join('&');
        const d = await apiGet(`/resolve?${qs}`);
        if (reqId !== detailRequestId) return;
        if (!d.movie) throw new Error(d.error || '');
        if (history.state && history.state.view === 'shared') history.replaceState({ view: 'detail', movie: d.movie }, '', location.href);
        openMovieDetail(d.movie, false);
    } catch {
        if (reqId !== detailRequestId) return;
        detailContent.innerHTML = `<p class="status error">${t('sharedNotFound')}</p><button type="button" class="btn" id="sharedHome">${t('goHome')}</button>`;
        $('sharedHome').addEventListener('click', () => showTab('home'));
        tvFocusFirst('#sharedHome');
    }
}

// Odkaz pro sdílení: https://moviora.win/#film=tt0133093&9499 (jen to, co známe)
function shareIdsOf(m) {
    if (!m) return [];
    const imdb = (String(m.imdbLink || m.imdb_url || m.imdbUrl || '').match(/tt\d{5,10}/) || [])[0];
    const csfdId = (String(m.csfd_url || m.csfdLink || m.csfdUrl || '').match(/\/film\/(\d+)/) || [])[1];
    return [imdb, csfdId].filter(Boolean);
}
const filmHash = (m) => { const ids = shareIdsOf(m); return ids.length ? `#film=${ids.join('&')}` : '#film'; };

async function shareCurrent() {
    const m = currentMovieData;
    const ids = shareIdsOf(m);
    if (!ids.length) return;
    const url = `${location.origin}/#film=${ids.join('&')}`;
    if (navigator.share && IS_TOUCH) {
        try { await navigator.share({ title: `${displayTitle(m)} – Moviora`, url }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
        await navigator.clipboard.writeText(url);
        toast(t('linkCopied'), 2500);
    } catch {
        // starší prohlížeče: přes skryté textové pole
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* nejde */ }
        ta.remove();
        toast(ok ? t('linkCopied') : url, ok ? 2500 : 9000);
    }
}

// =====================================================
// Vyhledávání a filtry
// =====================================================
$('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearchOrBrowse();
});

$('brandLink').addEventListener('click', (e) => {
    e.preventDefault();
    showTab('home');
});

// "/" skočí do vyhledávání
document.addEventListener('keydown', (e) => {
    if (e.key === '/' && playerEl.hidden && !document.querySelector('dialog[open]') && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

const emptyFilters = () => ({ type: 'all', genre: null, genreName: '', yearFrom: null, yearTo: null });
let searchFilters = emptyFilters();
let filterGenres = [];
let resultsViewId = 0;

const normalizeYear = (v) => { const n = parseInt(v, 10); return n >= 1880 && n <= 2100 ? n : null; };

function filtersActiveCount(f = searchFilters) {
    return (f.type !== 'all' ? 1 : 0) + (f.genre ? 1 : 0) + (f.yearFrom || f.yearTo ? 1 : 0);
}

function filtersToParams(f = searchFilters) {
    const p = [];
    if (f.type !== 'all') p.push(`typ=${f.type}`);
    if (f.genre) p.push(`zanr=${f.genre}`);
    if (f.yearFrom) p.push(`od=${f.yearFrom}`);
    if (f.yearTo) p.push(`do=${f.yearTo}`);
    return p.join('&');
}

function filtersFromParams(str) {
    const f = emptyFilters();
    String(str || '').split('&').forEach(part => {
        const [k, v] = part.split('=');
        if (k === 'typ' && (v === 'movie' || v === 'series')) f.type = v;
        if (k === 'zanr' && /^\d+$/.test(v || '')) f.genre = +v;
        if (k === 'od') f.yearFrom = normalizeYear(v);
        if (k === 'do') f.yearTo = normalizeYear(v);
    });
    return f;
}

function updateFilterBadge() {
    const n = filtersActiveCount();
    $('filterBadge').hidden = !n;
    $('filterBadge').textContent = String(n);
    $('filterBtn').classList.toggle('active', n > 0);
}

async function loadFilterGenres() {
    if (!filterGenres.length) {
        try { filterGenres = (await getDiscover()).genres || []; } catch { /* bez žánrů */ }
    }
    return filterGenres;
}

async function ensureGenreName(f) {
    if (f.genre && !f.genreName) {
        const g = (await loadFilterGenres()).find(x => x.id === f.genre);
        if (g) f.genreName = g.name;
    }
    return f;
}

function setFilterType(type) {
    document.querySelectorAll('[data-ftype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ftype === type)));
}
document.querySelectorAll('[data-ftype]').forEach(b => b.addEventListener('click', () => setFilterType(b.dataset.ftype)));

async function openFilters() {
    const dlg = $('filterDialog');
    setFilterType(searchFilters.type);
    const sel = $('fGenre');
    const genres = await loadFilterGenres();
    sel.innerHTML = `<option value="">${t('anyGenre')}</option>` +
        genres.map(g => `<option value="${g.id}">${escapeHtml(genreLabel(g.name))}</option>`).join('');
    sel.value = searchFilters.genre ? String(searchFilters.genre) : '';
    $('fYearFrom').value = searchFilters.yearFrom || '';
    $('fYearTo').value = searchFilters.yearTo || '';
    $('fYearTo').placeholder = String(new Date().getFullYear());
    if (dlg.open) return;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    tvFocus(dlg.querySelector('[data-ftype][aria-pressed="true"]'));
}

$('filterBtn').addEventListener('click', openFilters);

$('filterForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const genreId = $('fGenre').value ? +$('fGenre').value : null;
    let from = normalizeYear($('fYearFrom').value);
    let to = normalizeYear($('fYearTo').value);
    if (from && to && from > to) [from, to] = [to, from];
    const pressed = document.querySelector('[data-ftype][aria-pressed="true"]');
    searchFilters = {
        type: pressed ? pressed.dataset.ftype : 'all',
        genre: genreId,
        genreName: genreId ? ((filterGenres.find(g => g.id === genreId) || {}).name || '') : '',
        yearFrom: from,
        yearTo: to
    };
    $('filterDialog').close();
    updateFilterBadge();
    runSearchOrBrowse(true);
});

$('fReset').addEventListener('click', () => {
    searchFilters = emptyFilters();
    $('filterDialog').close();
    updateFilterBadge();
    if (!resultsContainer.hidden) runSearchOrBrowse(true);
});

// Klik mimo panel ho zavře
['filterDialog', 'optionsDialog'].forEach(id => $(id).addEventListener('click', (e) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
}));

// Text → hledání (s filtry); bez textu, ale s filtry → procházení
function runSearchOrBrowse(fromFilters = false) {
    const q = searchInput.value.trim();
    if (q) return search(q);
    if (filtersActiveCount()) return browse();
    if (fromFilters && history.state && (history.state.view === 'browse' || history.state.view === 'results')) showTab(currentTab);
}

function matchesFilters(m, f = searchFilters) {
    const isSeries = Boolean(m.isSeries);
    if (f.type === 'movie' && isSeries) return false;
    if (f.type === 'series' && !isSeries) return false;
    if (f.yearFrom || f.yearTo) {
        const y = parseInt(m.year || m.rok, 10);
        if (!y || (f.yearFrom && y < f.yearFrom) || (f.yearTo && y > f.yearTo)) return false;
    }
    if (f.genre) {
        const g = Array.isArray(m.genres) ? m.genres : String(m.genres || '').split(/\s*[,/]\s*/);
        if (!f.genreName || !g.includes(f.genreName)) return false;
    }
    return true;
}

function renderFilterChips(note = '') {
    const tools = $('resultsTools');
    const f = searchFilters;
    tools.innerHTML = '';
    const chips = [];
    if (f.type !== 'all') chips.push(['type', t(f.type === 'movie' ? 'typeMovies' : 'typeSeries')]);
    if (f.genre) chips.push(['genre', f.genreName ? genreLabel(f.genreName) : t('filterGenre')]);
    if (f.yearFrom || f.yearTo) {
        chips.push(['year', f.yearFrom && f.yearTo ? (f.yearFrom === f.yearTo ? String(f.yearFrom) : `${f.yearFrom}–${f.yearTo}`)
            : f.yearFrom ? t('yearsFrom', { y: f.yearFrom }) : t('yearsTo', { y: f.yearTo })]);
    }
    if (!chips.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'filter-chips';
    chips.forEach(([key, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filter-chip';
        b.setAttribute('aria-label', `${t('removeFilter')}: ${label}`);
        b.innerHTML = `<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
        b.firstChild.textContent = label;
        b.addEventListener('click', () => {
            if (key === 'type') searchFilters.type = 'all';
            if (key === 'genre') { searchFilters.genre = null; searchFilters.genreName = ''; }
            if (key === 'year') { searchFilters.yearFrom = null; searchFilters.yearTo = null; }
            updateFilterBadge();
            runSearchOrBrowse(true);
        });
        wrap.appendChild(b);
    });
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'see-all';
    edit.textContent = t('editFilters');
    edit.addEventListener('click', openFilters);
    wrap.appendChild(edit);
    if (note) {
        const n = document.createElement('span');
        n.className = 'filter-note';
        n.textContent = note;
        wrap.appendChild(n);
    }
    tools.appendChild(wrap);
}

async function search(rawQuery, push = true, filters = null) {
    const query = String(rawQuery ?? searchInput.value).trim();
    if (filters) searchFilters = { ...emptyFilters(), ...filters };
    if (!query) { if (filtersActiveCount()) browse(push); return; }
    updateFilterBadge();

    searchInput.value = query;
    searchInput.blur();
    const params = filtersToParams();
    if (push) history.pushState({ view: 'results', q: query, filters: { ...searchFilters } }, '', `#hledat=${encodeURIComponent(query)}${params ? '&' + params : ''}`);
    document.title = `${query} – Moviora`;

    const viewId = ++resultsViewId;
    setView('results');
    $('resultsTitle').textContent = t('resultsFor', { q: query });
    renderFilterChips();
    resultsDiv.innerHTML = `<p class="status">${t('searching')}</p>`;

    try {
        const [data] = await Promise.all([apiGet(`/search?q=${encodeURIComponent(query)}`), ensureGenreName(searchFilters)]);
        if (viewId !== resultsViewId) return;
        if (data.error) {
            resultsDiv.innerHTML = `<p class="status error">${t('searchFailed', { e: escapeHtml(data.error) })}</p>`;
            return;
        }
        if (!data.results || data.results.length === 0) {
            resultsDiv.innerHTML = `<p class="status">${t('noResults')}</p>`;
            return;
        }
        let list = data.results;
        if (filtersActiveCount()) {
            list = list.filter(m => matchesFilters(m));
            renderFilterChips(t('filteredCount', { n: list.length, total: data.results.length }));
            if (!list.length) {
                resultsDiv.innerHTML = `<p class="status">${t('noFilterMatch')}</p>`;
                tvFocusFirst('#resultsTools button', true);
                return;
            }
        }
        renderGrid(list, resultsDiv, { lazyPosters: true });
        tvFocusFirst('#results .poster', true);
    } catch {
        if (viewId === resultsViewId) resultsDiv.innerHTML = `<p class="status error">${t('serverDown')}</p>`;
    }
}

// Procházení bez hledaného textu: žebříček ČSFD podle filtrů
async function browse(push = true) {
    updateFilterBadge();
    const params = filtersToParams();
    if (push) history.pushState({ view: 'browse', filters: { ...searchFilters } }, '', `#prochazet${params ? '&' + params : ''}`);
    const title = t('browseTitle');
    document.title = `${title} – Moviora`;
    searchInput.value = '';

    const viewId = ++resultsViewId;
    setView('results');
    $('resultsTitle').textContent = title;
    renderFilterChips();
    resultsDiv.innerHTML = `<p class="status">${t('searching')}</p>`;

    const f = searchFilters;
    const qs = [];
    if (f.type !== 'all') qs.push(`type=${f.type}`);
    if (f.genre) qs.push(`genre=${f.genre}`);
    if (f.yearFrom) qs.push(`yearFrom=${f.yearFrom}`);
    if (f.yearTo) qs.push(`yearTo=${f.yearTo}`);
    try {
        const [data] = await Promise.all([apiGet(`/discover/browse?${qs.join('&')}`), ensureGenreName(f)]);
        if (viewId !== resultsViewId) return;
        renderFilterChips();
        if (data.error) throw new Error(data.error);
        if (!data.items || !data.items.length) { resultsDiv.innerHTML = `<p class="status">${t('noFilterMatch')}</p>`; return; }
        renderGrid(data.items, resultsDiv);
        tvFocusFirst('#results .poster', true);
    } catch {
        if (viewId === resultsViewId) resultsDiv.innerHTML = `<p class="status error">${t('discoverFailed')}</p>`;
    }
}

// =====================================================
// Plakáty
// =====================================================
function renderGrid(movies, target, { lazyPosters = false, append = false, removable = false } = {}) {
    if (!append) target.innerHTML = '';

    movies.forEach(movie => {
        const title = movie.nazev || movie.title || t('untitled');
        const year = movie.rok || movie.year || '';
        const csfdUrl = movie.csfd_url || movie.csfdLink || movie.csfdUrl;
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

        if (movie.rating) {
            const r = document.createElement('span');
            r.className = 'poster-rating' + (movie.rating >= 70 ? ' high' : movie.rating < 30 ? ' low' : '');
            r.textContent = `${movie.rating} %`;
            frame.appendChild(r);
        }

        const progress = getWatchProgressForCard(title, movie.isSeries);
        if (progress && progress.percent > 1 && progress.percent < 98) {
            const bar = document.createElement('span');
            bar.className = 'playhead';
            bar.innerHTML = `<span style="width:${Math.min(100, progress.percent).toFixed(1)}%"></span>`;
            frame.appendChild(bar);
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'poster-title';
        titleEl.textContent = displayTitle(normalized) || title;

        const y = document.createElement('span');
        y.className = 'poster-year';
        const lastEp = movie.isSeries ? readJSON(`last_ep_${title}`, null) : null;
        y.textContent = lastEp ? `${year ? year + ', ' : ''}${episodeTag(lastEp.season, lastEp.episode)}` : year;

        card.append(frame, titleEl, y);

        let item = card;
        if (removable) {
            // obal kvůli křížku (tlačítko nesmí být uvnitř tlačítka)
            item = document.createElement('div');
            item.className = 'poster-item';
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'poster-remove';
            const kind = removable === 'favorites' ? 'favorites' : 'history';
            const label = t(kind === 'favorites' ? 'removeFromFavorites' : 'removeFromHistory');
            x.setAttribute('aria-label', `${label}: ${title}`);
            x.title = label;
            x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
            x.addEventListener('click', (e) => { e.stopPropagation(); removeFromLibrary(kind, title, item); });
            item.append(card, x);
        }
        target.appendChild(item);

        if (lazyPosters && csfdUrl) {
            apiGet(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`)
                .then(d => {
                    if (d.explicit) { item.remove(); return; }   // pornografie se nezobrazuje
                    if (d.poster && d.poster.trim()) {
                        normalized.poster = d.poster;
                        img.src = d.poster;
                    }
                    if (d.titleEn) {
                        normalized.titleEn = d.titleEn;
                        titleEl.textContent = displayTitle(normalized) || title;
                    }
                    if (d.isSeries) normalized.isSeries = true;
                })
                .catch(() => {});
        }
    });
}

// =====================================================
// Detail filmu / seriálu
// =====================================================
let autoplayPending = false;

async function openMovieDetail(movie, push = true, { autoplay = false } = {}) {
    const reqId = ++detailRequestId;
    currentMovieData = { ...movie };
    activeStreams = [];
    showAllSources = false;
    autoplayPending = autoplay;

    if (push) history.pushState({ view: 'detail', movie }, '', filmHash(movie));
    document.title = `${displayTitle(movie)} – Moviora`;
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
        titleEn: movie.titleEn || null,
        seasons: null
    };
    let explicit = false;

    if (csfdUrl) {
        try {
            const d = await apiGet(`/csfd-scrape?details=1&url=${encodeURIComponent(csfdUrl)}`);
            if (!d.error) {
                if (d.imdbUrl) details.imdbLink = d.imdbUrl;
                if (d.titleEn) details.titleEn = d.titleEn;
                explicit = Boolean(d.explicit);
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

    if (explicit) {
        detailContent.innerHTML = `<p class="status error">${t('notAvailable')}</p>`;
        return;
    }

    Object.assign(currentMovieData, details);

    // Adresa = sdílitelný odkaz (#film=tt…&…), jakmile známe IMDb i ČSFD id
    if (history.state && history.state.view === 'detail' && !history.state.player) {
        const h = filmHash(currentMovieData);
        if (h !== location.hash) history.replaceState(history.state, '', h);
    }

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

    // Pod hlavním názvem ten druhý: v češtině anglický/původní, v angličtině český
    const mainTitle = displayTitle(m);
    const altTitle = uiLang === 'en' ? m.title : (m.titleEn || m.originalTitle);
    const showOriginal = altTitle && normText(altTitle) !== normText(mainTitle);
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
                <h1 class="detail-title">${escapeHtml(mainTitle)}</h1>
                ${showOriginal ? `<p class="detail-original">${escapeHtml(altTitle)}</p>` : ''}
                ${facts.length ? `<ul class="facts">${facts.join('')}</ul>` : ''}

                <div class="actions">
                    <button class="btn btn-primary" id="playBtn" disabled>${ICONS.play}<span>${t('findingSources')}</span></button>
                    <div class="segmented" role="group" aria-label="${t('audioGroup')}">
                        <button type="button" data-lang="cz" aria-pressed="${selectedLanguage === 'cz'}">${t('audioCz')}</button>
                        <button type="button" data-lang="en" aria-pressed="${selectedLanguage === 'en'}">${t('audioOrig')}</button>
                    </div>
                    <button class="btn btn-quiet" id="favBtn" aria-pressed="${fav}">${ICONS.star}<span>${fav ? t('inFavorites') : t('addFavorite')}</span></button>
                    ${shareIdsOf(m).length ? `<button class="btn btn-quiet" id="shareBtn">${ICONS.share}<span>${t('share')}</span></button>` : ''}
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
    if ($('shareBtn')) $('shareBtn').addEventListener('click', shareCurrent);
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
    const en = selectedLanguage === 'en';
    const orig = [m.titleEn, m.originalTitle].find(x => x && normText(x) !== normText(m.title)) || null;
    const first = firstWordOf(m.title);
    const stages = [];   // každá etapa = dotazy spuštěné naráz; další etapa jen když předchozí nic nenašla

    if (m.isSeries) {
        writeJSON(`last_ep_${m.title}`, { season: currentSeason, episode: currentEpisode, at: Date.now() });
        const ep = episodeTag(), alt = `${currentSeason}x${pad2(currentEpisode)}`;
        if (en) {
            stages.push([`${m.title} ${ep} ENG`, orig ? `${orig} ${ep}` : null]);
            stages.push([`${m.title} ${ep}`]);
        } else {
            stages.push([`${m.title} ${ep}`]);
        }
        stages.push([`${m.title} ${alt}`, orig ? `${orig} ${ep}` : null]);
        if (first) stages.push([`${first} ${ep}`]);
    } else {
        const y = (String(m.year || '').match(/\d{4}/) || [''])[0];
        const ys = y ? ' ' + y : '';
        if (en) {
            stages.push([`${m.title}${ys} ENG`, orig ? `${orig}${ys}` : null]);
            stages.push([`${m.title} ENG`, orig ? `${orig}` : null, `${m.title}${ys}`]);
        } else {
            if (y) stages.push([`${m.title}${ys}`]);
            stages.push([`${m.title}`]);
            if (orig) stages.push([`${orig}${ys}`]);
        }
        if (first) stages.push([`${first}${ys}`]);
    }

    try {
        let raw = [];
        const tried = new Set();
        for (const stage of stages) {
            const qs = stage.filter(q => q && !tried.has(normText(q)));
            qs.forEach(q => tried.add(normText(q)));
            if (!qs.length) continue;
            const lists = await Promise.all(qs.map(q => fetchStreams(q, signal)));
            if (!isCurrent()) return;
            const seen = new Set();
            raw = lists.flat().filter(st => !seen.has(st.link) && seen.add(st.link));
            if (raw.length) break;
        }

        activeStreams = raw
            .map(s => ({ ...s, score: calculateStreamScore(s, m, selectedLanguage) }))
            .sort((a, b) => b.score - a.score);

        renderSources();
    } catch (e) {
        if (e.name === 'AbortError' || !isCurrent()) return;
        autoplayPending = false;
        setPlayButton('none');
        $('sourcesBody').innerHTML = `<p class="status error">${t('sourcesFailed', { e: escapeHtml(e.message) })}</p>`;
    }
}

// První „opravdové“ slovo z víceslovného názvu (pro poslední pokus o hledání)
function firstWordOf(title) {
    const words = String(title || '').split(/[\s:,\-–]+/).filter(Boolean);
    if (words.length < 2) return null;
    const skip = ['the', 'a', 'an', 'der', 'die', 'das', 'le', 'la', 'les', 'el', 'los', 'il'];
    const word = words.find(w => w.length >= 3 && !skip.includes(w.toLowerCase())) || words[0];
    return normText(word) === normText(title) ? null : word;
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
        autoplayPending = false;
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

    // Z hlavní obrazovky (Pokračovat) rovnou přehrát nejlepší zdroj
    if (autoplayPending) {
        autoplayPending = false;
        startStreaming();
    }
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
        writeJSON('last_played', {
            ...libraryEntry(currentMovieData),
            season: currentMovieData.isSeries ? currentSeason : undefined,
            episode: currentMovieData.isSeries ? currentEpisode : undefined,
            at: Date.now()
        });
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
    P.title.textContent = displayTitle(m);
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
        percent: (videoPlayer.currentTime / videoPlayer.duration) * 100,
        duration: videoPlayer.duration,
        at: now
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

function updateFullscreenButton() {
    const on = !!document.fullscreenElement;
    P.full.innerHTML = on ? ICONS.fsExit : ICONS.fsEnter;
    P.full.setAttribute('aria-label', t(on ? 'exitFullscreen' : 'fullscreen'));
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && screen.orientation?.unlock) {
        try { screen.orientation.unlock(); } catch { /* nepodporováno */ }
    }
    updateFullscreenButton();
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
    const tab = currentTab;
    $('homeIntro').hidden = true;
    $('tabHead').hidden = tab === 'home';
    $('tabTitle').textContent = t(TAB_LABEL[tab]);
    if (tab === 'home') renderHero();
    if (tab === 'favorites' || tab === 'continue') renderLibraryTab(tab);
    else loadDiscover(tab);
}

// =====================================================
// Domů: naposledy přehrané přes celou obrazovku
// =====================================================
let heroItem = null;
let heroRenderId = 0;

function heroCandidate() {
    const hist = readJSON('watch_history', []);
    const last = readJSON('last_played', null);
    if (last && last.title && hist.some(h => h.title === last.title)) {
        const inHist = hist.find(h => h.title === last.title);
        return { item: { ...inHist, ...last }, kind: 'last' };
    }
    if (hist.length) return { item: hist[0], kind: 'last' };
    return null;
}

async function renderHero() {
    const id = ++heroRenderId;
    const hero = $('hero');
    let cand = heroCandidate();
    if (!cand) {
        // Nic rozkoukaného: ukázat nejsledovanější film
        hero.classList.add('is-loading');
        try {
            const data = await getDiscover();
            const pop = ((data.sections || []).find(s => s.id === 'popular-movies') || {}).items || [];
            const top = pop.find(i => i.poster) || pop[0];
            if (top) cand = { item: { ...top, csfd_url: top.csfdUrl }, kind: 'popular' };
        } catch { /* bez nabídky */ }
        if (id !== heroRenderId) return;
        hero.classList.remove('is-loading');
        if (!cand) {
            hero.hidden = true;
            heroItem = null;
            return;
        }
    }
    heroItem = cand;
    fillHero(cand);

    // Popis (a plakát) z ČSFD, pokud v uložené položce chybí
    const csfdUrl = cand.item.csfd_url || cand.item.csfdLink || cand.item.csfdUrl;
    if (!cand.item.description && csfdUrl) {
        try {
            const d = await apiGet(`/csfd-scrape?url=${encodeURIComponent(csfdUrl)}`);
            if (id !== heroRenderId || d.error) return;
            if (d.explicit) { hero.hidden = true; return; }
            if (d.description) cand.item.description = d.description;
            if (!cand.item.poster && d.poster) cand.item.poster = d.poster;
            if (d.titleEn && !cand.item.titleEn) cand.item.titleEn = d.titleEn;
            if (d.isSeries) cand.item.isSeries = true;
            fillHero(cand);
        } catch { /* bez popisu */ }
    }
}

function fillHero({ item: m, kind }) {
    $('heroKicker').textContent = t(kind === 'popular' ? 'heroPopular' : 'heroLast');
    $('heroTitle').textContent = displayTitle(m) || m.title;

    const poster = m.poster || '';
    $('heroBg').style.backgroundImage = poster ? `url("${encodeURI(poster).replace(/"/g, '%22')}")` : 'none';
    const img = $('heroPoster');
    img.hidden = !poster;
    img.onerror = () => { img.hidden = true; };
    if (poster && img.getAttribute('src') !== poster) img.src = poster;

    let ep = null;
    if (m.isSeries) {
        const le = readJSON(`last_ep_${m.title}`, null);
        if (le) ep = { s: le.season, e: le.episode };
    }
    const facts = [];
    if (m.year && m.year !== '---') facts.push(`<li>${escapeHtml(m.year)}</li>`);
    if (ep) facts.push(`<li>${escapeHtml(t('seasonEp', { s: ep.s, e: ep.e }))}</li>`);
    else if (m.isSeries) facts.push(`<li>${t('series')}</li>`);
    if (!m.isSeries && m.runtime) facts.push(`<li>${escapeHtml(m.runtime)} min</li>`);
    const genres = Array.isArray(m.genres) ? m.genres.slice(0, 3).map(genreLabel).join(', ') : m.genres;
    if (genres) facts.push(`<li>${escapeHtml(genres)}</li>`);
    if (m.rating) facts.push(`<li class="rating">${t('rating', { n: escapeHtml(m.rating) })}</li>`);
    $('heroFacts').innerHTML = facts.join('');
    $('heroFacts').hidden = !facts.length;

    const prog = kind === 'last' ? getWatchProgressForCard(m.title, m.isSeries) : null;
    const resume = Boolean(prog && prog.percent > 1 && prog.percent < 98);
    $('heroProgress').hidden = !resume;
    if (resume) {
        $('heroBar').style.width = `${Math.min(100, prog.percent).toFixed(1)}%`;
        const dur = prog.duration || (prog.percent > 0 ? prog.time / (prog.percent / 100) : 0);
        const left = Math.max(0, dur - prog.time);
        $('heroLeft').textContent = left >= 60 ? t('heroLeft', { t: `${Math.round(left / 60)} min` }) : '';
    }

    $('heroPlot').textContent = m.description || '';
    $('heroPlot').hidden = !m.description;

    const tag = ep ? episodeTag(ep.s, ep.e) : '';
    const label = resume ? (tag ? t('heroResumeEp', { ep: tag }) : t('heroResume')) : (tag ? t('heroPlayEp', { ep: tag }) : t('play'));
    $('heroPlay').innerHTML = `${ICONS.play}<span></span>`;
    $('heroPlay').lastChild.textContent = label;
}

function heroMovie() {
    const m = heroItem.item;
    return { ...m, csfdLink: m.csfd_url || m.csfdLink || m.csfdUrl };
}

$('heroPlay').addEventListener('click', () => { if (heroItem) openMovieDetail(heroMovie(), true, { autoplay: true }); });
$('heroDetail').addEventListener('click', () => { if (heroItem) openMovieDetail(heroMovie()); });
$('heroScroll').addEventListener('click', () => {
    const top = $('hero').getBoundingClientRect().bottom + window.scrollY - document.querySelector('.topbar').offsetHeight;
    window.scrollTo({ top, behavior: 'smooth' });
});

// =====================================================
// Oblíbené a Pokračovat (mřížka s křížkem pro odebrání)
// =====================================================
function renderLibraryTab(tab) {
    ++discoverRenderId;
    disconnectGenreObserver();
    const host = $('discoverRows');
    const items = readJSON(tab === 'favorites' ? 'favorites' : 'watch_history', []);
    host.innerHTML = '';
    if (!items.length) {
        host.innerHTML = `<p class="empty-note">${t(tab === 'favorites' ? 'favoritesEmpty' : 'continueEmpty')}</p>`;
        tvFocusFirst('#tabs [aria-current="page"]', true);
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'poster-grid';
    host.appendChild(grid);
    renderGrid(items, grid, { removable: tab === 'favorites' ? 'favorites' : 'history' });
    tvFocusFirst('#discoverRows .poster', true);
}

// =====================================================
// Nabídka z ČSFD (přes náš server)
// =====================================================
const DISCOVER_LOCAL_TTL = 6 * 60 * 60 * 1000;   // v prohlížeči obnovit po 6 h (server sám po 24 h)
let discoverMem = null;
let discoverLoading = null;

const GENRE_EN = {
    'Akční': 'Action', 'Animovaný': 'Animation', 'Dobrodružný': 'Adventure', 'Dokumentární': 'Documentary', 'Drama': 'Drama',
    'Fantasy': 'Fantasy', 'Historický': 'History', 'Horor': 'Horror', 'Katastrofický': 'Disaster', 'Komedie': 'Comedy',
    'Krimi': 'Crime', 'Muzikál': 'Musical', 'Mysteriózní': 'Mystery', 'Pohádka': 'Fairy tale', 'Psychologický': 'Psychological',
    'Rodinný': 'Family', 'Romantický': 'Romance', 'Sci-Fi': 'Sci-Fi', 'Sportovní': 'Sport', 'Thriller': 'Thriller',
    'Válečný': 'War', 'Western': 'Western', 'Životopisný': 'Biography'
};
const genreLabel = (name) => (uiLang === 'en' && GENRE_EN[name]) || name;

const SECTION_TITLE = { 'popular-movies': 'popularMovies', 'popular-series': 'popularSeries', 'top-movies': 'topMovies', 'top-series': 'topSeries' };

async function getDiscover() {
    if (discoverMem && Date.now() - discoverMem.t < DISCOVER_LOCAL_TTL) return discoverMem.data;
    const cached = readJSON('discover_cache', null);
    if (cached && cached.data && Date.now() - cached.t < DISCOVER_LOCAL_TTL) {
        discoverMem = cached;
        return cached.data;
    }
    if (!discoverLoading) {
        discoverLoading = apiGet('/discover')
            .then(data => {
                if (data.error || !Array.isArray(data.sections)) throw new Error(data.error || 'bad data');
                discoverMem = { t: Date.now(), data };
                writeJSON('discover_cache', discoverMem);
                return data;
            })
            .catch(err => {
                if (cached && cached.data) return cached.data;   // radši starší nabídka než žádná
                throw err;
            })
            .finally(() => { discoverLoading = null; });
    }
    return discoverLoading;
}

function rowSection({ id, title, items, seeAll, skeleton = false, removable = false }) {
    const sec = document.createElement('section');
    sec.className = 'shelf row-shelf';
    if (id) sec.dataset.row = id;

    const head = document.createElement('div');
    head.className = 'shelf-head';
    const h = document.createElement('h2');
    h.className = 'shelf-title';
    h.textContent = title;
    head.appendChild(h);
    if (seeAll) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'see-all';
        more.textContent = t('seeAll');
        more.addEventListener('click', seeAll);
        head.appendChild(more);
    }

    const wrap = document.createElement('div');
    wrap.className = 'row-wrap';
    const row = document.createElement('div');
    row.className = 'poster-row';
    if (skeleton) {
        row.innerHTML = '<span class="poster skeleton"><span class="poster-frame"></span></span>'.repeat(7);
    } else {
        renderGrid(items, row, { removable });
    }
    const prev = document.createElement('button');
    const next = document.createElement('button');
    prev.className = 'row-nav prev'; next.className = 'row-nav next';
    prev.type = next.type = 'button';
    prev.tabIndex = next.tabIndex = -1;
    prev.setAttribute('aria-label', t('scrollLeft'));
    next.setAttribute('aria-label', t('scrollRight'));
    prev.innerHTML = ICONS.prev; next.innerHTML = ICONS.next;
    prev.addEventListener('click', () => row.scrollBy({ left: -row.clientWidth * 0.85, behavior: 'smooth' }));
    next.addEventListener('click', () => row.scrollBy({ left: row.clientWidth * 0.85, behavior: 'smooth' }));
    wrap.append(prev, row, next);

    sec.append(head, wrap);
    return sec;
}

let discoverRenderId = 0;

// Žánrové řady na záložkách Filmy a Seriály se načítají, až k nim uživatel doroluje
let genreObserver = null;
function disconnectGenreObserver() {
    if (genreObserver) { genreObserver.disconnect(); genreObserver = null; }
}

async function fillGenreRow(sec, renderId) {
    if (sec.dataset.loaded) return;
    sec.dataset.loaded = '1';
    try {
        const d = await apiGet(`/discover/genre?id=${sec.dataset.genre}&type=${sec.dataset.type}`);
        if (renderId !== discoverRenderId) return;
        const items = (d.items || []).slice(0, 20);
        if (!items.length) { sec.remove(); return; }
        const row = sec.querySelector('.poster-row');
        row.innerHTML = '';
        renderGrid(items, row);
    } catch {
        if (renderId === discoverRenderId) sec.remove();
    }
}

function observeGenreRows(renderId) {
    const rows = Array.from(document.querySelectorAll('#discoverRows [data-genre]'));
    if (!('IntersectionObserver' in window)) {
        // starší televize: postupně jednu po druhé
        (async () => {
            for (const r of rows) {
                if (renderId !== discoverRenderId) return;
                await fillGenreRow(r, renderId);
            }
        })();
        return;
    }
    genreObserver = new IntersectionObserver(entries => entries.forEach(en => {
        if (!en.isIntersecting) return;
        genreObserver.unobserve(en.target);
        fillGenreRow(en.target, renderId);
    }), { rootMargin: '700px 0px' });
    rows.forEach(r => genreObserver.observe(r));
}

async function loadDiscover(tab = currentTab) {
    const host = $('discoverRows');
    const renderId = ++discoverRenderId;
    disconnectGenreObserver();
    const history = readJSON('watch_history', []);
    const favorites = readJSON('favorites', []);
    const libraryRows = () => {
        const out = [];
        if (tab !== 'home') return out;
        if (history.length) out.push(rowSection({ id: 'continue', title: t('continueWatching'), items: history, removable: 'history', seeAll: () => showTab('continue') }));
        return out;
    };
    const favoritesRow = () => (tab === 'home' && favorites.length
        ? rowSection({ id: 'favorites', title: t('favorites'), items: favorites, seeAll: () => showTab('favorites') }) : null);

    // Kostra hned, ať stránka neposkakuje
    if (!discoverMem) {
        host.innerHTML = '';
        libraryRows().forEach(r => host.appendChild(r));
        const series = tab === 'series';
        host.append(rowSection({ title: t(series ? 'popularSeries' : 'popularMovies'), skeleton: true }),
            rowSection({ title: t(series ? 'topSeries' : 'popularSeries'), skeleton: true }));
    }

    let data;
    try {
        data = await getDiscover();
    } catch {
        if (renderId !== discoverRenderId) return;
        host.innerHTML = '';
        libraryRows().forEach(r => host.appendChild(r));
        const fav = favoritesRow();
        if (fav) host.appendChild(fav);
        host.insertAdjacentHTML('beforeend', `<p class="status">${t('discoverFailed')}</p>`);
        $('homeIntro').hidden = tab !== 'home' || history.length > 0 || favorites.length > 0;
        tvFocusFirst('#heroPlay, #discoverRows .poster, #searchQuery', true);
        return;
    }
    if (renderId !== discoverRenderId) return;
    filterGenres = data.genres || filterGenres;

    const byId = Object.fromEntries(data.sections.map(sec => [sec.id, sec.items]));
    const frag = document.createDocumentFragment();
    const addRow = (id) => {
        const items = byId[id];
        if (!items || !items.length) return;
        const isTop = id.startsWith('top-');
        frag.appendChild(rowSection({
            id, title: t(SECTION_TITLE[id]), items: isTop ? items.slice(0, 20) : items,
            seeAll: isTop ? () => openList(id) : null
        }));
    };

    // „Protože jsi sledoval…“ – místo pro řadu, doplní se, až dorazí podobné tituly
    const becauseSlot = document.createElement('div');

    if (tab === 'home') {
        libraryRows().forEach(r => frag.appendChild(r));
        frag.appendChild(becauseSlot);
        addRow('popular-movies');
        addRow('popular-series');
        addRow('top-movies');
        addRow('top-series');
        const fav = favoritesRow();
        if (fav) frag.appendChild(fav);
    } else {
        const series = tab === 'series';
        addRow(series ? 'popular-series' : 'popular-movies');
        addRow(series ? 'top-series' : 'top-movies');
        (data.genres || []).forEach(g => {
            const sec = rowSection({
                id: `genre-${g.id}`, title: genreLabel(g.name), skeleton: true,
                seeAll: () => openGenre(g.id, g.name, series ? 'series' : 'movie')
            });
            sec.dataset.genre = g.id;
            sec.dataset.type = series ? 'series' : 'movie';
            frag.appendChild(sec);
        });
    }

    host.innerHTML = '';
    host.appendChild(frag);
    if (tab !== 'home') observeGenreRows(renderId);

    // Na TV začít na hlavním tlačítku / prvním plakátu, dokud uživatel sám nic nevybral
    tvFocusFirst(tab === 'home' ? '#heroPlay, #discoverRows .poster, #searchQuery' : '#discoverRows .poster, #tabs [aria-current="page"]',
        tvInteracted || document.activeElement !== searchInput);

    // Doporučení podle posledního sledovaného titulu z ČSFD
    if (tab !== 'home') return;
    const seed = history.find(h => /\/film\/\d+/.test(h.csfd_url || h.csfdLink || h.csfdUrl || ''));
    if (seed) {
        const id = (seed.csfd_url || seed.csfdLink || seed.csfdUrl).match(/\/film\/(\d+)/)[1];
        try {
            const sim = await apiGet(`/csfd-similar?id=${id}`);
            if (renderId !== discoverRenderId || !sim.items || !sim.items.length) return;
            becauseSlot.replaceWith(rowSection({ id: 'because', title: t('becauseWatched', { title: displayTitle(seed) }), items: sim.items }));
        } catch { /* bez doporučení */ }
    }
}

// Celý žebříček (Zobrazit vše)
async function openList(listId, push = true) {
    if (push) history.pushState({ view: 'list', list: listId }, '', `#${listId}`);
    const title = t(SECTION_TITLE[listId] || 'topMovies');
    document.title = `${title} – Moviora`;
    searchInput.value = '';
    setView('results');
    $('resultsTitle').textContent = title;
    resultsDiv.innerHTML = `<p class="status">${t('searching')}</p>`;
    try {
        const data = await getDiscover();
        const items = (data.sections.find(sec => sec.id === listId) || {}).items || [];
        if (!items.length) { resultsDiv.innerHTML = `<p class="status">${t('listEmpty')}</p>`; return; }
        renderGrid(items, resultsDiv);
        tvFocusFirst('#results .poster', true);
    } catch {
        resultsDiv.innerHTML = `<p class="status error">${t('discoverFailed')}</p>`;
    }
}

// Žánr – filmy nebo seriály
async function openGenre(id, name, type = 'movie', push = true) {
    if (push) history.pushState({ view: 'genre', id, name, type }, '', `#zanr-${id}-${type}`);
    document.title = `${genreLabel(name)} – Moviora`;
    searchInput.value = '';
    setView('results');
    $('resultsTitle').textContent = genreLabel(name);

    const tools = $('resultsTools');
    tools.innerHTML = `
        <div class="segmented" role="group" aria-label="${t('genresTitle')}">
            <button type="button" data-type="movie" aria-pressed="${type === 'movie'}">${t('typeMovies')}</button>
            <button type="button" data-type="series" aria-pressed="${type === 'series'}">${t('typeSeries')}</button>
        </div>`;
    tools.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.type === type) return;
        history.replaceState({ view: 'genre', id, name, type: b.dataset.type }, '', `#zanr-${id}-${b.dataset.type}`);
        openGenre(id, name, b.dataset.type, false);
    }));

    resultsDiv.innerHTML = `<p class="status">${t('searching')}</p>`;
    try {
        const data = await apiGet(`/discover/genre?id=${encodeURIComponent(id)}&type=${type}`);
        if (data.error) throw new Error(data.error);
        if (!data.items || !data.items.length) { resultsDiv.innerHTML = `<p class="status">${t('listEmpty')}</p>`; return; }
        renderGrid(data.items, resultsDiv);
        tvFocusFirst('#results .poster, #resultsTools button[aria-pressed="true"]', true);
    } catch {
        resultsDiv.innerHTML = `<p class="status error">${t('discoverFailed')}</p>`;
    }
}

// Odebrání z historie (včetně uložené pozice) nebo z oblíbených
function removeFromLibrary(kind, title, itemEl) {
    if (kind === 'favorites') {
        writeJSON('favorites', readJSON('favorites', []).filter(f => f.title !== title));
    } else {
        writeJSON('watch_history', readJSON('watch_history', []).filter(h => h.title !== title));
        try {
            Object.keys(localStorage)
                .filter(k => k === `progress_${title}` || k.startsWith(`progress_${title}_S`) || k === `last_ep_${title}`)
                .forEach(k => localStorage.removeItem(k));
            const last = readJSON('last_played', null);
            if (last && last.title === title) localStorage.removeItem('last_played');
        } catch { /* úložiště nedostupné */ }
    }

    // Na TV přesunout výběr na sousední kartu
    const row = itemEl && itemEl.parentElement;
    const neighbour = itemEl && (itemEl.nextElementSibling || itemEl.previousElementSibling);
    const hadFocus = itemEl && itemEl.contains(document.activeElement);
    if (itemEl) itemEl.remove();
    if (row && !row.children.length) {
        const shelf = row.closest('.row-shelf');
        if (shelf) shelf.remove();
        else renderLibraryTab(currentTab);
    }
    if (hadFocus) {
        const next = neighbour && document.contains(neighbour) && neighbour.querySelector('.poster');
        if (next) tvFocus(next); else tvFocusFirst('#discoverRows .poster, #tabs [aria-current="page"]');
    }
    if (kind === 'history' && currentTab === 'home' && !libraryContainer.hidden) renderHero();
    toast(t(kind === 'favorites' ? 'removedFromFavorites' : 'removedFromHistory', { title }), 2500);
}

// Do knihovny ukládáme jen to, co je potřeba pro kartu a detail
function libraryEntry(m) {
    const { title, titleEn, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source, watchedAt } = m;
    return { title, titleEn, originalTitle, year, poster, csfd_url, csfdLink, imdbLink, isSeries, genres, rating, runtime, description, actors, id, source, watchedAt };
}

function addToHistory(movie) {
    const history = readJSON('watch_history', []).filter(h => h.title !== movie.title);
    history.unshift({ ...libraryEntry(movie), watchedAt: Date.now() });
    writeJSON('watch_history', history.slice(0, 30));
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
    if (typeof updateFullscreenButton === 'function') updateFullscreenButton();
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
        renderRoute(history.state);
    } else if (!libraryContainer.hidden) {
        loadLibrary();
    }
    document.title = !libraryContainer.hidden ? (currentTab === 'home' ? t('homeTitle') : `${t(TAB_LABEL[currentTab])} – Moviora`) : document.title;
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
    if ($('optionsDialog').open) $('optionsDialog').close();
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
    if (!IS_STANDALONE && !isTv()) installBtn.hidden = false;
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
// Možnosti: export/import profilu a rychlá synchronizace
// =====================================================
const optionsDlg = $('optionsDialog');

function openOptions() {
    resetSyncUi();
    if (optionsDlg.open) return;
    if (typeof optionsDlg.showModal === 'function') optionsDlg.showModal(); else optionsDlg.setAttribute('open', '');
    tvFocus(optionsDlg.querySelector('.lang-switch [aria-pressed="true"]'));
}
$('optionsBtn').addEventListener('click', openOptions);
$('optionsClose').addEventListener('click', () => optionsDlg.close());
optionsDlg.addEventListener('close', () => {
    // zavřením panelu se rozpracovaný kód zruší (nikdo ho už nevidí)
    if (syncState) cancelSync();
    resetSyncUi();
});

// Co patří do profilu (vše ostatní v úložišti je mezipaměť)
const PROFILE_KEY = /^(watch_history|favorites|last_played|lang|ui_lang|volume|progress_.+|last_ep_.+)$/;

function buildProfile() {
    const data = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && PROFILE_KEY.test(k)) data[k] = readJSON(k, null);
        }
    } catch { /* úložiště nedostupné */ }
    return { format: 'moviora-profile', version: 1, exported: new Date().toISOString(), app: 'https://moviora.win', data };
}

function exportProfile() {
    const text = JSON.stringify(buildProfile(), null, 1);
    const d = new Date();
    const name = `moviora-${uiLang === 'en' ? 'profile' : 'profil'}-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.mw`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t('exported', { f: name }), 4000);
}
$('exportBtn').addEventListener('click', exportProfile);

function readFileText(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
    });
}

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        if (file.size > 3 * 1024 * 1024) throw new Error('too big');
        afterProfileMerge(mergeProfile(JSON.parse(await readFileText(file))));
    } catch {
        toast(t('importBad'), 4500);
    }
});

// --- Sloučení profilu (soubor nebo synchronizace) – vše se kontroluje, nic se nepřebírá naslepo ---
const httpUrl = (u) => typeof u === 'string' && u.length < 2000 && /^https?:\/\//i.test(u) ? u : undefined;
const numOr = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);

function cleanEntry(e) {
    if (!e || typeof e !== 'object' || typeof e.title !== 'string' || !e.title.trim()) return null;
    const out = { title: e.title.slice(0, 300) };
    ['titleEn', 'originalTitle', 'description', 'actors', 'source', 'id'].forEach(k => {
        if (typeof e[k] === 'string') out[k] = e[k].slice(0, 5000);
    });
    ['year', 'rating', 'runtime'].forEach(k => {
        if (typeof e[k] === 'string' || typeof e[k] === 'number') out[k] = typeof e[k] === 'string' ? e[k].slice(0, 40) : e[k];
    });
    if (Array.isArray(e.genres)) out.genres = e.genres.filter(g => typeof g === 'string').slice(0, 12).map(g => g.slice(0, 60));
    else if (typeof e.genres === 'string') out.genres = e.genres.slice(0, 300);
    ['poster', 'csfd_url', 'csfdLink', 'imdbLink'].forEach(k => { const u = httpUrl(e[k]); if (u) out[k] = u; });
    out.isSeries = Boolean(e.isSeries);
    ['watchedAt', 'at', 'season', 'episode'].forEach(k => { const n = numOr(e[k]); if (n !== undefined) out[k] = n; });
    return out;
}

const newerThan = (a, b) => !b || (a.at || 0) > (b.at || 0) || (!a.at && !b.at && (a.time || 0) > (b.time || 0));

function mergeProfile(profile) {
    if (!profile || profile.format !== 'moviora-profile' || !profile.data || typeof profile.data !== 'object') {
        throw new Error(t('importBad'));
    }
    const data = profile.data;
    const list = (v) => (Array.isArray(v) ? v.map(cleanEntry).filter(Boolean) : []);

    // Historie: novější záznam vyhrává, seřadit podle času
    const histMap = new Map();
    [...list(data.watch_history), ...readJSON('watch_history', [])].forEach(e => {
        const prev = histMap.get(e.title);
        if (!prev || (e.watchedAt || 0) > (prev.watchedAt || 0)) histMap.set(e.title, e);
    });
    const hist = Array.from(histMap.values()).sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0)).slice(0, 30);
    writeJSON('watch_history', hist);

    // Oblíbené: místní zůstávají, nové se přidají
    const favs = readJSON('favorites', []);
    list(data.favorites).forEach(e => { if (!favs.some(f => f.title === e.title)) favs.push(e); });
    writeJSON('favorites', favs);

    let keys = 0;
    Object.keys(data).forEach(k => {
        if (++keys > 5000 || k.length > 400 || !PROFILE_KEY.test(k)) return;
        const v = data[k];
        if (k.startsWith('progress_')) {
            if (!v || numOr(v.time) === undefined || numOr(v.percent) === undefined) return;
            const clean = { time: Math.max(0, v.time), percent: Math.max(0, Math.min(100, v.percent)) };
            if (numOr(v.at) !== undefined) clean.at = v.at;
            if (numOr(v.duration) !== undefined) clean.duration = v.duration;
            if (newerThan(clean, readJSON(k, null))) writeJSON(k, clean);
        } else if (k.startsWith('last_ep_')) {
            const s = parseInt(v && v.season, 10), e = parseInt(v && v.episode, 10);
            if (!(s > 0 && e > 0)) return;
            const clean = { season: s, episode: e };
            if (numOr(v.at) !== undefined) clean.at = v.at;
            const local = readJSON(k, null);
            if (!local || (clean.at || 0) > (local.at || 0)) writeJSON(k, clean);
        } else if (k === 'last_played') {
            const clean = cleanEntry(v);
            if (clean && newerThan(clean, readJSON(k, null))) writeJSON(k, clean);
        } else if (k === 'lang' && (v === 'cz' || v === 'en')) writeJSON(k, v);
        else if (k === 'ui_lang' && (v === 'cs' || v === 'en')) writeJSON(k, v);
        else if (k === 'volume' && numOr(v) !== undefined) writeJSON(k, Math.max(0, Math.min(1, v)));
    });
    return { history: hist.length, favorites: favs.length };
}

function afterProfileMerge(res) {
    selectedLanguage = readJSON('lang', selectedLanguage) === 'en' ? 'en' : 'cz';
    const vol = readJSON('volume', null);
    if (typeof vol === 'number') videoPlayer.volume = vol;
    if (optionsDlg.open) optionsDlg.close();
    const lang = readJSON('ui_lang', uiLang);
    if (lang !== uiLang) setUiLang(lang);
    else renderRoute(history.state);
    toast(t('importDone', { h: res.history, f: res.favorites }), 4500);
}

// --- Rychlá synchronizace přes náš server (kód platí 60 s, stáhnout jde jen jednou) ---
let syncState = null;   // { code, expires, total, timer }

async function apiPost(path, body) {
    let res;
    try {
        res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
        reportPossibleOutage();
        throw err;
    }
    let data = {};
    try { data = await res.json(); } catch { /* neplatná odpověď */ }
    if (!res.ok && !data.error) data.error = t('serverError', { s: res.status });
    return data;
}

function showSyncPane(name) {
    $('syncStart').hidden = name !== 'start';
    $('syncCodeView').hidden = name !== 'code';
    $('syncReceiveView').hidden = name !== 'receive';
}
function syncError(msg) { $('syncError').textContent = msg || ''; }
function resetSyncUi() {
    if (syncState && syncState.timer) clearInterval(syncState.timer);
    syncState = null;
    showSyncPane('start');
    syncError('');
}
function cancelSync() {
    if (syncState && syncState.code) apiPost('/sync/cancel', { code: syncState.code }).catch(() => {});
}

function tickSync() {
    if (!syncState) return;
    const left = Math.max(0, Math.round((syncState.expires - Date.now()) / 1000));
    $('syncTimerBar').style.width = `${(left / syncState.total) * 100}%`;
    $('syncTimerText').textContent = t('syncLeft', { s: left });
    if (left <= 0) {
        resetSyncUi();
        syncError(t('syncExpired'));
        tvFocus($('syncSend'));
    }
}

$('syncSend').addEventListener('click', async () => {
    const btn = $('syncSend');
    btn.disabled = true;
    syncError('');
    try {
        const d = await apiPost('/sync', { profile: buildProfile() });
        if (!d.code) throw new Error(d.error || '');
        const total = d.expiresIn || 60;
        syncState = { code: d.code, expires: Date.now() + total * 1000, total, timer: null };
        $('syncCode').textContent = `${d.code.slice(0, 3)} ${d.code.slice(3)}`;
        showSyncPane('code');
        tickSync();
        syncState.timer = setInterval(tickSync, 1000);
        tvFocus($('syncCancel'));
    } catch (e) {
        syncError(t('syncFailed', { e: e.message || t('serverDown') }));
    } finally {
        btn.disabled = false;
    }
});

$('syncCancel').addEventListener('click', () => { cancelSync(); resetSyncUi(); tvFocus($('syncSend')); });

$('syncReceive').addEventListener('click', () => {
    showSyncPane('receive');
    syncError('');
    $('syncInput').value = '';
    tvFocus($('syncInput'));
    if (!isTv()) $('syncInput').focus();
});
$('syncReceiveBack').addEventListener('click', () => { showSyncPane('start'); syncError(''); tvFocus($('syncReceive')); });
$('syncInput').addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
    e.target.value = digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
});

$('syncReceiveView').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('syncInput').value.replace(/\D/g, '');
    if (code.length !== 6) { syncError(t('syncInvalidCode')); return; }
    const btn = $('syncReceiveGo');
    btn.disabled = true;
    syncError('');
    try {
        const d = await apiGet(`/sync/${code}`);
        if (!d.profile) throw new Error(d.error || '');
        afterProfileMerge(mergeProfile(d.profile));
    } catch (err) {
        syncError(t('syncFailed', { e: err.message || t('serverDown') }));
    } finally {
        btn.disabled = false;
    }
});

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
    searchInput.readOnly = on;
    searchInput.inputMode = on ? 'none' : 'search';
    if (!on && !tvKb.hidden) closeKeyboard();
    $('tvToggle').setAttribute('aria-pressed', String(on));
    installBtn.hidden = IS_STANDALONE || on;
    if (announce) {
        writeJSON('tv_mode', on);
        toast(t(on ? 'tvEnabled' : 'tvDisabled'), 3000);
        if (on) tvFocusFirst('dialog[open] #tvToggle, #heroPlay, #main .poster, #playBtn, #searchQuery', true);
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
    if (!tvKb.hidden) return tvKb;
    if (!playerEl.hidden) return playerEl;
    return document.body;
}

function focusCandidates() {
    const scope = focusScope();
    return Array.from(scope.querySelectorAll(FOCUSABLE)).filter(el =>
        isVisible(el) && !el.closest('[hidden]') && el.tabIndex !== -1 && (scope !== document.body || !playerEl.contains(el)));
}

function tvFocus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    if (!isTv()) return;
    // hlavní obrazovka nahoře: ukázat ji celou
    if (el.closest('.hero')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    // posunout jen obsah, ne lištu nahoře
    if (!el.closest('.topbar') && !el.closest('.player') && !el.closest('dialog')) {
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
    // selektory zkoušet v pořadí, v jakém jsou zadané (priorita), ne v pořadí na stránce
    for (const sel of selector.split(',')) {
        const el = Array.from(document.querySelectorAll(sel.trim())).find(n => isVisible(n) && !n.closest('[hidden]'));
        if (el) { tvFocus(el); return; }
    }
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
    if (!tvKb.hidden) { closeKeyboard(); return true; }
    if (!playerEl.hidden) { closePlayer(); return true; }
    const st = history.state || {};
    if (st.view && (st.view !== 'home' || (st.tab && st.tab !== 'home'))) { history.back(); return true; }
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

let tvInteracted = false;

document.addEventListener('keydown', (e) => {
    if (!isTv() || e.ctrlKey || e.metaKey || e.altKey) return;
    tvInteracted = true;

    const done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const active = document.activeElement;
    const tag = active && active.tagName;

    if (!playerEl.hidden) {
        if (handleTvPlayerKey(e)) done();
        return;
    }

    // Klávesnice na obrazovce a psaní číslicemi (jen ve vyhledávání)
    const kbOpen = !tvKb.hidden;
    if (kbOpen || active === searchInput) {
        const digit = digitFromKey(e);
        if (digit !== null) { t9Press(digit); return done(); }
        if (kbOpen) {
            if (e.key === 'Backspace' || e.keyCode === 8) { kbDelete(); return done(); }
            // fyzická klávesnice připojená k TV
            if (e.key && e.key.length === 1 && !keyIs(e, 'ok')) { kbInsert(e.key.toLowerCase()); return done(); }
        } else if (keyIs(e, 'ok')) {
            openKeyboard();
            return done();
        }
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
// Klávesnice na obrazovce pro TV + psaní číslicemi (T9)
// =====================================================
const tvKb = $('tvKeyboard');
const KB_LAYOUTS = {
    abc: 'abcdefghijklmnopqrstuvwxyz'.split('').concat(["'", '-']),
    accents: 'áčďéěíňóřšťúůýž'.split(''),
    num: '1234567890.,:!?&'.split('')
};
let kbLayout = 'abc';

// Písmena na číslicích jako na starém mobilu (s češtinou)
const T9 = {
    1: ['.', ',', '?', '!', '-', '1'], 2: ['a', 'b', 'c', 'á', 'č', '2'], 3: ['d', 'e', 'f', 'ď', 'é', 'ě', '3'],
    4: ['g', 'h', 'i', 'í', '4'], 5: ['j', 'k', 'l', '5'], 6: ['m', 'n', 'o', 'ň', 'ó', '6'],
    7: ['p', 'q', 'r', 's', 'ř', 'š', '7'], 8: ['t', 'u', 'v', 'ť', 'ú', 'ů', '8'], 9: ['w', 'x', 'y', 'z', 'ý', 'ž', '9'],
    0: [' ', '0']
};
const T9_TIMEOUT = 1200;
let t9State = null;   // { digit, index, timer }

function digitFromKey(e) {
    if (/^[0-9]$/.test(e.key)) return +e.key;
    if (e.keyCode >= 48 && e.keyCode <= 57) return e.keyCode - 48;
    if (e.keyCode >= 96 && e.keyCode <= 105) return e.keyCode - 96;   // numerická klávesnice / některé ovladače
    return null;
}

function renderKeyboardKeys() {
    const grid = $('kbKeys');
    grid.innerHTML = KB_LAYOUTS[kbLayout].map(ch =>
        `<button type="button" class="kb-key" data-ch="${escapeHtml(ch)}">${escapeHtml(ch)}</button>`).join('');
    grid.querySelectorAll('.kb-key').forEach(b => b.addEventListener('click', () => kbInsert(b.dataset.ch)));
    tvKb.querySelectorAll('[data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === kbLayout)));
}

function renderKeyboardText() {
    const val = searchInput.value;
    const pending = t9State ? 1 : 0;
    const out = $('kbText');
    if (!val) {
        out.innerHTML = `<span class="kb-placeholder">${t('kbPlaceholder')}</span><span class="kb-caret"></span>`;
        return;
    }
    const done = escapeHtml(val.slice(0, val.length - pending));
    const cur = pending ? `<span class="kb-pending">${escapeHtml(val.slice(-1)).replace(' ', '&nbsp;')}</span>` : '';
    out.innerHTML = `${done.replace(/ /g, '&nbsp;')}${cur}<span class="kb-caret"></span>`;
}

function renderT9Hint() {
    const hint = $('kbT9');
    if (!t9State) { hint.innerHTML = `<span class="kb-hint-text">${t('kbHint')}</span>`; return; }
    const chars = T9[t9State.digit];
    hint.innerHTML = `<kbd>${t9State.digit}</kbd>` + chars.map((c, i) =>
        `<span class="t9-char${i === t9State.index ? ' on' : ''}">${c === ' ' ? '␣' : escapeHtml(c)}</span>`).join('');
}

function openKeyboard() {
    if (!tvKb.hidden) return;
    tvKb.hidden = false;
    document.body.classList.add('kb-open');
    renderKeyboardKeys();
    renderKeyboardText();
    renderT9Hint();
    tvFocus(tvKb.querySelector('.kb-key'));
}

function closeKeyboard() {
    t9Commit();
    tvKb.hidden = true;
    document.body.classList.remove('kb-open');
    tvFocus(searchInput);
}

function kbInsert(ch) {
    t9Commit();
    searchInput.value += ch;
    renderKeyboardText();
}

function kbDelete() {
    t9Commit();
    searchInput.value = searchInput.value.slice(0, -1);
    renderKeyboardText();
}

function t9Commit() {
    if (!t9State) return;
    clearTimeout(t9State.timer);
    t9State = null;
    if (!tvKb.hidden) { renderKeyboardText(); renderT9Hint(); }
}

function t9Press(digit) {
    if (tvKb.hidden) openKeyboard();
    const chars = T9[digit];
    if (t9State && t9State.digit === digit) {
        // stejná číslice: přepsat poslední písmeno dalším v pořadí
        clearTimeout(t9State.timer);
        t9State.index = (t9State.index + 1) % chars.length;
        searchInput.value = searchInput.value.slice(0, -1) + chars[t9State.index];
    } else {
        t9Commit();
        t9State = { digit, index: 0, timer: null };
        searchInput.value += chars[0];
    }
    t9State.timer = setTimeout(t9Commit, T9_TIMEOUT);
    renderKeyboardText();
    renderT9Hint();
}

function kbSubmit() {
    t9Commit();
    const q = searchInput.value.trim();
    tvKb.hidden = true;
    document.body.classList.remove('kb-open');
    if (q) search(q);
    else tvFocus(searchInput);
}

$('kbSpace').addEventListener('click', () => kbInsert(' '));
$('kbDelete').addEventListener('click', kbDelete);
$('kbClear').addEventListener('click', () => { t9Commit(); searchInput.value = ''; renderKeyboardText(); });
$('kbSubmit').addEventListener('click', kbSubmit);
tvKb.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => {
    kbLayout = b.dataset.layout;
    renderKeyboardKeys();
    tvFocus(tvKb.querySelector('.kb-key'));
}));
// Ukazovátko (např. LG Magic Remote) – klik do pole otevře klávesnici
searchInput.addEventListener('click', () => { if (isTv()) openKeyboard(); });

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

    updateFilterBadge();
    routeFromHash(true);
})();
