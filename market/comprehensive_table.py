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

TARGET_TIMES = ("10:00", "11:00", "12:00")
HISTORY_DAYS = 10


def _finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def _complete_days(conn, latest_day: str, limit: int = HISTORY_DAYS) -> list[str]:
    rows = conn.execute(
        "SELECT day FROM v2_days WHERE complete=1 AND day<=? ORDER BY day DESC LIMIT ?",
        (latest_day, limit),
    ).fetchall()
    return [str(row[0]) for row in rows]


def load_score_samples(conn, latest_day: str, limit: int = HISTORY_DAYS) -> tuple[list[str], dict[str, list[dict[str, Any]]]]:
    """Return deduplicated 10/11/12 score samples grouped by symbol.

    Query only the three bounded time windows for each complete day.  The old
    window-function query sorted hundreds of thousands of rows and exceeded
    the one-minute publisher budget; selecting the bounded rows and choosing
    the nearest observation in Python preserves the same contract efficiently.
    """
    days = _complete_days(conn, latest_day, limit)
    if not days:
        return [], {}
    windows = (("09:55:00", "10:05:59.999999"),
               ("10:55:00", "11:05:59.999999"),
               ("11:55:00", "12:05:59.999999"))
    ranges: list[str] = []
    args: list[str] = []
    for day in days:
        for start_time, end_time in windows:
            ranges.append("(trading_date=? AND valid=1 AND timestamp>=? AND timestamp<=?)")
            args.extend((day, f"{day}T{start_time}", f"{day}T{end_time}"))
    query = f"""
        SELECT rowid, symbol, trading_date, score, timestamp
        FROM stock_snapshots
        WHERE valid=1 AND score IS NOT NULL
          AND ({" OR ".join(ranges)})
    """
    rows = conn.execute(query, args).fetchall()
    best: dict[tuple[str, str, str], dict[str, Any]] = {}
    for row in rows:
        score = _finite(row[3])
        if score is None:
            continue
        sample_day = str(row[2])
        try:
            observed = datetime.fromisoformat(str(row[4])).replace(tzinfo=None)
        except ValueError:
            continue
        for target_time in TARGET_TIMES:
            target = datetime.fromisoformat(f"{sample_day}T{target_time}:00")
            distance = abs((observed - target).total_seconds())
            if distance > 5 * 60:
                continue
            key = (str(row[1]), sample_day, target_time)
            candidate = {
                "day": sample_day,
                "time": target_time,
                "score": score,
                "timestamp": str(row[4]),
                "rowid": int(row[0]),
                "distance": distance,
            }
            previous = best.get(key)
            if previous is None or distance < previous["distance"] or (distance == previous["distance"] and candidate["rowid"] > previous["rowid"]):
                best[key] = candidate
    output: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (symbol, _day, _target), chosen in best.items():
        item = dict(chosen)
        item.pop("distance", None)
        item.pop("rowid", None)
        output[symbol].append(item)
    for values in output.values():
        values.sort(key=lambda item: (item["day"], item["time"]))
    return days, dict(output)

def build_comprehensive_rows(stocks: list[dict[str, Any]], latest: str, conn) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Attach current metrics and the 10-day score total to every stock."""
    latest_day = latest[:10]
    days, samples_by_symbol = load_score_samples(conn, latest_day)
    averages = average_turnovers(conn, date.fromisoformat(latest_day))
    expected_samples = len(days) * len(TARGET_TIMES)
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
            "score_10d_total": sum(scores) if expected_samples and len(scores) == expected_samples else None,
            "score_10d_sample_count": len(scores),
            "score_10d_expected_count": expected_samples,
            "score_10d_days": len({sample["day"] for sample in samples}),
            "score_10d_complete": bool(expected_samples and len(scores) == expected_samples),
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
        "target_times": list(TARGET_TIMES),
        "expected_samples": expected_samples,
        "symbols_with_samples": sum(1 for values in samples_by_symbol.values() if values),
        "complete_symbol_count": sum(1 for values in samples_by_symbol.values() if len(values) == expected_samples),
        "source": "stock_snapshots / v2_days.complete",
    }
    return rows, meta


__all__ = ["TARGET_TIMES", "HISTORY_DAYS", "load_score_samples", "build_comprehensive_rows"]

if __name__ == "__main__":
    raise SystemExit("This module is imported by the snapshot exporter.")
