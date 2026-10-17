from __future__ import annotations

import math
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta

try:
    from .signal_client_type import enrich_signal_client_type, METRIC_FIELDS
except ImportError:
    from signal_client_type import enrich_signal_client_type, METRIC_FIELDS


def _day(now: datetime | date) -> date:
    return now.date() if isinstance(now, datetime) else now


def average_turnovers(conn, now: datetime | date) -> dict[str, float]:
    """Mean one finalized turnover per calendar day, matching Telegram."""
    end = _day(now)
    start = end - timedelta(days=30)
    grouped: dict[str, dict[str, float]] = defaultdict(dict)
    try:
        rows = conn.execute(
            "SELECT trading_date,symbol,final_turnover_toman FROM daily_stock_summary "
            "WHERE trading_date>=? AND trading_date<? AND final_turnover_toman IS NOT NULL",
            (start.isoformat(), end.isoformat()),
        ).fetchall()
    except Exception:
        return {}
    for trading_date, symbol, value in rows:
        try:
            value = float(value)
            if math.isfinite(value) and value >= 0:
                grouped[str(symbol)][str(trading_date)] = value
        except (TypeError, ValueError):
            continue
    return {symbol: statistics.mean(values.values()) for symbol, values in grouped.items() if values}


def build_queue_rows(stocks, now, conn, limit=10):
    candidates = [dict(stock) for stock in stocks if float(stock.get("buy_queue_value_toman") or 0) > 0
                  and not str(stock.get("symbol") or "").strip().endswith(("3", "4", "۳", "۴"))]
    candidates.sort(key=lambda stock: (-float(stock.get("buy_queue_value_toman") or 0),
                                     -float(stock.get("score") or -math.inf), str(stock.get("symbol") or "")))
    candidates = candidates[:limit]
    if candidates and any(str(stock.get("instrument") or "").strip() for stock in candidates):
        enrich_signal_client_type([stock for stock in candidates if str(stock.get("instrument") or "").strip()], now)
    averages = average_turnovers(conn, now)
    output = []
    for stock in candidates:
        for field in METRIC_FIELDS:
            stock.setdefault(field, None)
        stock.setdefault("client_type_status", "missing_instrument")
        stock.setdefault("client_type_date", None)
        symbol = str(stock.get("symbol") or "")
        avg = averages.get(symbol)
        queue = stock.get("buy_queue_value_toman")
        output.append({**stock,
            "avg_trade_value_toman": avg,
            "avg_trade_value_billion": None if avg is None else avg / 1e9,
            "queue_value_billion": None if queue is None else float(queue) / 1e9,
            "queue_to_avg": None if avg in (None, 0) else float(queue) / avg,
            "legal_buy_value_toman": None,
            "legal_sell_value_toman": None,
            "retail_buy_value_toman": None,
            "retail_sell_value_toman": None,
        })
    return output


__all__ = ["average_turnovers", "build_queue_rows"]
