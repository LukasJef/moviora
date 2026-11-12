<p align="center">
  <img src="pages/public/moviora_logo.png" alt="Moviora" width="260">
</p>

<p align="center">Filmy a seriály na jednom místě – vyhledávání v ČSFD a IMDb, výběr zdroje a vlastní přehrávač.</p>

---

## Co umí

- **Vyhledávání** ve filmových databázích ČSFD, CZDB a IMDb, s plakáty, popisem, herci a hodnocením.
- **Výběr zdroje** seřazený podle shody s filmem: rok, stopáž, velikost, kvalita a jazyk (CZ dabing / původní znění).
- **Vlastní přehrávač** přes celou obrazovku – pokračování tam, kde jsi skončil, další díl u seriálů, volba kvality, titulky a klávesové zkratky.
- **Domovská obrazovka** – naposledy přehraný film nebo seriál přes celou obrazovku s tlačítkem Pokračovat, pod ním nabídka z ČSFD. Nahoře záložky Domů, Seriály, Filmy, Oblíbené a Pokračovat (na mobilu dole).
- **Filtry** – vyhledávání jde zúžit podle typu, žánru a roku vydání; bez hledaného textu se dá podle filtrů procházet žebříček ČSFD.
- **Knihovna** – rozkoukané filmy a oblíbené, uložené přímo v prohlížeči.
- **Profil** – historii, pozice v dílech, oblíbené a nastavení jde v Možnostech exportovat do souboru `.mw` a jinde importovat, nebo rychle přenést šestimístným kódem (profil je na serveru nejvýš minutu).
- **Sdílení** – každý film má odkaz typu `https://moviora.win/#film=tt0133093&9499` (IMDb a/nebo ČSFD id).
- **Aplikace (PWA)** – tlačítkem „Stáhnout aplikaci“ se dá nainstalovat na Windows, Android i macOS. Když server neodpovídá, aplikace to ukáže a sama se znovu připojí.
- **Režim pro televizi** – na chytrých televizích se zapne sám (nebo v Možnostech, případně `?tv=1`) a celá stránka se ovládá šipkami a tlačítky OK / Zpět na dálkovém ovladači.
- **Čeština a angličtina** – jazyk rozhraní se volí podle prohlížeče a dá se přepnout v Možnostech.

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
    ├── server.js          vyhledávání, ČSFD, zdroje, odkazy na video, synchronizace profilu
    ├── admin.js           ovládací panel (HTTPS, vlastní port)
    ├── admin.html         stránka ovládacího panelu
    └── tools/
        └── set-admin.mjs  nastavení účtu pro ovládací panel
```

Ovládací panel umí za běhu vypnout a zapnout API i synchronizaci, ukázat a změnit přihlášení k Přehraj.to, obnovit nabídku, vyčistit mezipaměti a zobrazit log. Jeho nastavení (`config.json`) a certifikát se do repozitáře nenahrávají.

Při sestavení na Cloudflare se z `app.js` automaticky vytvoří `app.legacy.js` pro starší prohlížeče v televizích. Stránka si sama vybere, kterou verzi načíst; `app.legacy.js` se proto do repozitáře nenahrává.

## Technologie

- Frontend: čisté HTML, CSS a JavaScript bez frameworku, písmo [Archivo](https://fonts.google.com/specimen/Archivo).
- Backend: Node.js, Express, [node-csfd-api](https://github.com/bartholomej/node-csfd-api), axios.

---

<p align="center">
  Created by <a href="https://atrixx.org/">Atrixx</a><br>
  This content was assisted in collaboration with <a href="https://claude.ai">Claude (Anthropic)</a>
</p>
