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

    A producer can write more than one row in the same minute. The latest
    timestamp wins, so one target-time slot contributes at most one score.
    Missing slots stay missing and are reported by ``sample_count`` rather than
    being converted to zero.
    """
    days = _complete_days(conn, latest_day, limit)
    if not days:
        return [], {}
    placeholders = ",".join("?" for _ in days)
    # Capture a small five-minute tolerance around each requested hour. Some
    # finalized days have a 10:01/12:01 capture but no exact :00 row. The
    # selected sample still remains a real database observation.
    windows = (("09:55", "10:05"), ("10:55", "11:05"), ("11:55", "12:05"))
    window_sql = " OR ".join("(substr(timestamp, 12, 5) BETWEEN ? AND ?)" for _ in windows)
    query = f"""
        WITH ranked AS (
            SELECT symbol, trading_date, substr(timestamp, 12, 5) AS sample_time,
                   score, timestamp,
                   ROW_NUMBER() OVER (
                       PARTITION BY symbol, trading_date, substr(timestamp, 12, 5)
                       ORDER BY timestamp DESC, rowid DESC
                   ) AS rn
            FROM stock_snapshots
            WHERE valid=1 AND score IS NOT NULL
              AND trading_date IN ({placeholders})
              AND ({window_sql})
        )
        SELECT symbol, trading_date, sample_time, score, timestamp
        FROM ranked WHERE rn=1
        ORDER BY symbol, trading_date DESC, sample_time
    """
    rows = conn.execute(query, (*days, *[value for window in windows for value in window])).fetchall()
    candidates: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        score = _finite(row[3])
        if score is None:
            continue
        sample_day, sample_time = str(row[1]), str(row[2])
        try:
            observed = datetime.fromisoformat(str(row[4])).replace(tzinfo=None)
        except ValueError:
            continue
        for target_time in TARGET_TIMES:
            target = datetime.fromisoformat(f"{sample_day}T{target_time}:00")
            distance = abs((observed - target).total_seconds())
            if distance <= 5 * 60:
                candidates[(str(row[0]), sample_day, target_time)].append({
                    "day": sample_day,
                    "time": target_time,
                    "score": score,
                    "timestamp": str(row[4]),
                    "distance": distance,
                })
    output: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for (symbol, _day, _target), values in candidates.items():
        chosen = min(values, key=lambda item: (item["distance"], -datetime.fromisoformat(item["timestamp"]).timestamp()))
        chosen.pop("distance", None)
        output[symbol].append(chosen)
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
            "score_10d_total": sum(scores) if len(scores) == expected_samples else None,
            "score_10d_sample_count": len(scores),
            "score_10d_expected_count": expected_samples,
            "score_10d_days": len({sample["day"] for sample in samples}),
        })
        rows.append(row)

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
