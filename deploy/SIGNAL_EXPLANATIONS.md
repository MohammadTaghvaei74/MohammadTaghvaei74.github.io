# Signal explanations release

- Public route: https://mohammadtaghvaei74.github.io/market/signals/
- Authoritative JSON: https://94-101-184-98.sslip.io/market/data/signals.json (existing nginx CORS `*`). GitHub Pages previously served an October 28 archive, hence zero October 31 rows. Only this route now reads the minute publisher's origin, no archive fallback disguised as live data.
- Runtime: `/root/bourse-alert/event_live_worker.py` imports `event_engine_live`; leader detection uses `leader_signal.evaluate`, not MA distance.
- Leader rule inspected: five-minute window (anchor tolerance one minute), abs change >=1.5, path efficiency >=85%, next sample 30–120 seconds later retaining >=85%. Existing outer-engine cooldown is 600 seconds (the Config's 1800 field is not used by this path). No trading rules changed.
- `deploy/leader_signal.py` is the deployed module plus evidence persistence only. `signal_trigger_evidence` captures start/trigger/confirmation scores/times and thresholds; public exporter only includes evidence joined to corroborated sent delivery.
- `deploy/replay_signal_evidence.py` uses the identical evaluator without sending or altering pending/state/outbox/delivery. Historical matches are **reconstructed**, explicitly not contemporaneously recorded rule versions. Missing matches remain unavailable; never guess from MA distance. Re-run is idempotent.
- Other signal types show their exact provider message including before/after values when recorded, explicitly noting unrecorded thresholds/intervals cannot be verified. `gap` correctly maps to allocation, not queue pressure.
- Only scoped files are installed; dirty server checkout is not reset or pulled. Existing exporter chmod fixes must survive. Backups and preconditions precede atomic writes.
- Tests: Python exporter/privacy/freshness/evidence suite; Node legacy/missing explanation/route/4-column/filter/refresh suite; real browser checks on public GitHub and origin desktop/mobile, search, empty state, date fence and DOM text.
