# Industry compact baseline release QA — 2026-10-31

Implementation: `0200d356` (rebased onto `43a036b5`, preserving concurrent distribution-heading/range-label changes).

## Rendered public acceptance

Fresh isolated headless Chrome via `tests/industry_compact_browser.py` (not attached to user's browser).

Verified both:
- https://mohammadtaghvaei74.github.io/market/#industries
- https://94-101-184-98.sslip.io/market/#industries

1517px viewport: 49 industry rows, 8 columns, table 1475px / available 1475px, horizontal overflow 0px, section-index elements 0, operators only blank/=/</>, preset input rank 25, page errors []. Comprehensive comparison dropdowns also contain only blank/=/</>.

40 rendered mean/ratio rows verified against their current turnover values; 9 unavailable histories remain em dashes.

## Independent source audit

Read-only SQLite daily_stock_summary.final_turnover_toman grouped by industry and date, excluding current day. Complete-day list from v2_days.complete=1:
2026-10-28, 27, 26, 25, 24, 21, 20, 19, 18, 17, 14, 13, 12, 11, 10.
All 40 available industry baselines and ratios matched independent SQL/Python calculations at relative tolerance 1e-12.

Sample: تولید محصولات کامپیوتری الکترونیکی ونوری
- Snapshot: 2026-10-31T10:28:01.311775+03:30
- Mean: 128149729902.66667 toman
- Current: 75840750091 toman
- Ratio: 0.5918135773567622
- Rendered: ۱۲۸ billion toman / ۰٫۵۹×

## Test results

Focused Python: 5 passed. Full Python: 92 passed, 1 pre-existing failure (blocking SheetJS CDN in index.html). Full Node: 50 passed, 1 pre-existing failure (optional chaining in symbols/symbols.js:25). Both pre-existing patterns confirmed against baseline Git files. Changed JS syntax checks and git diff --check pass.

Strict baseline tests cover exclusion of current/incomplete days, exactly 15 valid daily industry observations, missing day, invalid member daily turnover, and ratio arithmetic. Existing 5/10/20-day semantics preserved.

## Deployment and limits

Published source branch and main; deployed only checked UI patch hunks into /srv/sorena, preserving unrelated server changes. Industry-page heading badges removed with a targeted substitution because that page differed from Git baseline. Producer module installed in /root/bourse-site/market/industry_table.py; actual direct publisher at /root/bourse-alert/publish_minute_direct.py patched at exact anchor after SHA-256 guard. Backup: /root/industry-compact-backup-1793430289. Publication-boundary rebuild uses read-only SQLite. Public snapshot enriched under publisher flock without changing its source timestamp.

Ongoing minute refresh is NOT verified healthy: existing client-metric guard rejects collector rows with absent buy-per-capita/buyer-power/legal metrics (observed before deployment at 10:29:39 and after at 10:35:23). No validation bypass or fabricated refresh was applied. The last valid published snapshot remains available. Fixing collector freshness is separate from these six UI/data changes.
