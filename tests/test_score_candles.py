import sqlite3

from market.score_candles import build_candles


def test_daily_ohlc_uses_first_last_and_intraday_extremes_per_minute():
    conn = sqlite3.connect(":memory:")
    conn.execute("create table stock_snapshots(trading_date text,symbol text,timestamp text,score real,valid integer)")
    conn.executemany("insert into stock_snapshots values (?,?,?,?,1)", [
        ("2026-10-17", "نمونه", "2026-10-17T09:15:01+03:30", 1.5),
        ("2026-10-17", "نمونه", "2026-10-17T09:16:01+03:30", 2.4),
        ("2026-10-17", "نمونه", "2026-10-17T09:17:01+03:30", 0.8),
        ("2026-10-17", "نمونه", "2026-10-17T09:18:01+03:30", 1.9),
        ("2026-10-17", "نمونه", "2026-10-17T09:19:01+03:30", 2.0),
        # retry in the same minute: last observation wins, but count stays 5
        ("2026-10-17", "نمونه", "2026-10-17T09:19:59+03:30", 2.0),
    ])
    row = build_candles(conn)["rows"][0]
    assert (row["open"], row["high"], row["low"], row["close"]) == (1.5, 2.4, 0.8, 2.0)
    assert row["count"] == 5
    assert row["observed_minutes"] == 5


def test_same_minute_last_observation_is_used_for_close():
    conn = sqlite3.connect(":memory:")
    conn.execute("create table stock_snapshots(trading_date text,symbol text,timestamp text,score real,valid integer)")
    conn.executemany("insert into stock_snapshots values (?,?,?,?,1)", [
        ("2026-10-17", "نمونه", "2026-10-17T09:15:01+03:30", 1.5),
        ("2026-10-17", "نمونه", "2026-10-17T09:16:01+03:30", 2.0),
        ("2026-10-17", "نمونه", "2026-10-17T09:16:59+03:30", 1.7),
    ])
    row = build_candles(conn)["rows"][0]
    assert row["close"] == 1.7
    assert row["count"] == 2
