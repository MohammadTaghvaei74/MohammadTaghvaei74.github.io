#!/usr/bin/env python3
"""Download and parse only identity-verified monthly investment workbooks."""
from __future__ import annotations
import hashlib
import json
import urllib.request
from pathlib import Path

import build_fund_portfolios as extractor


def metadata_index(market):
    metadata = {}
    for row in market.get("stocks", []):
        symbol = row.get("symbol")
        name = row.get("description") or row.get("company_name") or symbol
        if not symbol or not name:
            continue
        metadata[symbol] = {
            "symbol": symbol,
            "company": name,
            "info": {"lVal30": name, "lVal18AFC": symbol,
                     "sector": {"lSecVal": row.get("industry")}},
        }
    return extractor.company_index(metadata)


def download(url, cache_dir):
    path = cache_dir / (hashlib.sha256(url.encode()).hexdigest() + ".xlsx")
    if not path.exists():
        payload = urllib.request.urlopen(url, timeout=120).read()
        if not payload.startswith(b"PK"):
            raise ValueError("attachment is not an XLSX workbook")
        path.write_bytes(payload)
    return path


def main():
    root = Path(__file__).resolve().parent
    market = json.loads((root / "data/market.json").read_text(encoding="utf-8"))
    discovery = json.loads((root / "data/investment-report-discovery.json").read_text(encoding="utf-8"))
    index = metadata_index(market)
    cache_dir = root / "data/codal-investment-cache"
    prior_path = root / "data/investment-portfolio-reports.json"
    try:
        prior = json.loads(prior_path.read_text(encoding="utf-8"))
        reports = dict(prior.get("reports", {}))
    except (OSError, ValueError, TypeError):
        reports = {}
    for symbol, found in sorted(discovery.get("reports", {}).items()):
        if found.get("status") != "found" or not found.get("source_url"):
            continue
        try:
            workbook = download(found["source_url"], cache_dir)
            holdings, evidence = extractor.extract(workbook, symbol, found.get("report_date"), index)
            excluded = sum(float(item.get("excluded_non_equity_pct") or 0) for item in evidence)
            equity_total = sum(float(item.get("weight_pct") or 0) for item in holdings)
            matched = sum(float(item.get("weight_pct") or 0) for item in holdings if item.get("symbol"))
            reports[symbol] = {
                "report_date": found.get("report_date"),
                "source_url": found["source_url"],
                "source_note": "فقط ردیف‌های گزارش ماهانه با تطبیق هویت کدال/بازار وارد محاسبه شده‌اند؛ موارد بدون نماد حذف نشده‌اند و در ریز پرتفو باقی می‌مانند.",
                "holdings": holdings,
                "cash_weight_pct": max(0.0, 100.0 - equity_total - excluded),
                "unlisted_weight_pct": excluded,
                "coverage_pct": matched,
            }
            print(symbol, "verified", len(holdings), round(matched, 3))
        except Exception as exc:
            print(symbol, "unavailable", type(exc).__name__, str(exc))
    output = {"schema_version": 1, "source": "verified monthly investment activity reports", "reports": reports}
    (root / "data/investment-portfolio-reports.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verified_reports": len(reports), "discovered": len(discovery.get("reports", {}))}, ensure_ascii=False))


if __name__ == "__main__":
    main()
