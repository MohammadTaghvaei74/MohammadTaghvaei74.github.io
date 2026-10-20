"""Shared daily chart-series calculations for the public market snapshot.

The three chart medians are computed from the final valid stock snapshot of each
trading day. Cohorts are computed from raw stock rows, never from a median of
medians or from the aggregate market row.
"""
from __future__ import annotations

import math
import statistics
import sqlite3
from datetime import datetime, timedelta
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


def load_intraday_chart_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:05") -> list[dict[str, Any]]:
    """Return today's score movement, aggregated to one point per minute.

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
    grouped: dict[str, dict[str, tuple[str, float]]] = {}
    for timestamp, symbol, score in rows:
        minute = str(timestamp)[:16]
        grouped.setdefault(minute, {})[str(symbol)] = (str(timestamp), float(score))
    if not grouped:
        return []
    first = datetime.strptime(f"{trading_date} {start_time}", "%Y-%m-%d %H:%M")
    last = datetime.strptime(max(grouped), "%Y-%m-%dT%H:%M")
    result = []
    current_rows: dict[str, tuple[str, float]] | None = None
    minute = first
    while minute <= last:
        minute_key = minute.strftime("%Y-%m-%dT%H:%M")
        if minute_key in grouped:
            current_rows = grouped[minute_key]
        symbol_rows = current_rows or {}
        values = list(symbol_rows.values())
        timestamp = max((row[0] for row in values), default=f"{minute_key}:00")
        leaders = [score for symbol, (_, score) in symbol_rows.items() if symbol in LEADER_SYMBOLS]
        rest = [score for symbol, (_, score) in symbol_rows.items() if symbol not in LEADER_SYMBOLS]
        result.append({
            "timestamp": timestamp,
            "time": minute.strftime("%H:%M"),
            "leader_median_score": _median(leaders),
            "rest_median_score": _median(rest),
            "median_score": _median([score for _, score in values]),
            "leader_score_count": len(leaders),
            "rest_score_count": len(rest),
            "market_score_count": len(values),
        })
        minute += timedelta(minutes=1)
    return result


def load_intraday_symbol_rows(
    conn: sqlite3.Connection,
    trading_date: str,
    start_time: str = "09:15",
    end_time: str = "12:30",
) -> dict[str, list[dict[str, Any]]]:
    """Build observed minute points for every current symbol.

    The last observation in a minute supplies the score and close. Price
    high/low are taken only from observed rows; missing minutes remain absent.
    No interpolation or fabricated zero is allowed.
    """
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "stock_snapshots" not in tables:
        return {}
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    required = {"timestamp", "symbol", "score", "trading_date", "valid", "trade_volume"}
    if not required.issubset(available):
        return {}
    last_price = "last_price" if "last_price" in available else "NULL"
    close_price = "close_price" if "close_price" in available else "NULL"
    yesterday = "yesterday_price" if "yesterday_price" in available else "NULL"
    value = "trade_value_toman" if "trade_value_toman" in available else "NULL"
    rows = conn.execute(
        f"""SELECT timestamp, symbol, score, {last_price}, {close_price},
                  {yesterday}, trade_volume, {value}
           FROM stock_snapshots
           WHERE trading_date=? AND valid=1 AND score IS NOT NULL
             AND trade_volume>0 AND substr(timestamp, 12, 5) BETWEEN ? AND ?
           ORDER BY symbol, timestamp""",
        (trading_date, start_time, end_time),
    ).fetchall()
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for timestamp, symbol, score, last_price, close_price, yesterday, volume, value in rows:
        try:
            score_value = float(score)
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(score_value):
            continue
        symbol_text = str(symbol)
        minute = str(timestamp)[11:16]
        price = last_price if last_price is not None else close_price
        try:
            price_value = float(price) if price is not None else None
        except (TypeError, ValueError, OverflowError):
            price_value = None
        if price_value is not None and not math.isfinite(price_value):
            price_value = None
        key = (symbol_text, minute)
        bar = grouped.get(key)
        if bar is None:
            grouped[key] = {
                "symbol": symbol_text, "time": minute, "timestamp": str(timestamp),
                "score": score_value, "price_open": price_value,
                "price_high": price_value, "price_low": price_value,
                "price_close": price_value, "yesterday_price": yesterday,
                "trade_volume": volume, "trade_value_toman": value,
            }
            continue
        if price_value is not None:
            if bar["price_open"] is None:
                bar["price_open"] = price_value
            bar["price_high"] = price_value if bar["price_high"] is None else max(bar["price_high"], price_value)
            bar["price_low"] = price_value if bar["price_low"] is None else min(bar["price_low"], price_value)
            bar["price_close"] = price_value
        bar["score"] = score_value
        bar["timestamp"] = str(timestamp)
        bar["trade_volume"] = volume
        bar["trade_value_toman"] = value
    result: dict[str, list[dict[str, Any]]] = {}
    for (symbol, _minute), bar in sorted(grouped.items(), key=lambda item: item[0]):
        result.setdefault(symbol, []).append(bar)
    return result


__all__ = [
    "LEADER_SYMBOLS", "daily_median_fields", "load_daily_chart_rows",
    "load_intraday_chart_rows", "load_intraday_symbol_rows",
]
