"""Export retained per-symbol score history and TradingView-style score candles."""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import tempfile
from datetime import datetime, time
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo


TEHRAN = ZoneInfo("Asia/Tehran")
SESSION_START = time(9, 0)
SESSION_END = time(12, 30)
RETENTION_DAYS = 30


def symbol_file(symbol: str) -> str:
    """Return a stable ASCII filename so Persian symbols are safe in URLs."""
    return hashlib.sha256(symbol.encode("utf-8")).hexdigest()[:24] + ".json"


def _local_minute(raw: str) -> tuple[datetime, str] | None:
    """Normalize a source timestamp to Tehran and minute precision."""
    try:
        value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=TEHRAN)
    local = value.astimezone(TEHRAN).replace(second=0, microsecond=0)
    return local, local.strftime("%Y-%m-%dT%H:%M")


def _in_session(local: datetime) -> bool:
    return SESSION_START <= local.time() <= SESSION_END


def _bucket_start(local: datetime, minutes: int) -> datetime:
    start = SESSION_START.hour * 60 + SESSION_START.minute
    minute = local.hour * 60 + local.minute
    # A sample exactly at 12:30 is the session close and belongs to the last
    # 12:15–12:30 candle rather than creating a zero-length 12:30 bar.
    offset = min(max(0, minute - start), (SESSION_END.hour * 60 + SESSION_END.minute) - start - 1)
    bucket = start + (offset // minutes) * minutes
    return local.replace(hour=bucket // 60, minute=bucket % 60, second=0, microsecond=0)


def _ohlc(rows: list[tuple[datetime, float]], *, day: str, label: str) -> dict:
    values = [value for _, value in rows]
    return {
        "day": day,
        "time": label,
        "open": values[0],
        "high": max(values),
        "low": min(values),
        "close": values[-1],
        "count": len(values),
        "first": rows[0][0].isoformat(),
        "last": rows[-1][0].isoformat(),
    }


def build_score_candles(rows: list[tuple[datetime, float]]) -> dict[str, list[dict]]:
    """Aggregate normalized observed scores without filling missing buckets."""
    result: dict[str, list[dict]] = {}
    for timeframe, width in (("15m", 15), ("30m", 30)):
        grouped: dict[tuple[str, str], list[tuple[datetime, float]]] = {}
        for local, value in rows:
            bucket = _bucket_start(local, width)
            key = (local.strftime("%Y-%m-%d"), bucket.strftime("%H:%M"))
            grouped.setdefault(key, []).append((local, value))
        result[timeframe] = [
            _ohlc(values, day=day, label=f"{day}T{label}")
            for (day, label), values in sorted(grouped.items())
        ]

    daily: dict[str, list[tuple[datetime, float]]] = {}
    for local, value in rows:
        daily.setdefault(local.strftime("%Y-%m-%d"), []).append((local, value))
    result["1d"] = [
        _ohlc(values, day=day, label=day)
        for day, values in sorted(daily.items())
    ]

    # One-minute bars are intentionally limited to the newest retained trading
    # day. The live intraday asset supplies the current session while this
    # compact history fallback keeps the same contract available after close.
    latest_day = max(daily) if daily else None
    result["1m"] = [
        _ohlc([(local, value)], day=latest_day, label=local.strftime("%Y-%m-%dT%H:%M"))
        for local, value in rows
        if latest_day and local.strftime("%Y-%m-%d") == latest_day
    ]
    return result


def write_symbol_history(
    conn: sqlite3.Connection,
    symbols: Iterable[str],
    output_dir: Path,
    retention_days: int = RETENTION_DAYS,
) -> dict:
    """Write each symbol's last 30 trading days and its score candles.

    Source rows are deduplicated at minute precision; the last valid source row
    wins. Missing minutes and missing timeframe buckets remain absent. Trading
    days are the distinct Tehran session dates present in the source, so a
    weekend or market holiday never consumes one of the 30 retained slots.
    """
    wanted = sorted({str(symbol).strip() for symbol in symbols if str(symbol).strip()})
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, dict[str, tuple[datetime, float]]] = {symbol: {} for symbol in wanted}
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if wanted and "history" in tables:
        marks = ",".join("?" for _ in wanted)
        source = conn.execute(
            f"SELECT symbol, timestamp, score FROM history "
            f"WHERE symbol IN ({marks}) AND score IS NOT NULL ORDER BY symbol, timestamp",
            wanted,
        )
        for symbol, timestamp, score in source:
            parsed = _local_minute(str(timestamp))
            if parsed is None:
                continue
            local, minute = parsed
            try:
                value = float(score)
            except (TypeError, ValueError, OverflowError):
                continue
            if math.isfinite(value):
                grouped.setdefault(str(symbol), {})[minute] = (local, value)

    session_dates = sorted({
        local.date().isoformat()
        for rows in grouped.values()
        for local, _ in rows.values()
        if _in_session(local)
    })
    retained_days = set(session_dates[-retention_days:]) if retention_days > 0 else set()
    retention_anchor = session_dates[-1] if session_dates else None
    manifest = {
        "schema_version": 2,
        "source": "scores_history.db/history",
        "retention_days": retention_days,
        "retention_unit": "trading_days",
        "retained_trading_days": session_dates[-retention_days:] if retention_days > 0 else [],
        "session_start": "09:00",
        "session_end": "12:30",
        "candle_semantics": "first/max/min/last valid observed score; no interpolation",
        "retention_anchor": retention_anchor,
        "symbols": {},
    }
    for symbol in wanted:
        selected = [
            item for item in grouped.get(symbol, {}).values()
            if item[0].date().isoformat() in retained_days and _in_session(item[0])
        ]
        selected.sort(key=lambda item: item[0])
        candles = build_score_candles(selected)
        items = [[local.strftime("%Y-%m-%dT%H:%M"), value] for local, value in selected]
        filename = symbol_file(symbol)
        payload = {
            "schema_version": 2,
            "symbol": symbol,
            "source": "scores_history.db/history",
            "retention_days": retention_days,
            "retention_unit": "trading_days",
            "session_start": "09:00",
            "session_end": "12:30",
            "row_count": len(items),
            "rows": items,
            "candles": candles,
        }
        target = output_dir / filename
        fd, temp_name = tempfile.mkstemp(prefix=filename + ".", dir=output_dir)
        try:
            with open(fd, "w", encoding="utf-8", closefd=True) as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                handle.write("\n")
            Path(temp_name).replace(target)
        finally:
            temp = Path(temp_name)
            if temp.exists():
                temp.unlink()
        manifest["symbols"][symbol] = {
            "file": f"history/{filename}",
            "row_count": len(items),
            "first": items[0][0] if items else None,
            "last": items[-1][0] if items else None,
            "candle_counts": {key: len(value) for key, value in candles.items()},
        }

    # Keep old physical files untouched: the fail-closed publisher rejects
    # generated-file deletions. They are not publicly reachable because they are
    # absent from the manifest, while every manifest entry is strictly retained
    # to the rolling window above.
    (output_dir.parent / "history-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return manifest


__all__ = ["RETENTION_DAYS", "build_score_candles", "symbol_file", "write_symbol_history"]