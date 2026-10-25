"""Observed-score OHLC for the Tehran market window 09:00–12:30."""
import json
import math
import sqlite3
from datetime import datetime, time
from zoneinfo import ZoneInfo

TEHRAN = ZoneInfo("Asia/Tehran")
WINDOW_START = time(9, 0)
WINDOW_END = time(12, 30)
WINDOW_START_TEXT = "09:00"
WINDOW_END_TEXT = "12:30"


def _tehran_time(raw):
    value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=TEHRAN)
    return value.astimezone(TEHRAN)


def build_candles(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    rows, seen = [], set()
    expected = {f"{m // 60:02}:{m % 60:02}" for m in range(9 * 60, 12 * 60 + 31)}
    for table in ("stock_snapshots", "chart_snapshots"):
        if table not in tables:
            continue
        grouped = {}
        for day, symbol, timestamp, score in conn.execute(
            f"SELECT trading_date,symbol,timestamp,score FROM {table} "
            "WHERE valid=1 AND score IS NOT NULL ORDER BY trading_date,symbol,timestamp"
        ):
            if (day, symbol) in seen:
                continue
            try:
                numeric = float(score)
                local = _tehran_time(timestamp)
            except (TypeError, ValueError, OverflowError):
                continue
            if not math.isfinite(numeric) or not (WINDOW_START <= local.time().replace(second=0, microsecond=0, tzinfo=None) <= WINDOW_END):
                continue
            grouped.setdefault((day, symbol), []).append((timestamp, numeric, local))
        for (day, symbol), samples in grouped.items():
            seen.add((day, symbol))
            minute_bars = {}
            for timestamp, score, local in samples:
                minute = local.strftime("%H:%M")
                bar = minute_bars.setdefault(minute, {
                    "open": score, "high": score, "low": score, "close": score,
                    "first_timestamp": timestamp, "last_timestamp": timestamp,
                })
                bar["high"] = max(bar["high"], score)
                bar["low"] = min(bar["low"], score)
                if local < _tehran_time(bar["first_timestamp"]):
                    bar["open"], bar["first_timestamp"] = score, timestamp
                if local >= _tehran_time(bar["last_timestamp"]):
                    bar["close"], bar["last_timestamp"] = score, timestamp
            bars = [minute_bars[m] for m in sorted(minute_bars)]
            minutes = set(minute_bars)
            rows.append(dict(
                day=day, symbol=symbol, open=bars[0]["open"],
                high=max(b["high"] for b in bars), low=min(b["low"] for b in bars),
                close=bars[-1]["close"], count=len(bars),
                first_timestamp=bars[0]["first_timestamp"], last_timestamp=bars[-1]["last_timestamp"],
                observed_minutes=len(minutes), expected_minutes=len(expected),
                window_start=WINDOW_START_TEXT, window_end=WINDOW_END_TEXT,
                coverage="complete" if expected.issubset(minutes) else "partial",
                coverage_basis="expected window 09:00–12:30 Asia/Tehran",
                trading_day_coverage="unknown", source=table,
            ))
    rows.sort(key=lambda r: (r["day"], r["symbol"]))
    return dict(
        schema_version=2, source="scores_history.db / valid stock_snapshots (chart_snapshots fallback)",
        semantics="first/max/min/last valid observed score within 09:00–12:30 Asia/Tehran; no interpolation or daily-summary fallback",
        window_start=WINDOW_START_TEXT, window_end=WINDOW_END_TEXT,
        coverage_basis="window coverage only; complete trading-day coverage is not asserted",
        row_count=len(rows), days=sorted({r["day"] for r in rows}), rows=rows,
    )


if __name__ == "__main__":
    import sys
    with sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True) as conn:
        conn.execute("PRAGMA query_only=ON")
        print(json.dumps(build_candles(conn), ensure_ascii=False, separators=(",", ":"), allow_nan=False))
