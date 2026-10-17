"""Shared daily chart-series calculations for the public market snapshot.

The three chart medians are computed from the final valid stock snapshot of each
trading day. Cohorts are computed from raw stock rows, never from a median of
medians or from the aggregate market row.
"""
from __future__ import annotations

import statistics
import sqlite3
from typing import Any

# Keep this list aligned with bourse-alert/main.py's production LEADERS contract.
LEADER_SYMBOLS = frozenset({
    "ذوب", "فملی", "فولاد", "تاپیکو", "شستا", "شبریز", "شتران", "وغدیر",
    "شپنا", "شبندر", "پالایش", "خگستر", "فارس", "خودرو", "وبصادر", "وبملت",
    "خساپا", "دارا یکم", "پارسان", "وتجارت",
})


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def daily_median_fields(conn: sqlite3.Connection, days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add leader/rest/market medians to daily summary rows.

    For each day, only rows from that day's maximum stock timestamp are used.
    A row must be valid, traded, and have a non-null score. Missing cohorts stay
    null; no zero or stale value is fabricated.
    """
    result = []
    for day_row in days:
        day = day_row.get("trading_date")
        latest = conn.execute(
            "SELECT MAX(timestamp) FROM stock_snapshots WHERE trading_date=?",
            (day,),
        ).fetchone()[0]
        values: list[tuple[str, float]] = []
        if latest:
            rows = conn.execute(
                """SELECT symbol, score FROM stock_snapshots
                   WHERE trading_date=? AND timestamp=? AND valid=1
                     AND trade_volume>0 AND score IS NOT NULL""",
                (day, latest),
            ).fetchall()
            values = [(str(row[0]), float(row[1])) for row in rows]
        leader_values = [score for symbol, score in values if symbol in LEADER_SYMBOLS]
        rest_values = [score for symbol, score in values if symbol not in LEADER_SYMBOLS]
        enriched = dict(day_row)
        enriched.update({
            "leader_median_score": _median(leader_values),
            "rest_median_score": _median(rest_values),
            "median_score": _median([score for _, score in values]),
            "leader_score_count": len(leader_values),
            "rest_score_count": len(rest_values),
            "market_score_count": len(values),
            "score_snapshot_timestamp": latest,
        })
        result.append(enriched)
    return result


def load_daily_chart_rows(conn: sqlite3.Connection, limit: int = 7) -> list[dict[str, Any]]:
    rows = [dict(row) for row in conn.execute(
        "SELECT * FROM daily_market_summary ORDER BY trading_date DESC LIMIT ?", (limit,)
    )]
    return daily_median_fields(conn, rows)


__all__ = ["LEADER_SYMBOLS", "daily_median_fields", "load_daily_chart_rows"]
