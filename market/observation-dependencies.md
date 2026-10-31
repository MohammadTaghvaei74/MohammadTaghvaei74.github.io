# Comprehensive preset observation contract

The renderer passes its actual merged rows and `Object.keys(presets[name])` to the gate. Unknown proof fails closed. A fresh quote does not validate carried client metrics or historical averages.

- Quotes: actual observation, current Tehran day, <=120 seconds old, no future members.
- Legal buy/sell inputs: finite metric, `client_type_status: "ok"`, `client_type_date` equal to current Tehran day, and actual `client_type_observed_at` satisfying the live clock guard. `client_type_fetched_at` is NOT an observation and is never used as one. A date alone cannot prove intraday freshness.
- `avg_trade_value_toman`: source-owned `avg_trade_value_provenance` with `validated: true`, date-only `as_of` equal to current Tehran session, `window_start` 30 calendar days before that date, `window_end_exclusive` equal to it, and nonempty `expected_sessions` / `observed_sessions` with exactly matching unique valid day sets inside the window. The producer must validate the expected trading-session calendar and each symbol's finalized observations before asserting this contract. These dates describe historical coverage, not invented observation hours.
- This corresponds to `queue_data.average_turnovers`' preceding 30-calendar-day window, not the separate 15-session fallback or 10-day score total. The two current presets do not depend on `score_10d_total`.
- Proof from fallback rows may not validate metrics from a different snapshot; substituted 15-day averages are not the same historical metric.

**Current production producers do not emit this complete observation/coverage proof. Presets intentionally remain unavailable until independently validated source metadata exists. This release does not fabricate metadata or claim that data collection has recovered.**

Symbol chart clocks consume `#scoreChart.observedScorePoints`, committed by the renderer from the same valid OHLC points that create chart hit targets. No DOM-based reconstruction of timeframe/day selection occurs; an empty current-day 1m chart explicitly reports no observation even if the payload includes previous days.

Verification: `node --test market/test-observation-safety.cjs market/test-preset-dependencies.cjs` and `python market/test-dependency-browser.py [base-url]`. Browser interception is synthetic fixture testing only and never writes production data.
