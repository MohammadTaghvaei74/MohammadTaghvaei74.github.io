"""Durable Step3 signal lifecycle ledger and public payload builder."""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median
from typing import Any

BUY_FEE = 0.0037
SELL_FEE = 0.0088
STALE_SECONDS = 300
PERSISTENCE_MINUTES = 10
SCHEMA_VERSION = 1


def _connect(db: str | Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(db), timeout=30)
    con.row_factory = sqlite3.Row
    return con


def _num(value: Any) -> float | None:
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return value if isinstance(value, str) else None


def _dt(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def _tick(value: Any) -> float:
    result = _num(value)
    return result if result and result > 0 else 1.0


def _round_tick(value: float, tick: float) -> float:
    return round(round(value / tick) * tick, 10)


def _pnl(entry: float, exit_price: float, buy_fee: float = BUY_FEE, sell_fee: float = SELL_FEE) -> float:
    return (((exit_price * (1 - sell_fee)) - (entry * (1 + buy_fee))) / entry) * 100


def init_db(db: str | Path) -> None:
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    with _connect(db) as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS lifecycle_mothers(
                id TEXT PRIMARY KEY, symbol TEXT NOT NULL, issued_at TEXT NOT NULL,
                zero_price REAL NOT NULL, tick_size REAL NOT NULL, strategy TEXT NOT NULL,
                rule_version TEXT NOT NULL, status TEXT NOT NULL, last_price REAL,
                source_observed_at TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lifecycle_orders(
                id TEXT PRIMARY KEY, mother_id TEXT NOT NULL, symbol TEXT NOT NULL,
                level TEXT NOT NULL, order_price REAL NOT NULL, status TEXT NOT NULL,
                entry_price REAL, entry_at TEXT, exit_price REAL, exit_at TEXT,
                net_pnl_pct REAL, expired_at TEXT, source_observed_at TEXT,
                FOREIGN KEY(mother_id) REFERENCES lifecycle_mothers(id)
            );
            CREATE TABLE IF NOT EXISTS lifecycle_exit_events(
                id TEXT PRIMARY KEY, symbol TEXT NOT NULL, signal_at TEXT NOT NULL,
                price REAL, price_age_seconds REAL, status TEXT NOT NULL,
                price_source TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lifecycle_exit_candidates(
                symbol TEXT PRIMARY KEY, since_at TEXT NOT NULL, last_score REAL,
                last_market REAL, updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS lifecycle_orders_symbol_status
                ON lifecycle_orders(symbol, status);
            """
        )


def ensure_runtime(db: str | Path) -> None:
    """Idempotently create the lifecycle tables before every live cycle."""
    init_db(db)


def _enter(con: sqlite3.Connection, order_id: str, price: float, at: str) -> None:
    con.execute(
        "UPDATE lifecycle_orders SET status='entered',entry_price=?,entry_at=? WHERE id=? AND status='pending'",
        (price, at, order_id),
    )


def create_from_signal(db: str | Path, signal: dict[str, Any], stock: dict[str, Any], now: datetime) -> str | None:
    """Persist one Step3 mother signal and its two independent buy orders."""
    init_db(db)
    symbol = str(signal.get("symbol") or stock.get("symbol") or "").strip()
    mother_id = str(signal.get("key") or "").strip()
    zero = _num(stock.get("yesterday_price"))
    current = _num(stock.get("last_price"))
    if not mother_id or not symbol or zero is None or zero <= 0 or current is None:
        return None
    issued = _iso(now) or ""
    tick = _tick(stock.get("tick_size") or stock.get("price_step"))
    plus = _round_tick(zero * 1.01, tick)
    minus = _round_tick(zero * 0.98, tick)
    strategy = str(signal.get("strategy") or "step3")
    with _connect(db) as con:
        if con.execute("SELECT 1 FROM lifecycle_mothers WHERE id=?", (mother_id,)).fetchone():
            return mother_id
        con.execute(
            "INSERT INTO lifecycle_mothers VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (mother_id, symbol, issued, zero, tick, strategy, "step3-lifecycle-v1", "pending", current, signal.get("source_observed_at"), issued),
        )
        rows = [
            (f"{mother_id}:plus_1", mother_id, symbol, "plus_1", plus, "pending", None, None, None, None, None, signal.get("source_observed_at")),
            (f"{mother_id}:minus_2", mother_id, symbol, "minus_2", minus, "pending", None, None, None, None, None, signal.get("source_observed_at")),
        ]
        con.executemany(
            "INSERT INTO lifecycle_orders(id,mother_id,symbol,level,order_price,status,entry_price,entry_at,exit_price,exit_at,net_pnl_pct,source_observed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            rows,
        )
        if current < minus:
            con.execute("UPDATE lifecycle_orders SET status='cancelled' WHERE id=?", (f"{mother_id}:plus_1",))
            _enter(con, f"{mother_id}:minus_2", current, issued)
        con.execute(
            "UPDATE lifecycle_mothers SET status=? WHERE id=?",
            ("open" if current < minus else "pending", mother_id),
        )
    return mother_id


def process_quotes(db: str | Path, stocks: list[dict[str, Any]], now: datetime) -> None:
    init_db(db)
    at = _iso(now) or ""
    by_symbol = {str(s.get("symbol")): s for s in stocks if s.get("symbol")}
    with _connect(db) as con:
        mothers = con.execute("SELECT * FROM lifecycle_mothers WHERE status IN ('pending','open')").fetchall()
        for mother in mothers:
            stock = by_symbol.get(mother["symbol"])
            current = _num(stock.get("last_price")) if stock else None
            if current is None:
                continue
            previous = _num(mother["last_price"]) or current
            for order in con.execute("SELECT * FROM lifecycle_orders WHERE mother_id=? AND status='pending'", (mother["id"],)).fetchall():
                crossed = (previous >= order["order_price"] >= current) or (previous <= order["order_price"] <= current)
                if crossed:
                    _enter(con, order["id"], order["order_price"], at)
            con.execute("UPDATE lifecycle_mothers SET last_price=? WHERE id=?", (current, mother["id"]))
            if con.execute("SELECT 1 FROM lifecycle_orders WHERE mother_id=? AND status='entered'", (mother["id"],)).fetchone():
                con.execute("UPDATE lifecycle_mothers SET status='open' WHERE id=?", (mother["id"],))


def evaluate_exits(db: str | Path, stocks: list[dict[str, Any]], now: datetime) -> None:
    """Apply the locked base exit rule after ten minutes of valid persistence."""
    init_db(db)
    valid = [s for s in stocks if s.get("eligible_market_stock") and _num(s.get("score")) is not None]
    if not valid:
        return
    market = median([float(s["score"]) for s in valid])
    by_symbol = {str(s.get("symbol")): s for s in valid}
    at = _iso(now) or ""
    with _connect(db) as con:
        symbols = [r[0] for r in con.execute("SELECT DISTINCT symbol FROM lifecycle_orders WHERE status='entered'").fetchall()]
        for symbol in symbols:
            stock = by_symbol.get(symbol)
            if not stock:
                continue
            score = _num(stock.get("score"))
            if score is None:
                continue
            threshold = min(0.75 * market + 0.4, 3.2)
            if score >= threshold:
                con.execute("DELETE FROM lifecycle_exit_candidates WHERE symbol=?", (symbol,))
                continue
            candidate = con.execute("SELECT * FROM lifecycle_exit_candidates WHERE symbol=?", (symbol,)).fetchone()
            if not candidate:
                con.execute("INSERT INTO lifecycle_exit_candidates VALUES (?,?,?,?,?)", (symbol, at, score, market, at))
                continue
            since = _dt(candidate["since_at"])
            if not since or now - since < timedelta(minutes=PERSISTENCE_MINUTES):
                con.execute("UPDATE lifecycle_exit_candidates SET last_score=?,last_market=?,updated_at=? WHERE symbol=?", (score, market, at, symbol))
                continue
            price = _num(stock.get("last_price"))
            if price is None:
                continue
            event_id = hashlib.sha256(f"{symbol}|{candidate['since_at']}|{at}".encode()).hexdigest()[:24]
            con.execute("INSERT OR IGNORE INTO lifecycle_exit_events VALUES (?,?,?,?,?,?,?,?)", (event_id, symbol, at, price, 0, "closed", "exit_quote", at))
            for order in con.execute("SELECT * FROM lifecycle_orders WHERE symbol=? AND status='entered'", (symbol,)).fetchall():
                pnl = _pnl(float(order["entry_price"]), price)
                con.execute("UPDATE lifecycle_orders SET status='closed',exit_price=?,exit_at=?,net_pnl_pct=? WHERE id=?", (price, at, pnl, order["id"]))
            con.execute("UPDATE lifecycle_mothers SET status='closed' WHERE symbol=? AND status='open'", (symbol,))
            con.execute("DELETE FROM lifecycle_exit_candidates WHERE symbol=?", (symbol,))


def _rows(con: sqlite3.Connection, sql: str, args: tuple = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in con.execute(sql, args).fetchall()]


def public_payload(db: str | Path) -> dict[str, Any]:
    init_db(db)
    with _connect(db) as con:
        mothers = _rows(con, "SELECT id,symbol,issued_at,zero_price,strategy,rule_version,status FROM lifecycle_mothers ORDER BY issued_at DESC LIMIT 500")
        open_positions = _rows(con, "SELECT id,mother_id,id AS order_id,symbol,entry_price,entry_at,status FROM lifecycle_orders WHERE status='entered' ORDER BY entry_at DESC LIMIT 500")
        closed = _rows(con, "SELECT id,mother_id,id AS order_id,symbol,entry_price,entry_at,exit_at,exit_price,net_pnl_pct,CAST((julianday(exit_at)-julianday(entry_at)) AS INTEGER) AS holding_days,status FROM lifecycle_orders WHERE status='closed' AND net_pnl_pct IS NOT NULL ORDER BY exit_at DESC LIMIT 500")
    status = "ok" if mothers else "unavailable"
    return {
        "schema_version": SCHEMA_VERSION,
        "status": status,
        "generated_at": datetime.now().astimezone().isoformat(),
        "source_observed_at": datetime.now().astimezone().isoformat(),
        "message": None if mothers else "no lifecycle signal has been recorded",
        "mother_signals": mothers,
        "open_positions": open_positions,
        "closed_trades": closed,
    }


def export_public(db: str | Path, output: str | Path) -> dict[str, Any]:
    payload = public_payload(db)
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(target)
    return payload


__all__ = ["init_db", "ensure_runtime", "create_from_signal", "process_quotes", "evaluate_exits", "public_payload", "export_public"]

if __name__ == "__main__":
    import os
    export_public(os.environ.get("EVENT_DB", "/root/bourse-alert/event_live.db"), os.environ.get("LIFECYCLE_OUT", "/srv/sorena/market/data/signal-lifecycle.json"))
