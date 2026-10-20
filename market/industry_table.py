"""Build the industry-level summary table for the public market dashboard.

Current metrics come from the latest valid traded stock snapshot after the
same TSETMC enrichment used by the symbol tables. Historical turnover is built
from one final daily value per symbol and completed trading day; the current
partial day is never included in the 5/10/20-day baselines.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date
from typing import Any

HORIZONS = (5, 10, 20)


def _finite(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) else None


def _mean(values: list[Any]) -> float | None:
    clean = [number for value in values if (number := _finite(value)) is not None]
    return statistics.mean(clean) if clean else None


def _median(values: list[Any]) -> float | None:
    clean = [number for value in values if (number := _finite(value)) is not None]
    return statistics.median(clean) if clean else None


def _pct_from_close(stock: dict[str, Any]) -> float | None:
    explicit = _finite(stock.get("close_pct"))
    if explicit is not None:
        return explicit
    yesterday = _finite(stock.get("yesterday_price"))
    close = _finite(stock.get("close_price"))
    if yesterday in (None, 0) or close is None:
        return None
    return (close - yesterday) / yesterday * 100


def _last_close_diff(stock: dict[str, Any]) -> float | None:
    explicit = _finite(stock.get("last_close_diff_pct"))
    if explicit is not None:
        return explicit
    last = _finite(stock.get("last_price"))
    close = _finite(stock.get("close_price"))
    if close not in (None, 0) and last is not None:
        return (last - close) / close * 100
    last_pct = _finite(stock.get("last_pct"))
    close_pct = _pct_from_close(stock)
    if last_pct is None or close_pct is None:
        return None
    return last_pct - close_pct

def _complete_days(conn, latest_day: str, limit: int = max(HORIZONS)) -> list[str]:
    try:
        rows = conn.execute(
            "SELECT day FROM v2_days WHERE complete=1 AND day<? ORDER BY day DESC LIMIT ?",
            (latest_day, limit),
        ).fetchall()
    except Exception:
        return []
    return [str(row[0]) for row in rows]


def _historical_turnover(conn, latest_day: str) -> tuple[dict[str, dict[int, float | None]], list[str]]:
    """Return per-industry mean daily turnover for each requested horizon."""
    days = _complete_days(conn, latest_day)
    if not days:
        return {}, []
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(daily_stock_summary)")}
    except Exception:
        return {}, days
    if not {"trading_date", "symbol", "final_turnover_toman"}.issubset(columns):
        return {}, days
    if "industry" not in columns:
        return {}, days

    placeholders = ",".join("?" for _ in days)
    try:
        rows = conn.execute(
            "SELECT trading_date,symbol,industry,final_turnover_toman "
            f"FROM daily_stock_summary WHERE trading_date IN ({placeholders})",
            days,
        ).fetchall()
    except Exception:
        return {}, days

    # A symbol/day is one daily observation. If an old database contains a
    # duplicate row, keep its last positive value rather than double-counting.
    per_day_symbol: dict[tuple[str, str, str], float] = {}
    for row in rows:
        day, symbol, industry = str(row[0]), str(row[1]), row[2]
        value = _finite(row[3])
        if not industry or value is None or value < 0:
            continue
        per_day_symbol[(day, symbol, str(industry))] = value

    daily_by_industry: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for (day, _symbol, industry), value in per_day_symbol.items():
        daily_by_industry[industry][day] += value

    output: dict[str, dict[int, float | None]] = {}
    for industry, daily in daily_by_industry.items():
        output[industry] = {}
        for horizon in HORIZONS:
            values = [daily[day] for day in days[:horizon] if day in daily]
            output[industry][horizon] = statistics.mean(values) if values else None
    return output, days


def build_industry_table(stocks: list[dict[str, Any]], latest: str, conn) -> list[dict[str, Any]]:
    """Aggregate every displayed stock into a deterministic industry table."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for stock in stocks:
        industry = str(stock.get("industry") or "").strip()
        if industry:
            groups[industry].append(stock)

    historical, history_days = _historical_turnover(conn, latest[:10])
    result: list[dict[str, Any]] = []
    for industry, members in groups.items():
        def values(field: str) -> list[Any]:
            return [member.get(field) for member in members]

        buy_queue = [value for value in values("buy_queue_value_toman") if _finite(value) is not None]
        sell_queue = [value for value in values("sell_queue_value_toman") if _finite(value) is not None]
        trade_value = [value for value in values("trade_value_toman") if _finite(value) is not None]
        historical_values = historical.get(industry, {})
        result.append({
            "industry": industry,
            "stock_count": len(members),
            "median_score": _median(values("score")),
            "buy_queue_value_toman": sum(map(float, buy_queue)) if buy_queue else None,
            "sell_queue_value_toman": sum(map(float, sell_queue)) if sell_queue else None,
            "avg_last_pct": _mean(values("last_pct")),
            "avg_close_pct": _mean([_pct_from_close(member) for member in members]),
            "avg_last_close_diff_pct": _mean([_last_close_diff(member) for member in members]),
            "avg_buy_per_capita_toman": _mean(values("buy_per_capita_toman")),
            "avg_sell_per_capita_toman": _mean(values("sell_per_capita_toman")),
            "avg_power": _mean(values("buyer_power")),
            "trade_value_toman": sum(map(float, trade_value)) if trade_value else None,
            "avg_trade_value_5d_toman": historical_values.get(5),
            "avg_trade_value_10d_toman": historical_values.get(10),
            "avg_trade_value_20d_toman": historical_values.get(20),
            "history_days": history_days,
        })

    result.sort(key=lambda row: (
        _finite(row.get("median_score")) is None,
        -(_finite(row.get("median_score")) or 0),
        row["industry"],
    ))
    for rank, row in enumerate(result, 1):
        row["rank"] = rank
    return result


__all__ = ["HORIZONS", "build_industry_table"]

if __name__ == "__main__":
    raise SystemExit("This module is imported by the snapshot exporter.")
