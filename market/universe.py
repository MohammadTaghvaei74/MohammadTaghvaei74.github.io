"""Population boundaries for public market analytics.

Base-market rows remain available for the comprehensive table, but are excluded
from every analytical aggregate. Classification is intentionally explicit and
fails open for unknown/missing values: an unclassified row must not disappear.
"""
from __future__ import annotations

from collections import defaultdict
import math
import statistics
from typing import Any, Iterable

BASE_MARKET_MARKER = "بازار پایه"


def is_base_market(row: dict[str, Any]) -> bool:
    """Return true only when the source explicitly identifies the base market."""
    value = row.get("instrument_type")
    if value is None:
        value = row.get("market_segment") or row.get("market_title")
    return BASE_MARKET_MARKER in str(value or "")


def analytical_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows eligible for market-wide calculations; base rows are retained elsewhere."""
    return [row for row in rows if not is_base_market(row)]


def _number(row: dict[str, Any], key: str) -> float | None:
    try:
        value = float(row.get(key))
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def aggregate_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Build aggregate fields and defensively remove explicitly base-market rows."""
    rows = analytical_rows(rows)
    rows = [row for row in rows if not is_base_market(row)]
    scores = [value for row in rows if (value := _number(row, "score")) is not None]
    buy = sum(max(0.0, value) for row in rows if (value := _number(row, "buy_queue_value_toman")) is not None)
    sell = sum(max(0.0, value) for row in rows if (value := _number(row, "sell_queue_value_toman")) is not None)
    return {
        "count": len(rows),
        "average": sum(scores) / len(scores) if scores else None,
        "median": statistics.median(scores) if scores else None,
        "buy_value_hmt": buy / 1e12,
        "sell_value_hmt": sell / 1e12,
    }


def aggregate_industries(rows: list[dict[str, Any]], selected: Iterable[str] | None = None, limit: int = 6) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    selected_set = None if selected is None else set(selected)
    for row in rows:
        industry = str(row.get("industry") or "")
        if industry and (selected_set is None or industry in selected_set):
            groups[industry].append(row)
    output = []
    for industry, members in groups.items():
        scores = [value for row in members if (value := _number(row, "score")) is not None]
        turnover = sum(max(0.0, value) for row in members if (value := _number(row, "trade_value_toman")) is not None)
        avg15_values = [value for row in members if (value := _number(row, "avg15_trade_value_toman")) is not None]
        buy = sum(max(0.0, value) for row in members if (value := _number(row, "buy_queue_value_toman")) is not None)
        sell = sum(max(0.0, value) for row in members if (value := _number(row, "sell_queue_value_toman")) is not None)
        item = {
            "industry": industry,
            "count": len(members),
            "average": sum(scores) / len(scores) if scores else None,
            "median": statistics.median(scores) if scores else None,
            "turnover_toman": turnover,
            "net_queue_hmt": (buy - sell) / 1e12,
        }
        if avg15_values:
            item["avg_trade_value_15d_toman"] = sum(avg15_values) / len(avg15_values)
        output.append(item)
    output.sort(key=lambda row: (row["median"] is None, -(row["median"] or 0), row["industry"]))
    return output[:limit]


__all__ = ["BASE_MARKET_MARKER", "is_base_market", "analytical_rows", "aggregate_rows", "aggregate_industries"]
