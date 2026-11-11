"""Shared daily chart-series calculations for the public market snapshot.

The three chart medians are computed from the final valid stock snapshot of each
trading day. Cohorts are computed from raw stock rows, never from a median of
medians or from the aggregate market row.
"""
from __future__ import annotations

import statistics
import sqlite3
from typing import Any

try:
    from .universe import is_base_market
except ImportError:
    from universe import is_base_market

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
            available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
            type_column = ", instrument_type" if "instrument_type" in available else ""
            rows = conn.execute(
                f"""SELECT symbol, score{type_column} FROM stock_snapshots
                   WHERE trading_date=? AND timestamp=? AND valid=1
                     AND trade_volume>0 AND score IS NOT NULL""",
                (day, latest),
            ).fetchall()
            values = [(str(row[0]), float(row[1])) for row in rows if not is_base_market({"instrument_type": row[2] if type_column else None})]
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


def load_daily_chart_rows(conn: sqlite3.Connection, limit: int = 31) -> list[dict[str, Any]]:
    rows = [dict(row) for row in conn.execute(
        "SELECT * FROM daily_market_summary ORDER BY trading_date DESC LIMIT ?", (limit,)
    )]
    rows = daily_median_fields(conn, rows)
    if len(rows) >= limit or "chart_snapshots" not in {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }:
        return rows

    # Before the collector cutover, the raw score stream was stored in
    # chart_snapshots and no daily_market_summary row was created. Rebuild the
    # same end-of-day cohort medians from the last valid timestamp of each day.
    known_days = {row["trading_date"] for row in rows}
    legacy = []
    days = [row[0] for row in conn.execute(
        "SELECT DISTINCT trading_date FROM chart_snapshots ORDER BY trading_date DESC"
    ) if row[0] not in known_days][: max(0, limit - len(rows))]
    for day in days:
        latest = conn.execute(
            "SELECT MAX(timestamp) FROM chart_snapshots WHERE trading_date=? AND valid=1 AND score IS NOT NULL",
            (day,),
        ).fetchone()[0]
        if not latest:
            continue
        available = {row[1] for row in conn.execute("PRAGMA table_info(chart_snapshots)")}
        type_column = ", instrument_type" if "instrument_type" in available else ""
        values = [(str(row[0]), float(row[1])) for row in conn.execute(
            f"SELECT symbol,score{type_column} FROM chart_snapshots WHERE trading_date=? AND timestamp=? AND valid=1 AND score IS NOT NULL",
            (day, latest),
        ) if not is_base_market({"instrument_type": row[2] if type_column else None})]
        leader_values = [score for symbol, score in values if symbol in LEADER_SYMBOLS]
        rest_values = [score for symbol, score in values if symbol not in LEADER_SYMBOLS]
        legacy.append({
            "trading_date": day,
            "median_score": _median([score for _, score in values]),
            "leader_median_score": _median(leader_values),
            "rest_median_score": _median(rest_values),
            "market_score_count": len(values),
            "leader_score_count": len(leader_values),
            "rest_score_count": len(rest_values),
            "score_snapshot_timestamp": latest,
            "history_source": "chart_snapshots",
        })
    return sorted(rows + legacy, key=lambda row: row["trading_date"], reverse=True)[:limit]


def load_intraday_chart_rows(
    conn: sqlite3.Connection,
    trading_date: str | None = None,
    start_time: str = "09:05",
) -> list[dict[str, Any]]:
    """Build the current-session market score series from raw snapshots.

    The opening sample is deliberately 09:05 (Tehran local time), not 09:00.
    Values are medians of valid traded stock rows at each observed timestamp;
    missing cohorts remain null and no values are interpolated.
    """
    if trading_date is None:
        latest = conn.execute(
            "SELECT MAX(timestamp) FROM stock_snapshots WHERE valid=1"
        ).fetchone()[0]
        trading_date = str(latest)[:10] if latest else None
    if not trading_date:
        return []
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    type_column = ", instrument_type" if "instrument_type" in available else ""
    rows = conn.execute(
        f"""SELECT timestamp, symbol, score, trade_volume{type_column}
            FROM stock_snapshots
            WHERE trading_date=? AND valid=1 AND score IS NOT NULL
              AND trade_volume>0
            ORDER BY timestamp, symbol""",
        (trading_date,),
    ).fetchall()
    grouped: dict[str, list[tuple[str, float]]] = {}
    for row in rows:
        timestamp = str(row[0] or "")
        if len(timestamp) < 16 or timestamp[11:16] < start_time:
            continue
        if type_column and is_base_market({"instrument_type": row[4]}):
            continue
        try:
            grouped.setdefault(timestamp, []).append((str(row[1]), float(row[2])))
        except (TypeError, ValueError):
            continue
    output = []
    for timestamp, values in sorted(grouped.items()):
        leader_values = [score for symbol, score in values if symbol in LEADER_SYMBOLS]
        rest_values = [score for symbol, score in values if symbol not in LEADER_SYMBOLS]
        output.append({
            "timestamp": timestamp,
            "time": timestamp[11:16],
            "median_score": _median([score for _, score in values]),
            "leader_median_score": _median(leader_values),
            "rest_median_score": _median(rest_values),
            "market_score_count": len(values),
            "leader_score_count": len(leader_values),
            "rest_score_count": len(rest_values),
        })
    return output


__all__ = ["LEADER_SYMBOLS", "daily_median_fields", "load_daily_chart_rows", "load_intraday_chart_rows"]
