"""Build the public score feed for special portfolio instruments."""
from __future__ import annotations

import math
import sqlite3
from typing import Any

SPECIAL_SYMBOLS = {
    "طلا": "fund",
    "فارما کیان": "fund",
    "ابتکار": "fund",
    "شراز": "equity",
}


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def build_portfolio_special(conn: sqlite3.Connection, reference_timestamp: str | None = None) -> dict[str, Any]:
    """Return latest same-day history scores, or explicit no-trade zeroes."""
    if reference_timestamp is None:
        row = conn.execute(
            "SELECT MAX(timestamp) AS timestamp FROM stock_snapshots WHERE valid=1"
        ).fetchone()
        reference_timestamp = row[0] if row and row[0] else None
    reference_timestamp = str(reference_timestamp or "")
    reference_day = reference_timestamp[:10]
    symbols: dict[str, dict[str, Any]] = {}
    try:
        has_history = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='history'"
        ).fetchone()
    except sqlite3.Error:
        has_history = None

    for symbol, kind in SPECIAL_SYMBOLS.items():
        rows = []
        if has_history:
            rows = conn.execute(
                "SELECT timestamp, score FROM history "
                "WHERE symbol=? AND timestamp<=? AND score IS NOT NULL "
                "ORDER BY timestamp DESC",
                (symbol, reference_timestamp or "9999-12-31T23:59:59"),
            ).fetchall()
        current = next((row for row in rows if str(row[0])[:10] == reference_day), None)
        if current is not None and _finite(current[1]) is not None:
            score = _finite(current[1])
            source = "history_current"
            timestamp = str(current[0])
        elif kind == "equity" and has_history:
            score = 0.0
            source = "untraded_zero"
            timestamp = reference_timestamp
        else:
            previous = next((row for row in rows if _finite(row[1]) is not None), None)
            score = _finite(previous[1]) if previous is not None else None
            source = "history_previous" if previous is not None else "missing"
            timestamp = str(previous[0]) if previous is not None else None
        symbols[symbol] = {
            "symbol": symbol,
            "kind": kind,
            "score": score,
            "source": source,
            "timestamp": timestamp,
            "reference_day": reference_day,
        }

    return {
        "schema_version": 1,
        "source": "scores_history.db/history",
        "reference_timestamp": reference_timestamp,
        "reference_day": reference_day,
        "symbols": symbols,
    }


__all__ = ["SPECIAL_SYMBOLS", "build_portfolio_special"]
