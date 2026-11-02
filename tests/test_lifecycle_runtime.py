import sqlite3
from datetime import datetime, timedelta

from market.lifecycle_runtime import ensure_runtime, init_db, create_from_signal, process_quotes, evaluate_exits, public_payload


def stock(symbol="TEST", score=1.0, price=1000.0, zero=1000.0):
    return {
        "symbol": symbol,
        "score": score,
        "last_price": price,
        "yesterday_price": zero,
        "close_price": price,
        "eligible_market_stock": True,
        "trade_volume": 1000,
        "source_observed_at": "2026-11-02T09:30:00+03:30",
    }


def test_migration_creates_ledger_and_two_orders(tmp_path):
    db = tmp_path / "event.db"
    ensure_runtime(db)
    assert public_payload(db)["status"] == "ok"
    assert public_payload(db)["message"] == "no lifecycle signal has been recorded"
    signal = {"key": "sig-1", "symbol": "TEST", "strategy": "step3", "source_observed_at": "2026-11-02T09:30:00+03:30"}
    create_from_signal(db, signal, stock(price=1025), datetime.fromisoformat("2026-11-02T09:30:00+03:30"))
    with sqlite3.connect(db) as con:
        assert con.execute("select count(*) from lifecycle_orders").fetchone()[0] == 2
    assert public_payload(db)["status"] == "ok"
    assert public_payload(db)["message"] is None


def test_lower_immediate_entry_and_base_exit_close_position(tmp_path):
    db = tmp_path / "event.db"
    init_db(db)
    issued = datetime.fromisoformat("2026-11-02T09:30:00+03:30")
    signal = {"key": "sig-2", "symbol": "TEST", "strategy": "step3", "source_observed_at": issued.isoformat()}
    create_from_signal(db, signal, stock(price=970), issued)
    evaluate_exits(db, [stock(score=-3, price=970)], issued + timedelta(minutes=5))
    assert public_payload(db)["open_positions"]
    evaluate_exits(db, [stock(score=-3, price=960)], issued + timedelta(minutes=15))
    payload = public_payload(db)
    assert len(payload["closed_trades"]) == 1
    assert payload["closed_trades"][0]["net_pnl_pct"] < 0


def test_order_touch_is_causal_and_payload_excludes_pending(tmp_path):
    db = tmp_path / "event.db"
    init_db(db)
    issued = datetime.fromisoformat("2026-11-02T09:30:00+03:30")
    signal = {"key": "sig-3", "symbol": "TEST", "strategy": "step3", "source_observed_at": issued.isoformat()}
    create_from_signal(db, signal, stock(price=1025), issued)
    process_quotes(db, [stock(price=1025)], issued)
    assert public_payload(db)["open_positions"] == []
    process_quotes(db, [stock(price=1005)], issued + timedelta(minutes=1))
    assert len(public_payload(db)["open_positions"]) == 1
