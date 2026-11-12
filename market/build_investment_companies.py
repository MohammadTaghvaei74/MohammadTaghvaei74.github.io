"""Build the public investment-company contract from verified Codal reports."""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

INVESTMENT_INDUSTRY = "سرمایه گذاریها"
MAX_REPORT_AGE_DAYS = 40
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def norm(value: object) -> str:
    text = str(value or "").translate(DIGITS).replace("ي", "ی").replace("ك", "ک")
    return re.sub(r"[\s\u200c\u200d\u200e\u200f\ufeffـ.,،؛:()\[\]{}\-–—]", "", text).lower()


def number(value: object) -> float | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = float(str(value).translate(DIGITS).replace(",", "").replace("٫", ".").replace("٬", ""))
        return result if result == result else None
    except (TypeError, ValueError):
        return None


def _jalali_to_gregorian(jy: int, jm: int, jd: int) -> date:
    jy -= 979
    days = 365 * jy + jy // 33 * 8 + ((jy % 33) + 3) // 4
    days += (jm - 1) * (31 if jm <= 6 else 30) + (6 if jm > 6 else 0) + jd - 1 + 79
    gy = 1600 + 400 * (days // 146097)
    days %= 146097
    leap = True
    if days >= 36525:
        days -= 1
        gy += 100 * (days // 36524)
        days %= 36524
        if days >= 365:
            days += 1
        else:
            leap = False
    gy += 4 * (days // 1461)
    days %= 1461
    if days >= 366:
        leap = False
        days -= 1
        gy += days // 365
        days %= 365
    gd = days + 1
    for gm, month_length in enumerate([31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], 1):
        if gd <= month_length:
            return date(gy, gm, gd)
        gd -= month_length
    raise ValueError("invalid Jalali date")


def report_age_days(report_date: object, as_of: date) -> int | None:
    try:
        year, month, day = (int(part) for part in re.split(r"[/\\-]", str(report_date).translate(DIGITS)))
        return (as_of - _jalali_to_gregorian(year, month, day)).days
    except (TypeError, ValueError):
        return None


def is_investment_company(row: dict) -> bool:
    industry = norm(row.get("industry"))
    description = norm(row.get("description") or row.get("company_name"))
    symbol = norm(row.get("symbol"))
    if row.get("instrument_type") == "H1" or description.startswith(norm("صندوق")):
        return False
    return (
        industry in {norm(INVESTMENT_INDUSTRY), norm("شرکتهای چند رشته ای")}
        or symbol == norm("فارس")
        or any(token in description for token in ("سرمایهگذاری", "هلدینگ", "گروهمالی", "گروهسرمایهگذاری"))
    )


def weighted_portfolio_details(holdings: list[dict], board_scores: dict[str, float | None]) -> tuple[float | None, float, float]:
    """Return score, matched weight, and missing-score weight without redistribution."""
    board_scores = {norm(key): value for key, value in board_scores.items()}
    total = 0.0
    matched = 0.0
    missing = 0.0
    for holding in holdings:
        weight = number(holding.get("weight_pct")) or 0.0
        if weight <= 0 or holding.get("is_unlisted") or holding.get("is_cash"):
            continue
        symbol = norm(holding.get("symbol"))
        # Cash/unlisted rows without a market symbol are explicit zero-score
        # components, not missing equity evidence.
        if not symbol:
            continue
        score = number(board_scores.get(symbol))
        if score is None:
            missing += weight
            continue
        total += weight * score / 100.0
        matched += weight
    return (total if missing <= 0.0001 and matched > 0 else None), matched, missing


def weighted_portfolio_score(holdings: list[dict], board_scores: dict[str, float | None]) -> tuple[float | None, float]:
    """Backward-compatible public helper: score and matched weight."""
    score, matched, _missing = weighted_portfolio_details(holdings, board_scores)
    return score, matched


def effective_ownership(edges: dict[str, list[tuple[str, float]],], root: str) -> dict[str, float]:
    result: dict[str, float] = {}
    visiting: set[str] = set()

    def walk(parent: str, factor: float) -> None:
        if parent in visiting:
            return
        visiting.add(parent)
        for child, direct in edges.get(parent, []):
            effective = factor * direct / 100.0
            result[child] = result.get(child, 0.0) + effective
            walk(child, effective)
        visiting.remove(parent)

    walk(root, 100.0)
    return result


def market_index(market: dict) -> tuple[dict[str, dict], dict[str, float | None]]:
    by_name: dict[str, list[dict]] = {}
    scores: dict[str, float | None] = {}
    for row in market.get("stocks", []):
        symbol = norm(row.get("symbol"))
        if not symbol:
            continue
        scores[symbol] = number(row.get("last_pct"))
        for name in (row.get("description"), row.get("company_name"), row.get("instrument")):
            key = norm(name)
            if key:
                by_name.setdefault(key, []).append(row)
    return {key: rows[0] for key, rows in by_name.items() if len(rows) == 1}, scores


def market_cap_index(root: Path) -> dict[str, dict]:
    path = root / "data/investment-market-cap.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload.get("rows") or {}
    except (OSError, ValueError, TypeError):
        return {}


def resolve_symbol(name: str, index: dict[str, dict]) -> tuple[str | None, str]:
    key = norm(name)
    if not key:
        return None, "empty"
    exact = index.get(key)
    if exact:
        return exact.get("symbol"), "exact"
    candidates = [row for k, row in index.items() if len(k) >= 8 and (k in key or key in k)]
    if len(candidates) == 1:
        return candidates[0].get("symbol"), "unique_contained"
    return None, "not_found_or_ambiguous"


def summary_value(summary: dict, key: str) -> float:
    return number((summary.get(key) or {}).get("cost")) or 0.0


def build_report_holdings(report: dict, index: dict[str, dict]) -> tuple[list[dict], dict]:
    listed = report.get("listed_holdings") or []
    unlisted = report.get("unlisted_holdings") or []
    summary = report.get("investment_summary") or {}
    listed_market = sum(number(item.get("market_value")) or 0.0 for item in listed)
    other_cost = sum(summary_value(summary, key) for key in ("fund_units", "debt_and_derivatives", "other_equity", "bank_deposits", "real_estate", "other_investments"))
    impairment = summary_value(summary, "impairment")
    denominator = listed_market + sum(number(item.get("cost")) or 0.0 for item in unlisted) + other_cost + impairment
    denominator = denominator if denominator > 0 else None
    holdings: list[dict] = []
    for raw in listed + unlisted:
        symbol, match = resolve_symbol(raw.get("name", ""), index)
        value = number(raw.get("market_value")) if not raw.get("is_unlisted") else number(raw.get("cost"))
        weight = value / denominator * 100.0 if denominator and value is not None else None
        holdings.append({
            "name": raw.get("name"),
            "symbol": symbol,
            "weight_pct": weight,
            "value_million_rial": value,
            "cost_million_rial": number(raw.get("cost")),
            "ownership_pct": number(raw.get("ownership_pct")),
            "is_unlisted": bool(raw.get("is_unlisted")),
            "identity_match": match,
            "source_table": raw.get("source_table"),
            "source_row": raw.get("source_row"),
        })
    synthetic = {
        "listed_market_value_million_rial": listed_market,
        "official_other_investment_cost_million_rial": other_cost,
        "official_impairment_million_rial": impairment,
        "denominator_million_rial": denominator,
        "denominator_method": "listed market value + official cost of non-listed investment categories",
        "cash_source": "not_disclosed_in_monthly_portfolio_tables",
    }
    return holdings, synthetic


def build_rows(market: dict, raw: dict | None = None, as_of: date | None = None) -> list[dict]:
    as_of = as_of or date.today()
    raw = raw or {"reports": {}}
    root = Path(__file__).resolve().parent
    index, board_scores = market_index(market)
    market_caps = market_cap_index(root)
    catalog = {norm(row.get("symbol")): row for row in market.get("investment_catalog", []) if norm(row.get("symbol"))}
    for row in market.get("stocks", []):
        if is_investment_company(row):
            catalog.setdefault(norm(row.get("symbol")), row)
    reports = raw.get("reports", {})
    rows = []
    for key, row in sorted(catalog.items()):
        symbol = row.get("symbol")
        report = reports.get(symbol) or {"symbol": symbol, "status": "not_collected"}
        holdings, basis = build_report_holdings(report, index) if report.get("status") == "verified" else ([], {})
        portfolio_score, matched, missing = weighted_portfolio_details(holdings, board_scores)
        listed_holdings = [holding for holding in holdings if not holding.get("is_unlisted")]
        report_date = report.get("report_date")
        status = report.get("status")
        if status == "verified" and portfolio_score is not None:
            portfolio_status = "محاسبه شد"
        elif status == "verified":
            portfolio_status = "عدد کامل پیدا نشد"
        elif status == "not_found":
            portfolio_status = "گزارش پیدا نشد"
        elif status == "rate_limited":
            portfolio_status = "کدال محدود کرد"
        else:
            portfolio_status = "داده پیدا نشد"
        board_score = number(row.get("last_pct"))
        cap_data = market_caps.get(symbol) or {}
        shares_outstanding = number(cap_data.get("shares_outstanding"))
        last_price = number(row.get("last_price"))
        market_cap_million_rial = shares_outstanding * last_price / 1_000_000 if shares_outstanding and last_price else None
        nav_million_rial = basis.get("denominator_million_rial")
        market_cap_to_nav_pct = market_cap_million_rial / nav_million_rial * 100 if market_cap_million_rial and nav_million_rial else None
        rows.append({
            "symbol": symbol,
            "company_name": row.get("description") or row.get("company_name") or symbol,
            "instrument": row.get("instrument"),
            "instrument_type": row.get("instrument_type"),
            "trade_state": "traded_snapshot" if board_score is not None else "not_observed",
            "closed_reason": None if board_score is not None else "در snapshot فعلی دیده نشد؛ ممکن است توقف مجمع باشد",
            "board_score": board_score,
            "portfolio_score": portfolio_score,
            "score_gap": None if portfolio_score is None or board_score is None else portfolio_score - board_score,
            "portfolio_report_date": report_date,
            "report_age_days": report_age_days(report_date, as_of),
            "portfolio_status": portfolio_status,
            "coverage_pct": matched,
            "matched_weight_pct": matched,
            "missing_board_weight_pct": missing,
            "cash_weight_pct": None,
            "deposit_cost_million_rial": summary_value(report.get("investment_summary") or {}, "bank_deposits") if status == "verified" else None,
            "other_investment_cost_million_rial": basis.get("official_other_investment_cost_million_rial"),
            "listed_market_value_million_rial": basis.get("listed_market_value_million_rial"),
            "listed_market_value_billion_toman": (basis.get("listed_market_value_million_rial") / 10000) if basis.get("listed_market_value_million_rial") is not None else None,
            "total_investment_assets_million_rial": basis.get("denominator_million_rial"),
            "nav_million_rial": nav_million_rial,
            "market_cap_million_rial": market_cap_million_rial,
            "market_cap_to_nav_pct": market_cap_to_nav_pct,
            "shares_outstanding": shares_outstanding,
            "unlisted_weight_pct": sum(h.get("weight_pct") or 0.0 for h in holdings if h.get("is_unlisted")),
            "nav_discount_pct": None,
            "holdings_count": len(holdings),
            "holdings": listed_holdings,
            "denominator": basis,
            "source_url": report.get("detail_url"),
            "source_note": "داده خام از صفحه گزارش ماهانه کدال؛ وزن غیربورسی امتیاز ندارد و در مخرج باقی می‌ماند." if status == "verified" else report.get("error"),
        })
    return rows


def build_payload(market: dict, raw: dict | None = None, generated_at: str | None = None) -> dict:
    root = Path(__file__).resolve().parent
    if raw is None:
        raw_path = root / "data/investment-codal-raw.json"
        if not raw_path.exists():
            raw_path = root / "data/investment-portfolio-reports.json"
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
    rows = build_rows(market, raw)
    return {
        "schema_version": 2,
        "source": "market snapshot + Codal monthly investment-activity reports",
        "generated_at": generated_at or market.get("generated_at"),
        "row_count": len(rows),
        "universe": "کل نمادهای صنعت سرمایه‌گذاری و هلدینگ‌های صنعتی قابل معامله",
        "portfolio_contract": {
            "report_source": "آخرین گزارش ماهانه فعالیت سرمایه‌گذاری کدال",
            "max_report_age_days": MAX_REPORT_AGE_DAYS,
            "board_score": "درصد آخرین قیمت از snapshot بازار",
            "portfolio_score": "Σ(weight_pct / 100 × current board score)",
            "weight_basis": "ارزش روز سهام بورسی + ارزش رسمی دارایی‌های غیر بورسی/سپرده‌ای موجود در گزارش",
            "cash_and_unlisted_score": 0,
            "no_renormalization": True,
            "multi_layer_ownership": True,
            "nav_in_score": False,
            "missing_value": None,
            "strict_missing_denominator": True,
        },
        "market_scores": {norm(row.get("symbol")): number(row.get("last_pct")) for row in market.get("stocks", []) if norm(row.get("symbol"))},
        "collection": raw,
        "rows": rows,
    }


def main() -> None:
    root = Path(__file__).resolve().parent
    market = json.loads((root / "data/market.json").read_text(encoding="utf-8"))
    raw = json.loads((root / "data/investment-codal-raw.json").read_text(encoding="utf-8"))
    payload = build_payload(market, raw)
    output = root / "data/investment-companies.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"INVESTMENT_COMPANIES rows={len(payload['rows'])} verified={sum(r.get('portfolio_report_date') is not None for r in payload['rows'])} scored={sum(r.get('portfolio_score') is not None for r in payload['rows'])} output={output}")


if __name__ == "__main__":
    main()
