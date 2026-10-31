# Live10 remediation — 2026-10-31

## Deployed scope

- Disabled/stopped only `bourse-live-fast.service` (the duplicate introduced by this release).
- Kept `bourse-fast-live.service`, PID 1612269, unchanged. Ten-second schedule, Redis only by inspected call path. 35-second strace: four read-only loads of live_market.json, no write-open, pwrite64, truncate, rename or unlink. This is bounded runtime evidence, not a permanent syscall sandbox guarantee. Its original unit still permits writes to the app directory.
- Collector-only correction: persistent SQLite outbox `minute_archive_pending.sqlite`, with independent retry thread. Real observations are serialized before slow enrichment; archive transactions retain their original timestamps. Existing timeout=2 remains unchanged. Successful archive commit precedes deletion from the outbox; replay is idempotent via existing INSERT OR REPLACE statements. The worker closes DB connections explicitly.
- Cached sector mapping is restored from existing industry_cache.json before archiving/publishing, without extra provider requests. All existing collector client-type, row timestamps, median history and publication features retained.
- Scheduler targets the next minute relative to cycle START, not completion. If work crosses a boundary it collects a fresh observation immediately instead of sleeping through another minute. It does not synthesize past observations.
- `main.py`, the existing fast collector and public renderer were not modified in this remediation.

## Root cause and honest limitations

Read-only lslocks identified PID 1372280 (`main.py --run --send --step3-signals`) holding the scores_history.db-shm WAL write lock at byte 120. Its save_detailed_snapshot transaction includes historical pruning and daily aggregation before commit; the minute collector's two-second inline insert could fail and discard that observation. The outbox removes this data-loss dependency, rather than increasing the timeout or terminating the other writer.

The first live verification FAILED: missing 11:52. The restart at 11:51:48 finished handoff at 11:52:00; old sleep-until-next-minute used completion time and skipped collection at 11:52. Regression test reproduced the boundary condition, scheduler corrected, deployed at 11:56:25, and a new unchanged acceptance window was started. Failed evidence retained in minute-verification-before-scheduler-fix.json.

Archival commit can lag the actual observation while main holds the lock; outbox retains it durably. Network stalls can still delay actual collection; no blanket hard realtime guarantee. The existing main process also writes its own minute snapshots: this work does not remove that pre-existing second minute writer. No 10-second historical writer was introduced. Existing historical gaps are NOT backfilled. Raw_tse files remain owned by the original main pipeline and its older gaps are outside this collector-only remediation.

## Reproducible verification

Server:

```
/root/bourse-alert/venv/bin/python -m unittest discover -s /root/bourse-live10-release/ops/live10 -p 'test_*.py' -v
python3 /root/live10-remediation/verify_remediation.py
python3 /root/live10-remediation/final_host.py
systemctl show bourse-live-fast bourse-fast-live bourse-chart-collector -p Id -p ActiveState -p UnitFileState -p MainPID
```

Windows (installed Chrome; no Playwright download required):

```
python C:/Users/tabdeal/live10-audit/verify_public_final.py
node C:/Users/tabdeal/live10-audit/test_live_order.cjs
node --check C:/Users/tabdeal/live10-audit/app-fast-recovery-20261024-axis.js
```

Browser assertions cover real rendered table hash change, >700 rows, changing rendered timestamps, no reload (navigation count=1), no JS errors, and exactly one fast source. The minute fallback remains a distinct legitimate source. Values named topStockScore are scores of stocks[0], not the market score. Ten-second scheduling is not a maximum end-to-end browser latency claim.

Backups: /root/live10-backup/remediation/minute_chart_collector.py is the exact pre-remediation collector. collector-remediation.patch is the targeted diff. Rollback must stop the collector first, retain the pending outbox (never delete uncommitted observations), restore that backup, then restart; reverting the old collector loses the durable retry behavior.
