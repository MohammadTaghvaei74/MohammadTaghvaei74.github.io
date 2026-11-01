"""Build the public data contract for the comprehensive market table.

The table deliberately combines the current verified snapshot with a bounded
historical score window. Historical rows are selected from the explicit
``v2_days.complete`` fence and deduplicated to the latest valid row for each
symbol/day/target-time slot.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime
from typing import Any

try:
    from .queue_data import average_turnovers
except ImportError:
    from queue_data import average_turnovers

try:
    from .score_daily import finite as _finite
except ImportError:
    from score_daily import finite as _finite

TARGET_TIMES = ()
HISTORY_DAYS = 10
CONTRACT_VERSION = "score_10d_daily_median_v1"

def _complete_days(conn, latest_day: str, limit: int = HISTORY_DAYS) -> list[str]:
    rows = conn.execute("SELECT day FROM v2_days WHERE complete=1 AND day<=? ORDER BY day DESC LIMIT ?", (latest_day, limit)).fetchall()
    return [str(row[0]) for row in rows]

def load_score_samples(conn, latest_day: str, limit: int = HISTORY_DAYS):
    """Return one daily median per completed day; partial minutes are explicit."""
    days = _complete_days(conn, latest_day, limit)
    if not days: return [], {}
    try:
        from .score_daily import load_daily
    except ImportError:
        from score_daily import load_daily
    return days, load_daily(conn, days)

def build_comprehensive_rows(stocks: list[dict[str, Any]], latest: str, conn) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach current metrics and the 10-day score total to every stock."""
    latest_day = latest[:10]
    days, samples_by_symbol = load_score_samples(conn, latest_day)
    averages = average_turnovers(conn, date.fromisoformat(latest_day))
    expected_samples = len(days)  # one median per completed day; missing days remain absent
    rows: list[dict[str, Any]] = []

    for source in stocks:
        row = dict(source)
        symbol = str(row.get("symbol") or "")
        samples = samples_by_symbol.get(symbol, [])
        scores = [sample["score"] for sample in samples]
        # Keep the public row contract stable even when optional enrichment is
        # unavailable. The UI can then distinguish null from a missing field.
        for field in ("buy_per_capita_toman", "buyer_power", "legal_buy_pct", "legal_sell_pct"):
            row.setdefault(field, None)
        buy_queue = _finite(row.get("buy_queue_value_toman"))
        sell_queue = _finite(row.get("sell_queue_value_toman"))
        if buy_queue is not None and buy_queue > 0:
            queue_value = buy_queue
        elif sell_queue is not None and sell_queue > 0:
            queue_value = -sell_queue
        elif buy_queue is not None or sell_queue is not None:
            queue_value = 0.0
        else:
            queue_value = None
        close = _finite(row.get("close_price"))
        last = _finite(row.get("last_price"))
        close_diff = None if close in (None, 0) or last is None else (last - close) / close * 100
        avg_value = averages.get(symbol)
        row.update({
            "avg_trade_value_toman": avg_value,
            "queue_value_toman": queue_value,
            "last_close_diff_pct": close_diff,
            # Never publish a partial total as if it were a complete 10-day metric.
            "score_10d_total": sum(scores) if scores else None,
            "score_10d_sample_count": len(scores),
            "score_10d_expected_count": expected_samples,
            "score_10d_days": len({sample["day"] for sample in samples}),
            "score_10d_missing_days": max(0, expected_samples - len(scores)),
            "score_10d_complete": bool(expected_samples and len(scores) == expected_samples),
            "score_10d_coverage": [{"day": sample["day"], "median": sample["score"], "minute_count": sample.get("minute_count"), "expected_minutes": sample.get("expected_minutes"), "missing_minutes": sample.get("missing_minutes"), "partial": sample.get("partial", True)} for sample in samples],
        })
        rows.append(row)

    # Rank the exact displayed universe by current score, then repeat inside
    # each industry.  Keep the denominator aligned with the visible table so
    # the UI can show rank / total without inventing a second population.
    ranked = sorted(
        (row for row in rows if _finite(row.get("score")) is not None),
        key=lambda row: (-_finite(row["score"]), str(row.get("symbol") or "")),
    )
    for position, row in enumerate(ranked, 1):
        row["score_rank"] = position
        row["score_rank_total"] = len(ranked)
    by_industry: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in ranked:
        industry = str(row.get("industry") or "").strip()
        if industry:
            by_industry[industry].append(row)
    for members in by_industry.values():
        for position, row in enumerate(members, 1):
            row["industry_score_rank"] = position
            row["industry_score_rank_total"] = len(members)
    for row in rows:
        row.setdefault("score_rank", None)
        row.setdefault("score_rank_total", len(ranked))
        row.setdefault("industry_score_rank", None)
        row.setdefault("industry_score_rank_total", 0)

    meta = {
        "days": days,
        "contract_version": CONTRACT_VERSION,
        "aggregation": "daily_median_of_deduped_minute_scores",
        "session_timezone": "Asia/Tehran",
        "session_window": "09:00-12:30",
        "completed_day_fence": "v2_days.complete=1",
        "imputation": "none",
        "target_times": [],
        "expected_samples": expected_samples,
        "symbols_with_samples": sum(1 for values in samples_by_symbol.values() if values),
        "complete_symbol_count": sum(1 for values in samples_by_symbol.values() if len(values) == expected_samples),
        "source": "stock_snapshots / score_daily_medians / v2_days.complete",
    }
    return rows, meta


__all__ = ["TARGET_TIMES", "HISTORY_DAYS", "load_score_samples", "build_comprehensive_rows"]

if __name__ == "__main__":
    raise SystemExit("This module is imported by the snapshot exporter.")
