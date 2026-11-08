"""Build the tradable investment-company portfolio feed.

Portfolio weights are percentages of total investment assets. Cash and
unlisted assets contribute zero but remain in the denominator; no weight is
redistributed. Missing data stays null and is rendered as an em dash.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path

INVESTMENT_INDUSTRY = "سرمایه گذاریها"
MAX_REPORT_AGE_DAYS = 40


def number(value):
    return value if isinstance(value, (int, float)) and value == value else None


def norm(value):
    return re.sub(r"[\s\u200c\u200d\ufeff]+", "", str(value or "").replace("ي", "ی").replace("ك", "ک")).strip()


def weighted_portfolio_score(holdings, board_scores):
    """Return Σ(weight_pct / 100 × current board score), without renormalizing."""
    total = 0.0
    found = 0.0
    for holding in holdings or []:
        weight = number(holding.get("weight_pct"))
        symbol = norm(holding.get("symbol"))
        score = number(board_scores.get(symbol))
        if weight is None or weight < 0 or score is None:
            continue
        total += weight * score / 100.0
        found += weight
    return (total if found else None), found


def effective_ownership(edges, root):
    """Aggregate effective ownership through a multi-layer ownership graph."""
    result = {}
    visiting = set()

    def walk(parent, factor):
        if parent in visiting:
            return
        visiting.add(parent)
        for child, direct in edges.get(parent, []):
            pct = number(direct)
            if pct is None or pct < 0:
                continue
            effective = factor * pct / 100.0
            result[child] = result.get(child, 0.0) + effective
            walk(child, effective)
        visiting.remove(parent)

    # Keep the public result in percentage points: 20% × 30% = 6%.
    walk(root, 100.0)
    return result


def is_investment_company(row):
    industry = norm(row.get("industry"))
    description = norm(row.get("description") or row.get("company_name"))
    symbol = norm(row.get("symbol"))
    if industry == norm(INVESTMENT_INDUSTRY):
        return True
    if industry == norm("شرکتهای چند رشته ای"):
        return True
    if symbol in {"فارس"}:
        return True
    return any(token in description for token in ("سرمایهگذاری", "هلدینگ", "گروهمالی", "گروهسرمایهگذاری"))


def report_age_days(report_date, as_of):
    if not report_date:
        return None
    try:
        # Public reports use the Persian calendar; the publisher may provide an
        # already-normalized Gregorian age when available.
        if isinstance(report_date, (int, float)):
            return None
        parsed = datetime.fromisoformat(str(report_date)[:10]).date()
        return (as_of - parsed).days
    except ValueError:
        return None


def build_rows(market, holdings_by_symbol=None, as_of=None):
    holdings_by_symbol = holdings_by_symbol or {}
    as_of = as_of or date.today()
    stocks = list(market.get("stocks") or [])
    catalog = list(market.get("investment_catalog") or [])
    by_symbol = {norm(row.get("symbol")): row for row in stocks if norm(row.get("symbol"))}
    for row in catalog:
        key = norm(row.get("symbol"))
        if key and key not in by_symbol:
            by_symbol[key] = {**by_symbol.get(key, {}), **row}
    stocks = list(by_symbol.values())
    candidates = [
        row for row in stocks
        if is_investment_company(row)
        and str(row.get("instrument_type") or "").lower() not in {"etf", "fund"}
    ]
    board_scores = {norm(row.get("symbol")): number(row.get("last_pct")) for row in stocks}
    rows = []
    for row in candidates:
        symbol = norm(row.get("symbol"))
        report = holdings_by_symbol.get(symbol) or {}
        holdings = report.get("holdings") or []
        portfolio_score, matched_weight = weighted_portfolio_score(holdings, board_scores)
        age = report_age_days(report.get("report_date"), as_of)
        stale = age is not None and age > MAX_REPORT_AGE_DAYS
        current_snapshot = row.get("is_current_snapshot", True)
        board_score = number(row.get("last_pct")) if current_snapshot else None
        rows.append({
            "symbol": symbol,
            "company_name": row.get("company_name") or row.get("description") or row.get("instrument") or symbol,
            "instrument": row.get("instrument"),
            "instrument_type": row.get("instrument_type"),
            "trade_state": "traded_snapshot" if current_snapshot and board_score is not None else "not_observed",
            "closed_reason": row.get("closed_reason") or ("در snapshot فعلی دیده نشد" if not current_snapshot else None),
            "board_score": board_score,
            "portfolio_score": portfolio_score,
            "score_gap": None if portfolio_score is None or board_score is None else portfolio_score - board_score,
            "portfolio_report_date": report.get("report_date"),
            "report_age_days": age,
            "portfolio_status": "گزارش قدیمی" if stale else ("محاسبه شد" if portfolio_score is not None else "عدد پیدا نشد"),
            "coverage_pct": matched_weight,
            "matched_weight_pct": matched_weight,
            "unlisted_weight_pct": report.get("unlisted_weight_pct"),
            "cash_weight_pct": report.get("cash_weight_pct"),
            "nav_discount_pct": report.get("nav_discount_pct"),
            "holdings_count": len(holdings),
            "holdings": holdings,
            "source_url": report.get("source_url"),
            "source_note": report.get("source_note"),
        })
    rows.sort(key=lambda item: item["symbol"])
    return rows


def load_verified_reports(root=None):
    root = root or Path(__file__).resolve().parent
    path = root / "data/investment-portfolio-reports.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        reports = payload.get("reports", {})
        return reports if isinstance(reports, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def build_payload(market, holdings_by_symbol=None, generated_at=None):
    if holdings_by_symbol is None:
        holdings_by_symbol = load_verified_reports()
    rows = build_rows(market, holdings_by_symbol, date.today())
    return {
        "schema_version": 1,
        "source": "market snapshot + verified monthly investment reports",
        "generated_at": generated_at or market.get("generated_at"),
        "row_count": len(rows),
        "universe": "سرمایه گذاریها",
        "portfolio_contract": {
            "report_source": "آخرین گزارش ماهانه فعالیت سرمایه‌گذاری",
            "max_report_age_days": MAX_REPORT_AGE_DAYS,
            "board_score": "last_pct",
            "portfolio_score": "Σ(weight_pct / 100 × current board score)",
            "cash_and_unlisted_score": 0,
            "weight_denominator": "کل دارایی‌های سرمایه‌گذاری‌شده / کل دارایی گزارش",
            "no_renormalization": True,
            "multi_layer_ownership": True,
            "nav_in_score": False,
            "missing_value": None,
        },
        "market_scores": {norm(row.get("symbol")): number(row.get("last_pct")) for row in (market.get("stocks") or []) if norm(row.get("symbol"))},
        "rows": rows,
    }


def main():
    root = Path(__file__).resolve().parent
    market = json.loads((root / "data/market.json").read_text(encoding="utf-8"))
    output = root / "data/investment-companies.json"
    output.write_text(json.dumps(build_payload(market), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"INVESTMENT_COMPANIES rows={len(build_payload(market)['rows'])} output={output}")


if __name__ == "__main__":
    main()
