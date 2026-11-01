# Data interaction upgrades

Standalone additive module for the audit items TABLE-04, CHART-02/03/04, SIGNAL-02, and the advanced A11Y-04 interaction portions.

## Owned assets

- `market/data-interactions.js`
- `market/data-interactions.css`
- `tests/data_interactions.test.cjs`
- `tests/data_interactions_browser.py`

The module is deliberately not referenced from HTML in this change. The parent integration must add the CSS and deferred script to the pages that render the corresponding controls. The module initializes once on DOM ready and uses an idempotent document observer so it also handles the existing renderer's later table/SVG rerenders.

## Integration contract

Add the following to the overview page after the existing page styles and renderer scripts (and to `market/signals/index.html` for the signal toggle):

```html
<link rel="stylesheet" href="data-interactions.css?v=table-chart-interactions-1">
<script src="data-interactions.js?v=table-chart-interactions-1" defer></script>
```

On the signals page, use `../data-interactions.css` and `../data-interactions.js`. Do not remove or replace the existing filter, snapshot, observation-safety, renderer, or sorting assets.

The adapter delegates data meaning and filtering to the existing controls/event APIs:

- native comprehensive controls remain the source of truth (`.column-filter`, `.filter-operator`, `input`/`change` events);
- native `#clearComprehensiveFilters`, `[data-comprehensive-preset]`, and the existing two-condition `conditions` representation are preserved;
- no new filter engine evaluates market rows and no stale/freshness safety gate is bypassed;
- saved presets are local-only, bounded to 30 entries, and validated before use; malformed data and storage/quota failures render a safe status instead of claiming a save;
- preset names are inserted as text/options, never as HTML.

## Features

### Comprehensive table

A compact, collapsible toolbar mirrors the real table filters, including the existing second-condition representation. It provides:

- visible labels and at least 12px helper/status text;
- active filter chips that clear one native condition when activated;
- reset/clear behavior through the existing clear control;
- named local presets with apply/delete actions and safe storage errors;
- responsive field wrapping and 44px mobile controls.

### Charts

Legend controls are added only when both sides are verifiable:

- `turnoverChart`: `.turnover-bar`, `.ma5-path`, `.ma20-path`;
- `queueChart`: `.chart-buy`, `.chart-sell`;
- `marketChart`: `.chart-leaders`, `.chart-market`;
- `queueCountChart`: `.chart-buy`, `.chart-sell`.

Visibility state is stored on the SVG and reapplied after child redraws. Existing market and queue-count hit areas already supply time/value tooltips with units; the module adds Left/Right keyboard navigation to those hit areas so their existing tooltip path is exercised. Existing turnover bars retain their date and `همت` accessible labels and keyboard focus. Axis labels are hidden adaptively on narrow wrappers only; series data and path values are untouched.

`priceDistributionChart` is intentionally unsupported by this adapter: its bars have no stable, independently associated legend series or verified tooltip contract. It receives no fake legend or tooltip controls. `queueChart` receives legend visibility controls, but has no adapter-created hover tooltip because its current renderer has no stable hit-area/tooltip contract; this limitation is intentional and should not be described as a completed tooltip upgrade.

### Signals

The view toggle hides/shows the existing accepted-data table and renders cards from its four visible cells: type, symbol, time, and explanation. No confidence, liquidity, or other unreported metric is added. Existing query/category filters, no-results rows, unavailable states, and freshness messages stay owned by `signals.js` and remain intact. An empty/no-results row becomes the same honest empty message in the card view.

### Table header accessibility

Only headers with an existing `data-sort-key` are enhanced. The module adds `tabIndex`, `role="button"`, `aria-sort="none"` when absent, and a keyboard hint; it does not add another click/key handler. This avoids double-triggering the existing comprehensive/custom sorter and leaves non-sortable columns untouched.

## Verification

From the repository root:

```bash
node --test tests/data_interactions.test.cjs
node --check market/data-interactions.js
python tests/data_interactions_browser.py
```

The browser gate expects the repository to be served at `http://127.0.0.1:8765` and injects the owned assets at runtime. It verifies toolbar collapse, two conditions, chips, reset, saved presets, safe text labels, responsive sizing, chart series toggle when real series are rendered, signal cards, and header accessibility. These are local/injected checks until the parent adds the assets to HTML.

## Freshness and data safety

This module does not fetch, aggregate, synthesize, or write market data. It does not relax observation safety, accepted snapshot, or stale-data behavior. If a renderer has no accepted rows or a chart has no verified series, the module preserves the renderer's unavailable/empty state or leaves the unsupported chart alone.

No HTML, existing renderer, theme, shell, or comparison files were modified here; no commit or push is part of this module.

## Parent integration requirements

1. Add both assets to the intended overview and signals HTML pages.
2. Keep the asset order after the existing page DOM/renderer dependencies, or rely on the module's DOM-ready/observer behavior when the renderer is deferred.
3. Re-run the local browser gate from the repository root.
4. Confirm the actual loaded asset URLs on the public site before release; source files alone are not deployment proof.
5. If adding a new chart, first establish stable series selectors and a real unit/time tooltip contract; otherwise document it as unsupported rather than adding a synthetic control.

## Limitations

- Browser storage is intentionally best-effort. A denied or full store is reported, and manual filters continue to work.
- Presets are per-browser local state, not shared account preferences.
- `priceDistributionChart` has no legend/tooltip upgrade by design; `queueChart` has legend-only support as documented above.
- This additive change cannot make the live website load the assets until the parent integration updates the owning HTML files.

## Test result recorded during implementation

`node --test tests/data_interactions.test.cjs`: 4 passing tests.

`python tests/data_interactions_browser.py`: 3 passing Chrome checks against the local server, including the injected-asset flow.

`node --check market/data-interactions.js` and `git diff --check`: passing.

The local server was already available at `http://127.0.0.1:8765` during verification.

> The module intentionally remains additive and uncommitted so the parent worker can integrate it without touching the other workers' files.
