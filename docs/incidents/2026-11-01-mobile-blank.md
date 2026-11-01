# Mobile blank dashboard — 2026-11-01

## Incident and confirmed cause
The canonical GitHub Pages HTML and JSON were available, but a cold mobile client could not render its tables when the live sslip.io host was unreachable. The overview loader hardcoded that host; observation-ui globally rewrote same-origin market/comprehensive fetches to it; signals also hardcoded it. Changing a caller alone would not escape the wrapper. Prior investigation diagnosed the origin dependency but did not ship a correction. HTTP-200 checks of public JSON were insufficient.

Failure injection against the pre-fix public page yielded zero leader and comprehensive rows after 15 seconds with the live host blocked. A separate indefinitely delayed SheetJS request also prevented bootstrap: the optional export script was parser-blocking. An immediately rejected CDN request does not reproduce that latter failure. Browser JavaScript errors were absent: empty rendering can be a network-policy failure without an exception.

## Correction
- Shared transport tries live for at most 2 seconds including JSON body parsing, then same-origin for at most 7 seconds, using the original fetch rather than recursively rewriting fallback.
- Rejects HTTP errors, invalid JSON, empty market stocks and empty comprehensive rows before selecting a response.
- Explicit fallback source, snapshot timestamp and age; existing observation-time safeguards remain intact. A reachable server does not imply fresh observations.
- Visible failure message if both sources fail, without clearing already rendered market state.
- Canonical same-origin caller URLs for overview and signals; wrapper applies bounded transport across subpages.
- Optional SheetJS loads asynchronously and cannot block the dashboard.
- Restored actual 10-second overview refresh (the inspected public code was 60 seconds); refresh tick bypasses completed-fetch throttling while retaining in-flight protection.

## Durable guards and release
`tests/mobile_bootstrap_gate.py` exercises a new isolated mobile Chromium context per case: blocked live host, hanging live host, hanging CDN, total data failure, denied localStorage, ordinary live connectivity and 10-second refresh. It asserts populated rendered tables, fallback source/age, visible failure and no page exceptions. It also checks industries, signals, portfolio, history and the intentionally placeholder options page under origin failure. Signals can correctly show zero current-day events when the feed contains only historical events.

`tests/guarded_mobile_release.py` runs that gate against the exact candidate served from the isolated worktree before it permits Git push. The release used the candidate checkout via a loopback-only SSH tunnel, not partial public asset interception. `.github/workflows/mobile-bootstrap.yml` repeats candidate checks on relevant pushes/PRs and public checks every six hours. This workflow is monitoring, NOT a GitHub Pages deployment dependency; repository branch settings were not changed.

Primary and publisher checkouts contained pre-existing unmerged files. Work proceeded in `/root/bourse-mobile-fix`, branch `fix/mobile-bootstrap-20261101`; generated JSON and merge state were not reconciled or reset. Runtime propagation must use scoped patches, backups and readback so unrelated changes survive.

## Evidence and scope
Local evidence directory: `C:/Users/tabdeal/mobile-dashboard-evidence/` (red.json, cadence-red.json, green-final.json, candidate-release.json, public-final.json plus screenshots). Public verification is a separate acceptance gate after push/CDN propagation.

Tests emulate a mobile browser; they do not constitute physical Android APK/WebView testing. Seven-second same-origin timeout still fails visibly on an extremely slow/offline network. This fixes and guards this dependency class, not every possible future blank-page cause. Existing market freshness/publisher health is distinct from browser reachability and is not declared repaired by these changes.
