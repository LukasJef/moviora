<p align="center">
  <img src="pages/public/moviora_logo.png" alt="Moviora" width="260">
</p>

<p align="center">Filmy a seriály na jednom místě – vyhledávání v ČSFD a IMDb, výběr zdroje a vlastní přehrávač.</p>

---

## Co umí

- **Vyhledávání** ve filmových databázích ČSFD, CZDB a IMDb, s plakáty, popisem, herci a hodnocením.
- **Výběr zdroje** seřazený podle shody s filmem: rok, stopáž, velikost, kvalita a jazyk (CZ dabing / původní znění).
- **Vlastní přehrávač** přes celou obrazovku – pokračování tam, kde jsi skončil, další díl u seriálů, volba kvality, titulky a klávesové zkratky.
- **Knihovna** – rozkoukané filmy a oblíbené, uložené přímo v prohlížeči.
- **Aplikace (PWA)** – tlačítkem „Stáhnout aplikaci“ se dá nainstalovat na Windows, Android i macOS. Když server neodpovídá, aplikace to ukáže a sama se znovu připojí.
- **Režim pro televizi** – na chytrých televizích se zapne sám (nebo tlačítkem v patičce, případně `?tv=1`) a celá stránka se ovládá šipkami a tlačítky OK / Zpět na dálkovém ovladači.
- **Čeština a angličtina** – jazyk rozhraní se volí podle prohlížeče a dá se přepnout nahoře.

### Ovládání na televizi

| Tlačítko | Co dělá |
|---|---|
| ← ↑ → ↓ | pohyb mezi prvky stránky |
| OK | výběr; na zdroji rovnou spustí přehrávání |
| Zpět | o krok zpět (zavře přehrávač, vrátí na výsledky…) |
| ← → v přehrávači | přetočení o 10 s |
| ▶❚❚, ⏩, ⏪, ⏭ | přehrát / pauza, ±30 s, další díl |

V přehrávači na počítači: `mezerník` pauza, `F` celá obrazovka, `M` ztlumit, `C` titulky, `N` další díl, `Esc` zavřít.

## Struktura

```
moviora/
├── pages/                 web – Cloudflare Pages (kořen projektu)
│   ├── package.json       sestavení app.legacy.js pro starší prohlížeče (televize)
│   └── public/            co se nasazuje
│       ├── index.html     vzhled a styly
│       ├── app.js         logika aplikace
│       ├── sw.js          service worker (instalovatelná aplikace, režim offline)
│       ├── manifest.webmanifest
│       └── icons/
└── server/                API (Node.js + Express)
    └── server.js          vyhledávání, ČSFD, zdroje a odkazy na video
```

Při sestavení na Cloudflare se z `app.js` automaticky vytvoří `app.legacy.js` pro starší prohlížeče v televizích. Stránka si sama vybere, kterou verzi načíst; `app.legacy.js` se proto do repozitáře nenahrává.

## Technologie

- Frontend: čisté HTML, CSS a JavaScript bez frameworku, písmo [Archivo](https://fonts.google.com/specimen/Archivo).
- Backend: Node.js, Express, [node-csfd-api](https://github.com/bartholomej/node-csfd-api), axios.

---

<p align="center">
  Created by <a href="https://atrixx.org/">Atrixx</a><br>
  This content was assisted in collaboration with <a href="https://claude.ai">Claude (Anthropic)</a>
</p>
