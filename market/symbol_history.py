"""Export compact per-symbol minute score history for the public symbol page."""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Iterable


def symbol_file(symbol: str) -> str:
    """Return a stable ASCII filename so Persian symbols are safe in URLs."""
    return hashlib.sha256(symbol.encode("utf-8")).hexdigest()[:24] + ".json"


def _minute_key(raw: str) -> str | None:
    try:
        value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return value.strftime("%Y-%m-%dT%H:%M")


def write_symbol_history(
    conn: sqlite3.Connection,
    symbols: Iterable[str],
    output_dir: Path,
) -> dict:
    """Write deduplicated observed score minutes and a symbol manifest.

    The complete retained score history is stored per symbol rather than in one
    enormous JSON asset. Each row is ``[timestamp-to-minute, score]`` and the
    last valid observation wins when a producer retry creates duplicates.
    """
    wanted = sorted({str(symbol).strip() for symbol in symbols if str(symbol).strip()})
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, dict[str, float]] = {symbol: {} for symbol in wanted}
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if wanted and "history" in tables:
        marks = ",".join("?" for _ in wanted)
        rows = conn.execute(
            f"SELECT symbol, timestamp, score FROM history "
            f"WHERE symbol IN ({marks}) AND score IS NOT NULL ORDER BY symbol, timestamp",
            wanted,
        )
        for symbol, timestamp, score in rows:
            minute = _minute_key(str(timestamp))
            if minute is None:
                continue
            try:
                value = float(score)
            except (TypeError, ValueError, OverflowError):
                continue
            if math.isfinite(value):
                grouped.setdefault(str(symbol), {})[minute] = value

    manifest = {
        "schema_version": 1,
        "source": "scores_history.db/history",
        "symbols": {},
    }
    for symbol in wanted:
        items = sorted(grouped.get(symbol, {}).items())
        filename = symbol_file(symbol)
        payload = {
            "schema_version": 1,
            "symbol": symbol,
            "source": "scores_history.db/history",
            "row_count": len(items),
            "rows": [[stamp, value] for stamp, value in items],
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
        }
    (output_dir.parent / "history-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return manifest


__all__ = ["symbol_file", "write_symbol_history"]
