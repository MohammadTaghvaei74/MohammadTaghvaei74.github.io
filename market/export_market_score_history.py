"""Export canonical total-market score observations from scores_history.db."""
from __future__ import annotations
import json, sqlite3, tempfile, os
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TEHRAN = ZoneInfo("Asia/Tehran")
START, END = 9 * 60, 12 * 60 + 30

def _minute(ts: str) -> int:
    return int(ts[11:13]) * 60 + int(ts[14:16])

def export_market_score_history(conn: sqlite3.Connection, now: datetime | None = None) -> dict:
    now = (now or datetime.now(TEHRAN)).astimezone(TEHRAN)
    cutoff = now.date() - timedelta(days=29)
    rows = conn.execute(
        "SELECT timestamp, median, count FROM market_snapshots "
        "WHERE timestamp >= ? AND timestamp <= ? AND median IS NOT NULL "
        "ORDER BY timestamp",
        (cutoff.isoformat() + "T00:00:00+03:30", now.isoformat()),
    ).fetchall()
    points = [{"minute": r[0], "market": float(r[1]), "market_count": int(r[2]),
               "source": "scores_history.db.market_snapshots.median",
               "contract": "total-market-median-v1"} for r in rows]
    by_day = {}
    for p in points:
        by_day.setdefault(p["minute"][:10], []).append(p)
    coverage = []
    for day, items in sorted(by_day.items()):
        present = {_minute(p["minute"]) for p in items}
        expected = set(range(START, END + 1))
        missing = sorted(expected - present)
        ranges = []
        for m in missing:
            label = f"{m//60:02d}:{m%60:02d}"
            if not ranges or m != ranges[-1][2] + 1:
                ranges.append([label, label, m])
            else:
                ranges[-1][1] = label; ranges[-1][2] = m
        coverage.append({"date": day, "observed_rows": len(items),
                         "observed_minutes": len(present), "expected_minutes": len(expected),
                         "complete": not missing, "missing_ranges": [[a,b] for a,b,_ in ranges],
                         "first": items[0]["minute"], "last": items[-1]["minute"]})
    dates = {(cutoff + timedelta(days=i)).isoformat() for i in range(30)}
    return {"schema_version": 2, "generated_at": now.isoformat(), "timezone": "Asia/Tehran",
            "retention_calendar_days": 30, "window_start": "09:00", "window_end": "12:30",
            "session": ["09:00", "12:30"], "unit": "score", "series": "total-market",
            "source": "scores_history.db.market_snapshots.median", "coverage": coverage,
            "dates_without_observations": sorted(dates - set(by_day)),
            "minute_policy": "all real market_snapshots observations; no interpolation",
            "candle_policy": "incomplete or gapped candles omitted; daily 09:00-close",
            "points": points}

def write(path: str | Path, payload: dict) -> None:
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, allow_nan=False, separators=(",", ":")); f.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

if __name__ == "__main__":
    import sys
    with sqlite3.connect(sys.argv[1]) as c:
        write(sys.argv[2], export_market_score_history(c))
        print("ok")
__all__ = ["export_market_score_history", "write"]
