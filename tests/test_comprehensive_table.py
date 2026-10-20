import sqlite3
from datetime import datetime

from market.comprehensive_table import build_comprehensive_rows, load_score_samples


def make_db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE v2_days(day TEXT PRIMARY KEY, complete INTEGER)")
    db.execute("CREATE TABLE daily_stock_summary(trading_date TEXT, symbol TEXT, final_turnover_toman REAL)")
    db.execute("""CREATE TABLE stock_snapshots(
        row_id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, trading_date TEXT,
        symbol TEXT, score REAL, valid INTEGER, buy_queue_value_toman REAL,
        sell_queue_value_toman REAL, close_price REAL, last_price REAL,
        buy_per_capita_toman REAL, buyer_power REAL, legal_buy_pct REAL, legal_sell_pct REAL
    )""")
    return db


def test_score_window_uses_complete_days_nearest_target_and_dedupes_slots():
    db = make_db()
    db.executemany("INSERT INTO v2_days VALUES (?,?)", [("2026-10-20", 1), ("2026-10-19", 1), ("2026-10-18", 0)])
    db.executemany("INSERT INTO stock_snapshots(timestamp,trading_date,symbol,score,valid) VALUES (?,?,?,?,?)", [
        ("2026-10-20T09:59:00+03:30", "2026-10-20", "AAA", 1.0, 1),
        ("2026-10-20T10:01:00+03:30", "2026-10-20", "AAA", 2.0, 1),
        ("2026-10-20T10:01:00+03:30", "2026-10-20", "AAA", 3.0, 1),
        ("2026-10-20T11:00:00+03:30", "2026-10-20", "AAA", 4.0, 1),
        ("2026-10-20T12:05:00+03:30", "2026-10-20", "AAA", 5.0, 1),
        ("2026-10-19T10:00:00+03:30", "2026-10-19", "AAA", 6.0, 1),
        ("2026-10-19T11:00:00+03:30", "2026-10-19", "AAA", 7.0, 1),
        ("2026-10-19T12:00:00+03:30", "2026-10-19", "AAA", 8.0, 1),
        ("2026-10-18T10:00:00+03:30", "2026-10-18", "AAA", 99.0, 1),
    ])
    days, samples = load_score_samples(db, "2026-10-20T12:30:00+03:30")
    assert days == ["2026-10-20", "2026-10-19"]
    assert len(samples["AAA"]) == 6
    assert sum(item["score"] for item in samples["AAA"]) == 33.0
    assert {item["time"] for item in samples["AAA"]} == {"10:00", "11:00", "12:00"}
    assert [item["score"] for item in samples["AAA"] if item["day"] == "2026-10-20"] == [3.0, 4.0, 5.0]


def test_comprehensive_row_keeps_missing_history_and_uses_signed_queue_and_close_gap():
    db = make_db()
    db.execute("INSERT INTO v2_days VALUES (?,?)", ("2026-10-20", 1))
    db.execute("INSERT INTO daily_stock_summary VALUES (?,?,?)", ("2026-10-19", "AAA", 2_000_000_000.0))
    db.executemany("INSERT INTO stock_snapshots(timestamp,trading_date,symbol,score,valid) VALUES (?,?,?,?,?)", [
        ("2026-10-20T10:00:00+03:30", "2026-10-20", "AAA", 2.0, 1),
        ("2026-10-20T11:00:00+03:30", "2026-10-20", "AAA", 3.0, 1),
    ])
    rows, meta = build_comprehensive_rows([{
        "symbol": "AAA", "score": 4.0, "buy_queue_value_toman": 0.0,
        "sell_queue_value_toman": 5_000_000_000.0, "close_price": 100.0,
        "last_price": 102.0, "buy_per_capita_toman": None, "buyer_power": None,
        "legal_buy_pct": None, "legal_sell_pct": None,
    }, {"symbol": "MISSING", "score": 1.0}], "2026-10-20T12:30:00+03:30", db)
    assert meta["expected_samples"] == 3
    assert rows[0]["score_10d_total"] is None
    assert rows[0]["score_10d_sample_count"] == 2
    assert rows[0]["queue_value_toman"] == -5_000_000_000.0
    assert rows[0]["last_close_diff_pct"] == 2.0
    assert rows[0]["avg_trade_value_toman"] == 2_000_000_000.0
    assert rows[1]["score_10d_total"] is None
    assert rows[1]["last_close_diff_pct"] is None
