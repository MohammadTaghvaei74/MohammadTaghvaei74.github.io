"""Shared daily and intraday chart-series calculations for public snapshots.

All series are derived from valid observed rows. Missing cohorts remain null or
absent; the module never fabricates a zero or borrows a prior trading day.
"""
from __future__ import annotations

import math
import statistics
import sqlite3
from datetime import datetime, timedelta
from typing import Any

LEADER_SYMBOLS = frozenset({
    "ذوب", "فملی", "فولاد", "تاپیکو", "شستا", "شبریز", "شتران", "وغدیر",
    "شپنا", "شبندر", "پالایش", "خگستر", "فارس", "خودرو", "وبصادر", "وبملت",
    "خساپا", "دارا یکم", "پارسان", "وتجارت",
})


def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _finite(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed if math.isfinite(parsed) else None


def daily_median_fields(conn: sqlite3.Connection, days: list[dict[str, Any]]) -> list[dict[str, Any]]:
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


def load_daily_chart_rows(conn: sqlite3.Connection, limit: int = 31) -> list[dict[str, Any]]:
    rows = [dict(row) for row in conn.execute(
        "SELECT * FROM daily_market_summary ORDER BY trading_date DESC LIMIT ?", (limit,)
    )]
    rows = daily_median_fields(conn, rows)
    if len(rows) >= limit or "chart_snapshots" not in {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }:
        return rows
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
        values = [(str(row[0]), float(row[1])) for row in conn.execute(
            "SELECT symbol,score FROM chart_snapshots WHERE trading_date=? AND timestamp=? AND valid=1 AND score IS NOT NULL",
            (day, latest),
        )]
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


def load_intraday_chart_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:00") -> list[dict[str, Any]]:
    """Return one observed/current-minute point from the selected session only."""
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
    minute = first
    while minute <= last:
        key = minute.strftime("%Y-%m-%dT%H:%M")
        values = list(grouped.get(key, {}).items())
        timestamp = max((item[1][0] for item in values), default=f"{key}:00")
        leaders = [score for symbol, (_, score) in values if symbol in LEADER_SYMBOLS]
        rest = [score for symbol, (_, score) in values if symbol not in LEADER_SYMBOLS]
        result.append({
            "timestamp": timestamp,
            "time": minute.strftime("%H:%M"),
            "leader_median_score": _median(leaders),
            "rest_median_score": _median(rest),
            "median_score": _median([score for _, (_, score) in values]),
            "leader_score_count": len(leaders),
            "rest_score_count": len(rest),
            "market_score_count": len(values),
        })
        minute += timedelta(minutes=1)
    return result


def load_intraday_queue_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:15") -> list[dict[str, Any]]:
    available = {row[1] for row in conn.execute("PRAGMA table_info(market_snapshots)")}
    required = {"timestamp", "buy_value_hmt", "sell_value_hmt"}
    if not required.issubset(available):
        return []
    rows = conn.execute(
        "SELECT timestamp,buy_value_hmt,sell_value_hmt FROM market_snapshots WHERE substr(timestamp,1,10)=? AND substr(timestamp,12,5)>=? ORDER BY timestamp",
        (trading_date, start_time),
    )
    return [
        {"timestamp": str(timestamp), "time": str(timestamp)[11:16], "buy_value_hmt": buy, "sell_value_hmt": sell}
        for timestamp, buy, sell in rows if buy is not None or sell is not None
    ]


def load_intraday_queue_count_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:15") -> list[dict[str, Any]]:
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    required = {"timestamp", "trading_date", "valid", "symbol", "buy_queue_value_toman", "sell_queue_value_toman"}
    if not required.issubset(available):
        return []
    rows = conn.execute(
        """SELECT timestamp, symbol, buy_queue_value_toman, sell_queue_value_toman
           FROM stock_snapshots WHERE trading_date=? AND valid=1 AND substr(timestamp,12,5)>=?
           ORDER BY timestamp, rowid""",
        (trading_date, start_time),
    ).fetchall()
    by_minute: dict[str, dict[str, tuple[str, Any, Any]]] = {}
    for timestamp, symbol, buy, sell in rows:
        by_minute.setdefault(str(timestamp)[:16], {})[str(symbol)] = (str(timestamp), buy, sell)
    result = []
    for minute in sorted(by_minute):
        symbols = list(by_minute[minute].values())
        result.append({
            "timestamp": max(row[0] for row in symbols),
            "time": minute[11:16],
            "buy_queue_count": sum(1 for _, buy, _ in symbols if _finite(buy) is not None and _finite(buy) > 0),
            "sell_queue_count": sum(1 for _, _, sell in symbols if _finite(sell) is not None and _finite(sell) > 0),
        })
    return result


def load_intraday_symbol_rows(conn: sqlite3.Connection, trading_date: str, start_time: str = "09:00", end_time: str = "12:30") -> dict[str, list[dict[str, Any]]]:
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    required = {"timestamp", "symbol", "score", "trading_date", "valid", "trade_volume"}
    if not required.issubset(available):
        return {}
    last_field = "last_price" if "last_price" in available else "NULL"
    close_field = "close_price" if "close_price" in available else "NULL"
    yesterday_field = "yesterday_price" if "yesterday_price" in available else "NULL"
    value_field = "trade_value_toman" if "trade_value_toman" in available else "NULL"
    rows = conn.execute(
        f"""SELECT timestamp, symbol, score, {last_field}, {close_field}, {yesterday_field}, trade_volume, {value_field}
            FROM stock_snapshots WHERE trading_date=? AND valid=1 AND score IS NOT NULL AND trade_volume>0
              AND substr(timestamp,12,5) BETWEEN ? AND ? ORDER BY symbol,timestamp""",
        (trading_date, start_time, end_time),
    ).fetchall()
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for timestamp, symbol, score, last, close, yesterday, volume, value in rows:
        score_value = _finite(score)
        if score_value is None:
            continue
        symbol_text = str(symbol)
        minute = str(timestamp)[11:16]
        price = _finite(last if last is not None else close)
        key = (symbol_text, minute)
        bar = grouped.get(key)
        if bar is None:
            grouped[key] = {
                "symbol": symbol_text, "time": minute, "timestamp": str(timestamp), "score": score_value,
                "price_open": price, "price_high": price, "price_low": price, "price_close": price,
                "yesterday_price": yesterday, "trade_volume": volume, "trade_value_toman": value,
            }
            continue
        if price is not None:
            bar["price_open"] = bar["price_open"] if bar["price_open"] is not None else price
            bar["price_high"] = price if bar["price_high"] is None else max(bar["price_high"], price)
            bar["price_low"] = price if bar["price_low"] is None else min(bar["price_low"], price)
            bar["price_close"] = price
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
    "load_intraday_chart_rows", "load_intraday_queue_rows",
    "load_intraday_queue_count_rows", "load_intraday_symbol_rows",
]
