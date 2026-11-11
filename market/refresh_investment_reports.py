#!/usr/bin/env python3
"""Refresh monthly Codal investment reports without overwriting verified data."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from build_investment_companies import build_payload, is_investment_company
from collect_codal_investment_reports import collect


def atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def symbols_from_market(market: dict) -> list[dict]:
    rows: dict[str, dict] = {}
    for row in list(market.get("investment_catalog") or []) + list(market.get("stocks") or []):
        symbol = str(row.get("symbol") or "").strip()
        if symbol and is_investment_company(row):
            rows[symbol] = row
    return [rows[key] for key in sorted(rows)]


def main() -> None:
    root = Path(__file__).resolve().parent
    market_path = root / "data/market.json"
    raw_path = root / "data/investment-codal-raw.json"
    market = json.loads(market_path.read_text(encoding="utf-8"))
    try:
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        raw = {"schema_version": 1, "reports": {}}
    reports = dict(raw.get("reports") or {})
    symbols = symbols_from_market(market)
    for index, row in enumerate(symbols, 1):
        symbol = row["symbol"]
        previous = reports.get(symbol) or {}
        result = collect(symbol)
        # Rate limits, WAF pages, and transport errors are not evidence that an
        # earlier verified report disappeared. Keep the last verified report.
        if result.get("status") == "verified":
            reports[symbol] = result
            print(index, len(symbols), symbol, "verified", result.get("report_date"), flush=True)
        elif previous.get("status") == "verified":
            print(index, len(symbols), symbol, "kept_previous", previous.get("report_date"), flush=True)
        else:
            reports[symbol] = result
            print(index, len(symbols), symbol, result.get("status"), flush=True)
    merged = {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "row_count": len(symbols), "reports": reports}
    atomic(raw_path, merged)
    payload = build_payload(market, merged, market.get("generated_at"))
    atomic(root / "data/investment-companies.json", payload)
    atomic(root / "data/investment-portfolio-reports.json", merged)
    print(json.dumps({"symbols": len(symbols), "verified": sum(x.get("status") == "verified" for x in reports.values())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
