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


def load_intraday_chart_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:15") -> list[dict[str, Any]]:
    """Return only today's score movement, grouped by observed snapshot time.

    The chart must not mix finalized prior days with the live session. A point is
    emitted only when it has valid, traded rows with a score; missing cohorts stay
    null rather than being filled from another timestamp.
    """
    rows = conn.execute(
        """SELECT timestamp, symbol, score FROM stock_snapshots
           WHERE trading_date=? AND valid=1 AND trade_volume>0 AND score IS NOT NULL
             AND substr(timestamp, 12, 5) >= ?
           ORDER BY timestamp, symbol""",
        (trading_date, start_time),
    ).fetchall()
    grouped: dict[str, list[tuple[str, float]]] = {}
    for timestamp, symbol, score in rows:
        grouped.setdefault(str(timestamp), []).append((str(symbol), float(score)))
    result = []
    for timestamp, values in grouped.items():
        leaders = [score for symbol, score in values if symbol in LEADER_SYMBOLS]
        rest = [score for symbol, score in values if symbol not in LEADER_SYMBOLS]
        result.append({
            "timestamp": timestamp,
            "time": timestamp[11:16],
            "leader_median_score": _median(leaders),
            "rest_median_score": _median(rest),
            "median_score": _median([score for _, score in values]),
            "leader_score_count": len(leaders),
            "rest_score_count": len(rest),
            "market_score_count": len(values),
        })
    return result


__all__ = ["LEADER_SYMBOLS", "daily_median_fields", "load_daily_chart_rows", "load_intraday_chart_rows"]
