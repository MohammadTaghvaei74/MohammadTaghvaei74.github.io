# Daily trade-value contract (2026-11-01)

The overview's existing daily turnover chart (`renderTurnoverChart`, `data.daily.final_turnover_toman`) is ONLY ordinary shares plus all leveraged funds. It is a finalized historical series, not a real-time header total.

- Source: full raw MarketWatch `YYYYMMDDT123000_stocks.json.gz`, gated by `v2_days.complete=1` and a recognized same-date post-close provenance stamp. Never use the old `v2_days.turnover` aggregate as the metric.
- Ordinary shares: security-code prefixes IRO1/IRO3/IRO5/IRO7 and no numeric block-board suffix. Rights (IRR), other funds (IRT), bonds (IRB), energy certificates (IRE), options and futures are excluded.
- Leveraged funds: IRT1/IRT3 with family 5A/TA. This includes ALL nine observed funds, not the separate seven-symbol score panel's whitelist.
- Value: MarketWatch column 10, cumulative rial / 10 = toman; UI divides by 1e12 for HMT. Decimal arithmetic before serialization. Missing/negative/nonfinite or duplicate eligible rows fail closed.
- Publish independent stocks and leveraged components, counts, scope marker and raw/source timestamp. Do not restamp live market freshness when refreshing history.
- Missing historical archives remain null/unavailable, never old stocks-only amounts or zero. Preserve previously verified scoped records when raw retention expires. MA5/MA20 require complete consecutive windows; gaps are not skipped.

At release: 20 verified days Oct 5–Nov 1; 12 older days unavailable. Nov 1 12:30 Tehran: 763 shares, 27,350,707,192,217.1 toman; 9 leveraged funds, 2,461,779,408,374 toman; sum 29,812,486,600,591.1 toman (29.8124866005911 HMT). Live snapshot remains 12:29 and is not called current.

Tests: pytest tests/test_turnover_scope.py tests/test_daily_turnover.py; node tests/test_turnover_scope_ui.cjs. Full suite baseline has 11 existing failures (navigation, obsolete SheetJS assertion, incomplete publisher fixture); candidate has the same 11 and ten added passing tests. Cold mobile browser gate tests blocked and pending live origin plus pending optional SheetJS.
