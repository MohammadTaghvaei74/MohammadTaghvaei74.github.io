# Fund portfolio data extraction

This is an isolated, manually invoked data builder. No live publisher, timer or
service was modified. `verified` means the actual XLSX identity/date and equity
table were verified; it does **not** assert latest available report or complete
industry mapping. Unavailable funds remain present with empty holdings.

## Reproduce on VPS

```sh
cd /root/bourse-site-fund-portfolio
python3 -m unittest discover -s market/tests -p test_fund_portfolios.py -v
python3 market/build_fund_portfolios.py \
  --funds /root/bourse-alert/fund-portfolio-evidence/universe.json \
  --metadata /root/bourse-alert/fund-portfolio-evidence/metadata.json
```

Uses only Python standard library. Default source manifest is
`market/fund-portfolio-sources.json`. Normal defaults read the current public
universe and metadata; the explicit frozen inputs above reproduce this snapshot.
Raw downloaded workbooks are outside git, named by SHA256 of exact source URL:
`/root/bourse-alert/fund-portfolio-evidence/<url-sha256>.xlsx`.
`manifest.json` records actual file SHA256, workbook identity, period, sheet/header
coordinates, matched count and worksheet-total reconciliation. `validation.json`
records coverage. The evidence directory also retains discovery failures, recovered
attachment HTML, historical notice JSON, discovery scripts and frozen inputs.

## Semantics and safety

- Cell coordinates, not compact row positions; shared and inline strings supported.
- Merged-cell anchors only: hidden stale values must not override visible dates.
- Percent Excel styles multiply stored fraction by 100. Plain numeric values are
  already percentage points. No inferred scaling based on value and no renormalization.
- Equity headers discovered across sheets and split header rows. Income,
  commodity, deposit, bond and derivative sheets excluded. Equity section stops
  at its total, so commodities below it are not misclassified as stocks.
- Carry-forward rows are excluded (the historical Fiروزه 229% bug).
- Rights explicitly prefixed `ح.` or identified as حق تقدم and named fund units
  are excluded; their weights are included in worksheet-total reconciliation.
- Unknown company names retain raw text and null symbol/industry. Matching uses
  only authoritative metadata company names, normalized Arabic/Persian glyphs,
  whitespace and punctuation. An appended ticker is accepted only when both full
  company name and symbol match metadata. No fuzzy or substring company matching.
- Explicit fund identity aliases are versioned in the builder, not inferred by a
  fuzzy holding matcher. Report period is taken from visible workbook text, even
  if an old source manifest has a different period.
- A total discrepancy over 0.1 percentage point rejects the fund. Some worksheets
  do not label their total; no labelled-total reconciliation is claimed for those.

## Known source limitations

Codal search API repeatedly timed out/reset on VPS and local machine. Broader
query and legacy ReportList HTML did not recover the missing records; my.codal.ir
failed TLS certificate verification. Historical notices successfully recovered
five additional exact attachments, freshly downloaded and parsed.

Four local cached XLSX files exist but lack a recoverable exact original URL:
`codal_1605660.xlsx` (بیدار), `codal_1590911.xlsx` (شتاب),
`codal_1606541.xlsx` (آساس), `codal_1605349.xlsx` (جهش).
They were preserved in the evidence directory, but NOT published as verified
holdings with invented source links. Latest-report completeness remains unverified.

Industry completeness is also limited by metadata (including 258 entries with
`info_error`) and different abbreviated company names in workbooks. Null industry
must remain visible as unknown, not assigned or redistributed.
