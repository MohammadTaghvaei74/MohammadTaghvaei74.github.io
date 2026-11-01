# Sorena Watch design extras

Optional browser module for the comparison panel and overview personalization. It is intentionally standalone: it does not change HTML, wrap `fetch`, mutate accepted payloads, or compute trade recommendations.

## Files

- `market/design-extras.js` — UMD-style module. Exposes `window.SorenaExtras` and CommonJS helpers.
- `market/design-extras.css` — scoped component styles with `--ds-*` token fallbacks.
- `tests/design_extras.test.cjs` — contract, provenance, identity, persistence, missing-value, and safety tests.
- `tests/design_extras_browser.py` — local Chrome gate at `http://127.0.0.1:8765`; saves a JSON report and screenshots outside the repository by default.

## Load/integration

Load the CSS after the shared design-system CSS and the script after the page’s accepted snapshot producer (or with `defer`):

```html
<link rel="stylesheet" href="market/design-extras.css?v=1">
<script src="market/design-extras.js?v=1" defer></script>
```

For a page under `market/`, use the relative equivalent (`design-extras.css` and `design-extras.js`). The script auto-mounts once into the first `main`; on the overview route it finds `main#overview` and manages only its known overview groups. It creates the compact **تنظیم نمایش / مقایسه** toolbar inside `main`.

The existing overview loader already emits the accepted payload as:

```js
window.dispatchEvent(new CustomEvent('market:snapshot', { detail: acceptedMarketSnapshot }));
```

The module listens to this event. A host may also supply a payload explicitly, which is useful for an integration test or a page that already owns the fetch:

```js
window.SorenaExtras.mount({
  snapshot: acceptedMarketSnapshot,
  funds: acceptedFundsPayload,
});
```

`acceptedMarketSnapshot` is the existing `market/data/market.json` contract (`stocks`, `leveraged`, row timestamps, and optional `fund_report`). `acceptedFundsPayload` is the existing `market/data/funds.json` contract (`rows`, `portfolio_contract`). The module can lazily read those same public snapshots only after the user opens comparison and selects **دریافت داده مقایسه**; it does not create a second market collector. Hosts can push a later accepted payload with:

```js
window.SorenaExtras.accept(snapshot, fundsPayload);
```

## Comparison contract

- Up to four selections are allowed.
- All selected instruments must be the same type (`symbol` or `fund`). Mixed-type options are disabled and the pure helper `selectComparable()` rejects them.
- Symbol metrics are raw `score`, raw `last_pct`, and raw `trade_value_toman` when present. Units are shown as امتیاز خام, درصد, and تومان.
- Fund report values stay distinct from board observations:
  - `portfolio_score`, report `board_score`, and `bubble_pct` are marked as report values with the report/portfolio date when present.
  - `liquidity` is marked historical and keeps its source basis; it is not given a holdings report date or a live freshness label.
  - live fund `board_score`, `last_pct`, and `trade_value_toman` are used only when a matched accepted board row exists. Instrument IDs are preferred; a same-symbol join is used only when the report has no instrument ID.
- A missing, blank, non-finite, or unavailable value is displayed as **در دسترس نیست**, never as zero.
- A missing observation timestamp says that freshness cannot be verified. A stale label comes from the existing `ObservationSafety.freshness()` policy when that API is present; the module does not invent a fetch-time freshness threshold.
- Values are created with DOM `textContent`/text nodes. Source-provided strings are never inserted with `innerHTML`.
- The panel explicitly says that it is a raw-data comparison and does not calculate buy/sell recommendations.

The public API also includes `catalog()` / `buildInstrumentCatalog()`, `selectComparable()`, `metricStatus()`, `readPreferences()`, and `writePreferences()` for host-side tests.

## Personalization contract

The overview control lists the existing groups: daily overview, intraday charts, queue count, market focus, comprehensive table, and industries. It never deletes data or changes navigation. Visibility is controlled with a scoped `data-sorena-extras-hidden` attribute; order is applied by moving the existing group nodes in the overview DOM. The default is all sections visible in their existing order.

Preferences are best-effort in localStorage under:

- layout: `sorena-watch:design-extras:layout:v1`
- comparison selection: `sorena-watch:design-extras:selection:v1`

Malformed data, blocked storage, and quota errors fall back to all-visible/default order and keep the UI usable. The reset button restores that default. Hash navigation to a hidden overview group reveals it before navigation, so personalization does not strand an anchor.

## Tests and artifact evidence

Start the server from the repository root:

```sh
python -m http.server 8765
```

Run focused tests:

```sh
node --test tests/design_extras.test.cjs
python tests/design_extras_browser.py
```

The browser gate exercises real local Chrome at 1440px and 390px, checks the accepted market/fund feeds, four-item cap, reset/remove controls, explicit report/live provenance, text-node safety, navigation preservation, persistence across reload, visibility/order reset, mobile width bounds, hostile values, unavailable values, and blocked localStorage. By default it writes screenshots and `report.json` below the OS temp directory (`%TEMP%/sorena-design-extras`). Pass `--output <folder>` to choose another evidence folder.

No repository HTML or shared shell/CSS files are required to load this optional module.
## Current source contracts inspected

The implementation was checked against `market/data/market.json`, `market/data/funds.json`, `market/core.js`, `market/observation-safety.js`, and the existing `market:snapshot` event. It does not use generated page-load time as an observation timestamp and does not infer missing numbers.
