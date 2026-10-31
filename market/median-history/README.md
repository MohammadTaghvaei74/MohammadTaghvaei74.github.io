# Median score history — production release

Public: https://94-101-184-98.sslip.io/market/median-history/
Feed: https://94-101-184-98.sslip.io/market/data/median-history.json
Entry link is additive below the existing market chart heading. Existing charts/navigation/assets are not replaced.

## Contract
- This is median **score**, not price OHLC or investment advice.
- All eligible traded ordinary equities in each observed snapshot; leaders are the collector's then-current leader subset, not today's top five. Counts are stored alongside the actual aggregate.
- One minute key in Asia/Tehran; latest real observation wins. 09:15 through 12:30 inclusive. Empty cohorts are null, never zero-filled.
- Retention: today and preceding 29 Tehran calendar dates. Deletes touch ONLY `median_minutes` in the new `/root/bourse-alert/median_history.sqlite`. No existing archive database is pruned.
- Direct collector hook persists before the large historical archive transaction. A separate enabled systemd timer exports/prunes every 30 seconds, including non-trading days. No shared JSON handoff is trusted for history ingestion.
- Daily or 15/30/60-minute OHLC only for non-empty observed buckets. Partial buckets remain explicitly marked.
- Line: last real observation per 10-minute bucket anchored at 09:15, final bucket 12:25–12:30. Any missing minute between sampled observations breaks the segment; days never connect.
- Coverage lists actual recorded minutes, missing ranges, and dates without observations. No claim that missing dates were trading days. Current-day future minutes remain an explicitly incomplete session, not fake data.

## Conservative migration
`backfill_median_history.py` imports only Oct27 onward timestamps explicitly logged by the authoritative independent collector. It joins exact timestamp market and leader group rows and verifies market aggregate count/median equals the group aggregate. No membership is reconstructed using the current leader list. Oct26 backup collector code confirms the same eligible/traded and leader-group aggregation, while older unproven versions are deliberately excluded. Initially 453 exact timestamps matched, zero rejected; after the session-window/minute fence, 411 observations over three dates were exported. Live collection continues automatically.

## Oct28 opening-hour incident
Confirmed evidence:
1. `market_snapshots` contains 723 Oct28 rows from 09:00:06.911167 to 12:30:20.751393. Hours 09/10/11/12 contain 59/58/59/29 distinct minutes. It was **not** a complete absence of early source data.
2. The collector journal records successful pre10:25 saves (e.g. 10:14:00.969974, 10:24:00.317295).
3. The old handoff appended distinct timestamps, not minute keys, and retained `intraday[-240:]`. More than one event per minute therefore evicted the opening hours before session close.
4. TWO abandoned Python stdin QA processes imported `minute_chart_collector` on Oct26 at 20:08:24 and 20:31:44. Because its loop lacked a `__main__` guard, imports never returned and ran duplicate live collectors alongside systemd. PID1363308 was confirmed by py-spy: `persist_live -> collect_once -> module -> importlib -> <stdin>:1`. PID1373663 was directly identified from its still-running parent QA command. Both exact orphan PIDs were terminated; the real systemd collector was retained/restarted.
5. On Oct31 before repair the shared handoff had 174 distinct timestamps in roughly 94 minutes, with several observations in the same minute. This reproduces the raw-event-ring failure mechanism.
6. Git archive Oct28 13:07/14:10 snapshots contain 211 minute points back to09:00; they are NOT the screenshot's truncated live payload. The exact screenshot payload was not preserved, so the exact 10:25 cutoff cannot be reconstructed conclusively. The confirmed duplicate-writer/raw-ring defect is causal for lost opening data, while the screenshot's precise boundary remains qualified.

Fix: main guard, minute-key deduplication before the existing240 limit, direct isolated persistence, and removal of the two proven orphan writers. Existing chart visualization remains untouched. Gaps from provider/enrichment/old DB-lock delays remain real and explicitly visible; the feature does not fabricate missing minutes.

## Verification
- Python: six focused tests (session boundaries, calendar retention, unrelated-table preservation, latest-minute wins, null/nonfinite, future rejection, coverage gaps).
- Node: OHLC, incomplete candles, intraday buckets, null omission, last-observation10m, intra-minute gaps and day boundaries. Run locally because production host does not have node.
- Isolated headless Chrome/Playwright on public HTTPS at1440×1000 and390×844: both charts, all series toggles, daily/30minute control, Oct28 day selection, OHLC hover, line hover, mobile tap, no page overflow, usable controls, main-page entry link, and no page errors. Desktop controls180/195/220px; mobile366px; body scrollWidth=viewport at both widths.
- Automated timer observed exporting411→414→415 minute records without manual refresh.

## Release/rollback
Isolated Git worktree `/root/bourse-history-release`, branch `feat/median-history-30d`. Stage only `market/index.html` and `market/median-history`. Do not stage probe files, generated JSON/DB, unrelated primary changes, or bytecode.
Collector source backup: `minute_chart_collector.py.before-median-history-20261031`; scoped patch under ops/collector.patch. HTML backups on primary checkout and served origin similarly named. Review before rollback; do not restore the import-side-effect bug or restart orphan QA processes. To disable the feature exporter use `systemctl disable --now bourse-median-history.timer`; history database can remain intact.
