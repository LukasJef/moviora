// =====================================================
// Moviora – service worker
// Drží v mezipaměti jen "obal" aplikace (HTML, JS, ikony, písmo),
// aby šla otevřít i bez připojení a ukázala obrazovku offline.
// Data z API se nikdy neukládají.
// =====================================================
const VERSION = 'moviora-v1';
const SHELL = [
    '/',
    '/index.html',
    '/app.js',
    '/moviora_logo.png',
    '/favicon.png',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Vlastní soubory webu: nejdřív síť (ať jsou změny hned vidět), při výpadku mezipaměť
    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(req)
                .then(res => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(VERSION).then(c => c.put(req, copy));
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(req, { ignoreSearch: true });
                    if (cached) return cached;
                    if (req.mode === 'navigate') return caches.match('/index.html');
                    return Response.error();
                })
        );
        return;
    }

    // Písmo z Google Fonts: z mezipaměti, na pozadí obnovit
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.open(VERSION).then(async cache => {
                const cached = await cache.match(req);
                const network = fetch(req)
                    .then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
                    .catch(() => cached);
                return cached || network;
            })
        );
    }
    // Vše ostatní (API, plakáty, video) jde rovnou na síť
});
