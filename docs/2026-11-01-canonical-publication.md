# Canonical fallback publication follow-up — 2026-11-01

## Failure and scope

The direct minute publisher updates `/srv/sorena/market/data`, not GitHub Pages.
The archive publisher invokes worktree/index-oriented Git publication from
`/root/bourse-publish-clean`, which has an active rebase and unmerged market JSON.
Its safety guard correctly refuses that state; bypassing it or resetting either
checkout would risk unrelated work. Detached HEAD also makes `push origin main`
unsuitable for publishing a newly created detached commit. A one-time refresh
and frontend fallback repair alone do not make the canonical data durable.

## Narrow repair

`deploy/canonical_data_publisher.py` is an independent standard-library exporter.
It fetches remote main into a private ref, reads that parent into a temporary
`GIT_INDEX_FILE`, hashes exact validated source bytes, writes a tree, creates a
single-parent `git commit-tree` commit, and pushes its explicit SHA to main.
No checkout, reset, rebase, stash, ordinary index, source data, or DB is modified.
The deployed checkout is `/root/bourse-canonical-publisher`; source and runtime
are deliberately independent of both conflicted checkouts.

The fixed allowlist is market, comprehensive, funds, options, portfolio-special
JSON under `market/data/`. All other paths, frontend, signals, histories and
health are excluded. The mandatory market/comprehensive pair must have the same
source timestamp and symbol universe. Optional feeds fail closed independently,
so an older options feed cannot block the fresh core or overwrite newer options.
Checks reject invalid JSON, duplicate keys, NaN/Infinity, missing schema/identity,
empty rows, duplicate identities, naive/future timestamps, regressing source
clocks and severe row-count collapse. A mismatch during per-file source atomic
writes fails this run and is retried on the next timer. No timestamps are rewritten.

The parent and all validation are refreshed after a non-fast-forward race, at
most three attempts; authentication/transport errors fail without blind retry.
An identical tree prints NO_CHANGE without committing or pushing. Service flock
prevents overlap. Git objects/private fetch ref can advance; HEAD, checked-out
files and normal index do not. Real temporary Git repository tests cover dirty
unmerged indexes, exact bytes, no-op, validation, optional regression, concurrent
frontend release, bounded contention and authentication failure.

## Test result caveat

Six new isolated-publisher integration tests pass on Windows and the VPS.
The broader focused selection had 22 passes and one existing archive-test
failure: `test_main_uses_event_exporter_and_explicit_environment` creates an
empty SQLite fixture without `market_snapshots`, then calls the history exporter.
Neither that test nor the archive exporter is changed in this repair. This is
not claimed as an all-suite pass and is left outside the narrow deployment.

## Operations and acceptance

Install the included service/timer in `/etc/systemd/system/`, daemon-reload, then
`systemctl enable --now bourse-canonical-publisher.timer` and manually start the
service once. Schedule: Sat–Wed, Asia/Tehran, every five minutes 08:45–12:35;
12:30/12:35 are post-archive/final retries. Persistent catch-up is safe: source
timestamps remain historical; no fake freshness or fabricated signals.

Inspect `journalctl -u bourse-canonical-publisher.service` for PUBLISHED,
NO_CHANGE, SKIP or failure. Existing pipeline health watchdog remains unchanged;
canonical comprehensive freshness is a remaining monitoring gap, not claimed
fixed by this release. Keep the legacy archive service untouched: its archive
publication remains blocked until separately reconciled with explicit approval.

Verify remote commit diff is allowlisted, the source bytes match public JSON
(cache-busting HTTPS), and frontend hashes remain unchanged. Today market and
comprehensive already match canonical (762 rows, source 12:29); funds can advance
from Oct27 09:50 to Oct27 21:02. Options source Oct21 must not replace Oct28;
special Oct28 stays unchanged; signals' replay timestamp is intentionally excluded.

Rollback: disable/stop only `bourse-canonical-publisher.timer`; no existing service
needs restarting. Do not reset either conflicted checkout. Data rollback must
also honor monotonic source timestamps rather than blindly reverting old data.
