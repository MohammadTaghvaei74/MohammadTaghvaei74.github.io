# Completed daily turnover contract

- Source: read-only `/root/bourse-alert/scores_history.db`, `v2_days.complete=1`.
- Values are ordinary-share cumulative turnover **toman**, as written by the post-close parser (`sum(trade_value_toman)`) or the persisted-close finalizer (`daily_market_summary.final_turnover_toman`). Display divides by 1e12 for HMT.
- Accept only the two existing finalization source prefixes, timezone-aware same-day source timestamps at/after 12:30, not future, and finite nonnegative totals. Unknown/unfinalized rows are excluded, never fabricated. Keep source per row for audit.
- Full retained history is used; 18-day summary retention is not a completeness boundary. At deployment, 30 finalized days through 2026-10-28 exist; Oct 31 is still intraday.
- Historical refresh runs before both live-window and same-source early returns, under the existing publisher flock. It changes only `daily`/`daily_meta`; source/publication/health timestamps and live freshness guards are untouched. Existing timer runs every trading weekday minute, including after close.
- Deploy `daily_turnover.py` to `/root/bourse-site/market/`; the inspected publisher snapshot is in `deploy/publish_minute_direct.py`. Do not blindly overwrite a newer publisher: compare remote bytes, merge concurrent changes, use the shared flock and atomic replace. Backup: `/root/bourse-alert/publish_minute_direct.before-completed-daily.py`.
- UI: first homepage section, chronological blue bars; literal straight-segment MA5/MA20 full trading-day windows; Persian calendar labels and native date/value tooltips. No fabricated zeros, interpolation or capping. Missing MA history is explained.
- Tests: `python -m pytest tests/test_daily_turnover.py tests/test_daily_publisher_refresh.py -q`, `node tests/test_daily_turnover_chart.cjs`. Full suite has a pre-existing SheetJS nonblocking failure (`cdn.sheetjs.com` already present on origin/main); do not conflate it with this feature.
