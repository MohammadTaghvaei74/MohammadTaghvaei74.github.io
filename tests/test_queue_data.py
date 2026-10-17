import sqlite3
from datetime import datetime

import market.queue_data as queue_data


def make_db():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE daily_stock_summary (trading_date TEXT, symbol TEXT, final_turnover_toman REAL)")
    return db


def test_average_uses_one_final_daily_turnover_not_cumulative_snapshots():
    db = make_db()
    db.executemany("INSERT INTO daily_stock_summary VALUES (?,?,?)", [
        ("2026-10-01", "فاذر", 100.0),
        ("2026-10-01", "فاذر", 100.0),
        ("2026-10-02", "فاذر", 300.0),
    ])
    result = queue_data.average_turnovers(db, datetime.fromisoformat("2026-10-03T12:00:00+03:30"))
    assert result["فاذر"] == 200.0


def test_average_is_30_calendar_days_and_dedupes_days():
    db = make_db()
    db.executemany("INSERT INTO daily_stock_summary VALUES (?,?,?)", [
        ("2026-09-03", "AAA", 1.0),
        ("2026-09-04", "AAA", 3.0),
        ("2026-09-05", "AAA", 100.0),
        ("2026-10-02", "AAA", 5.0),
        ("2026-10-02", "AAA", 7.0),
    ])
    result = queue_data.average_turnovers(db, datetime.fromisoformat("2026-10-03T12:00:00+03:30"))
    assert result["AAA"] == (1.0 + 3.0 + 100.0 + 7.0) / 4


def test_zero_average_is_present_but_missing_is_absent():
    db = make_db()
    db.execute("INSERT INTO daily_stock_summary VALUES (?,?,?)", ("2026-10-02", "ZERO", 0.0))
    result = queue_data.average_turnovers(db, datetime.fromisoformat("2026-10-03T12:00:00+03:30"))
    assert result["ZERO"] == 0.0
    assert "MISSING" not in result


def test_queue_row_uses_billion_units_and_legal_percentages(monkeypatch):
    db = make_db()
    db.execute("INSERT INTO daily_stock_summary VALUES (?,?,?)", ("2026-10-02", "فاذر", 2_000_000_000.0))
    stocks = [{"symbol": "فاذر", "instrument": "123", "buy_queue_value_toman": 1_000_000_000.0, "score": 2.0}]
    monkeypatch.setattr(queue_data, "enrich_signal_client_type", lambda rows, now: rows[0].update({"legal_buy_pct": 25.0, "legal_sell_pct": 10.0, "buy_per_capita_toman": 1_000_000.0, "buyer_power": 2.0}))
    rows = queue_data.build_queue_rows(stocks, datetime.fromisoformat("2026-10-03T12:00:00+03:30"), db)
    assert rows[0]["avg_trade_value_billion"] == 2.0
    assert rows[0]["queue_value_billion"] == 1.0
    assert rows[0]["legal_buy_pct"] == 25.0
    assert rows[0]["legal_sell_pct"] == 10.0
    assert rows[0]["legal_buy_value_toman"] is None


def test_queue_enrichment_requires_instrument(monkeypatch):
    db = make_db()
    db.execute("INSERT INTO daily_stock_summary VALUES (?,?,?)", ("2026-10-02", "AAA", 2_000_000_000.0))
    calls = []
    monkeypatch.setattr(queue_data, "enrich_signal_client_type", lambda rows, now: calls.append(rows))
    rows = queue_data.build_queue_rows([{"symbol": "AAA", "buy_queue_value_toman": 1.0}], datetime.fromisoformat("2026-10-03T12:00:00+03:30"), db)
    assert rows[0]["legal_buy_pct"] is None
    assert calls == []


def test_queue_suffix_three_four_is_excluded_like_telegram(monkeypatch):
    db = make_db()
    db.executemany("INSERT INTO daily_stock_summary VALUES (?,?,?)", [("2026-10-02", "AAA3", 2.0), ("2026-10-02", "AAA", 3.0)])
    monkeypatch.setattr(queue_data, "enrich_signal_client_type", lambda rows, now: rows)
    rows = queue_data.build_queue_rows([
        {"symbol": "AAA3", "instrument": "1", "buy_queue_value_toman": 100.0},
        {"symbol": "AAA", "instrument": "2", "buy_queue_value_toman": 1.0},
    ], datetime.fromisoformat("2026-10-03T12:00:00+03:30"), db)
    assert [row["symbol"] for row in rows] == ["AAA"]
