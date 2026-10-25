import json
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

from market.symbol_history import build_score_candles, symbol_file, write_symbol_history


TEHRAN = ZoneInfo("Asia/Tehran")


def local(text):
    return datetime.fromisoformat(text).replace(tzinfo=TEHRAN)


def test_score_candles_use_first_max_min_last_and_leave_missing_buckets_absent():
    rows = [
        (local("2026-10-20T09:00"), 1.0),
        (local("2026-10-20T09:07"), 3.0),
        (local("2026-10-20T09:14"), 2.0),
        (local("2026-10-20T09:15"), 4.0),
        (local("2026-10-20T09:29"), 5.0),
        (local("2026-10-20T09:31"), 1.0),
        (local("2026-10-20T12:30"), 9.0),
    ]
    candles = build_score_candles(rows)
    fifteen = candles["15m"]
    assert [(row["time"], row["open"], row["high"], row["low"], row["close"]) for row in fifteen] == [
        ("2026-10-20T09:00", 1.0, 3.0, 1.0, 2.0),
        ("2026-10-20T09:15", 4.0, 5.0, 4.0, 5.0),
        ("2026-10-20T09:30", 1.0, 1.0, 1.0, 1.0),
        ("2026-10-20T12:15", 9.0, 9.0, 9.0, 9.0),
    ]
    assert len(candles["30m"]) == 3
    assert candles["1d"][0]["close"] == 9.0


def test_write_history_keeps_only_30_trading_days_session_rows_and_candles(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE history(symbol TEXT, timestamp TEXT, score REAL)")
    conn.executemany("INSERT INTO history VALUES (?,?,?)", [
        ("نمونه", "2026-08-01T10:00:00+03:30", 99.0),
        ("نمونه", "2026-09-24T10:00:00+03:30", 98.0),
        ("نمونه", "2026-09-25T09:00:01+03:30", 1.0),
        ("نمونه", "2026-09-25T09:00:59+03:30", 2.0),
        ("نمونه", "2026-09-25T08:59:00+03:30", 88.0),
        ("نمونه", "2026-10-24T12:30:00+03:30", 7.0),
        ("نمونه", "2026-10-24T12:31:00+03:30", 77.0),
    ])
    output = tmp_path / "history"
    stale = output / "stale.json"
    output.mkdir()
    stale.write_text("{}", encoding="utf-8")

    manifest = write_symbol_history(conn, ["نمونه"], output)
    payload = json.loads((output / symbol_file("نمونه")).read_text(encoding="utf-8"))
    assert stale.exists()
    assert "stale" not in manifest["symbols"]
    assert manifest["retention_days"] == 30
    assert manifest["retention_unit"] == "trading_days"
    assert manifest["retained_trading_days"] == ["2026-08-01", "2026-09-24", "2026-09-25", "2026-10-24"]
    assert manifest["session_start"] == "09:00"
    assert payload["rows"] == [
        ["2026-08-01T10:00", 99.0],
        ["2026-09-24T10:00", 98.0],
        ["2026-09-25T09:00", 2.0],
        ["2026-10-24T12:30", 7.0],
    ]
    assert payload["candles"]["1d"][0]["day"] == "2026-08-01"
    assert payload["candles"]["1d"][-1]["close"] == 7.0
    conn.close()


def test_retention_counts_source_trading_dates_not_calendar_gap(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE history(symbol TEXT, timestamp TEXT, score REAL)")
    conn.executemany("INSERT INTO history VALUES (?,?,?)", [
        ("نمونه", "2026-10-01T10:00:00+03:30", 1.0),
        ("نمونه", "2026-10-10T10:00:00+03:30", 2.0),
        ("نمونه", "2026-10-20T10:00:00+03:30", 3.0),
    ])
    output = tmp_path / "history"
    manifest = write_symbol_history(conn, ["نمونه"], output, retention_days=2)
    payload = json.loads((output / symbol_file("نمونه")).read_text(encoding="utf-8"))
    assert manifest["retained_trading_days"] == ["2026-10-10", "2026-10-20"]
    assert payload["rows"] == [["2026-10-10T10:00", 2.0], ["2026-10-20T10:00", 3.0]]
    conn.close()
