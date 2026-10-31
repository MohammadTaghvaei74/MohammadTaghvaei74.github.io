import sqlite3

import pytest

from market.industry_table import build_industry_table


def make_db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE v2_days(day TEXT PRIMARY KEY, complete INTEGER)")
    db.execute("""CREATE TABLE daily_stock_summary(
        trading_date TEXT, symbol TEXT, industry TEXT, final_turnover_toman REAL
    )""")
    return db


def test_industry_table_aggregates_current_metrics_and_averages_completed_days():
    db = make_db()
    db.executemany("INSERT INTO v2_days VALUES (?,?)", [
        ("2026-10-20", 1), ("2026-10-19", 1), ("2026-10-18", 1),
        ("2026-10-17", 1), ("2026-10-16", 1), ("2026-10-15", 1),
    ])
    db.executemany("INSERT INTO daily_stock_summary VALUES (?,?,?,?)", [
        ("2026-10-19", "A", "بانک", 10e9), ("2026-10-19", "B", "بانک", 20e9),
        ("2026-10-18", "A", "بانک", 30e9), ("2026-10-18", "B", "بانک", 10e9),
        ("2026-10-17", "A", "بانک", 20e9), ("2026-10-16", "A", "بانک", 40e9),
        ("2026-10-15", "A", "بانک", 50e9),
        ("2026-10-19", "C", "فلزات", 100e9),
    ])
    stocks = [
        {"symbol": "A", "industry": "بانک", "score": 8, "yesterday_price": 100,
         "close_price": 102, "last_price": 103, "last_pct": 3, "trade_value_toman": 5e9,
         "buy_queue_value_toman": 2e9, "sell_queue_value_toman": 0,
         "buy_per_capita_toman": 10e6, "sell_per_capita_toman": 5e6, "buyer_power": 2},
        {"symbol": "B", "industry": "بانک", "score": 4, "yesterday_price": 100,
         "close_price": 101, "last_price": 100, "last_pct": 0, "trade_value_toman": 7e9,
         "buy_queue_value_toman": 0, "sell_queue_value_toman": 1e9,
         "buy_per_capita_toman": None, "sell_per_capita_toman": 7e6, "buyer_power": None},
    ]
    rows = build_industry_table(stocks, "2026-10-20T12:00:00+03:30", db)
    assert len(rows) == 1
    row = rows[0]
    assert row["stock_count"] == 2
    assert row["median_score"] == 6
    assert row["buy_queue_value_toman"] == 2e9
    assert row["sell_queue_value_toman"] == 1e9
    assert row["avg_last_pct"] == 1.5
    assert row["avg_close_pct"] == 1.5
    assert row["avg_last_close_diff_pct"] == pytest.approx(((103 - 102) / 102 * 100 + (100 - 101) / 101 * 100) / 2)
    assert row["avg_buy_per_capita_toman"] == 10e6
    assert row["avg_power"] == 2
    assert row["rank"] == 1
    assert row["rank_total"] == 1
    assert row["rank_position_pct"] == 100
    assert row["trade_value_toman"] == 12e9
    assert row["avg_trade_value_5d_toman"] == 36e9
    assert row["avg_trade_value_10d_toman"] == 36e9
    assert row["avg_trade_value_20d_toman"] == 36e9


def test_strict_15_completed_day_baseline_and_ratio():
    db = make_db()
    days = [f"2026-10-{day:02}" for day in range(1, 18)]
    db.executemany("INSERT INTO v2_days VALUES (?,?)", [(day, int(day != days[-2])) for day in days])
    db.executemany("INSERT INTO daily_stock_summary VALUES (?,?,?,?)", [
        (day, symbol, "bank", value) for day in days for symbol, value in [("A", 10e9), ("B", 20e9)]
    ])
    stocks = [{"symbol": "A", "industry": "bank", "trade_value_toman": 60e9}]
    row = build_industry_table(stocks, days[-1] + "T12:00:00", db)[0]
    assert row.get("avg_trade_value_15d_toman") == 30e9
    assert row.get("turnover_to_15d_ratio") == 2
    assert row["turnover_15d_days"] == list(reversed(days[:15]))
    db.execute("UPDATE daily_stock_summary SET final_turnover_toman=NULL WHERE trading_date=? AND symbol='B'", (days[0],))
    row = build_industry_table(stocks, days[-1] + "T12:00:00", db)[0]
    assert row["avg_trade_value_15d_toman"] is None
    db.execute("DELETE FROM daily_stock_summary WHERE trading_date=?", (days[0],))
    row = build_industry_table(stocks, days[-1] + "T12:00:00", db)[0]
    assert row["avg_trade_value_15d_toman"] is None
    assert row["turnover_to_15d_ratio"] is None


def test_missing_values_stay_missing_and_current_day_is_excluded():
    db = make_db()
    db.executemany("INSERT INTO v2_days VALUES (?,?)", [("2026-10-20", 1)])
    db.execute("INSERT INTO daily_stock_summary VALUES (?,?,?,?)", ("2026-10-20", "A", "بانک", 99e9))
    row = build_industry_table([{"symbol": "A", "industry": "بانک", "score": None}], "2026-10-20T12:00:00+03:30", db)[0]
    assert row["median_score"] is None
    assert row["avg_buy_per_capita_toman"] is None
    assert row["avg_trade_value_5d_toman"] is None
