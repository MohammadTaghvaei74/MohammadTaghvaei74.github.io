"""Persist leveraged instruments without changing the ordinary-stock universe."""
import math

SYMBOLS = ("اهرم", "شتاب", "موج", "جهش", "توان", "نارنج اهرم", "بیدار")
COLUMNS = "timestamp,trading_date,symbol,instrument,industry,instrument_type,yesterday_price,close_price,last_price,last_pct,trade_volume,trade_value_toman,buy_queue_volume,sell_queue_volume,buy_queue_value_toman,sell_queue_value_toman,score,valid"


def persist(conn, stocks, now):
    rows = {}
    for s in stocks:
        if s.get("symbol") not in SYMBOLS or float(s.get("trade_volume", 0)) <= 0:
            continue
        if s.get("score") is None or not math.isfinite(float(s["score"])):
            continue
        rows[s["symbol"]] = s
    conn.execute("CREATE TABLE IF NOT EXISTS leveraged_snapshots AS SELECT * FROM stock_snapshots WHERE 0")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_leveraged_snapshot_key ON leveraged_snapshots(timestamp,symbol)")
    values = []
    for s in rows.values():
        values.append((now.isoformat(), now.date().isoformat(), s["symbol"], s.get("instrument"), s.get("industry"), s.get("instrument_type"), s.get("yesterday_price"), s.get("close_price"), s.get("last_price"), s.get("last_pct"), s.get("trade_volume"), s.get("trade_value_toman", 0), s.get("buy_queue_volume", 0), s.get("sell_queue_volume", 0), s.get("buy_queue_value_toman", 0), s.get("sell_queue_value_toman", 0), s.get("score"), 1))
    conn.executemany(f"INSERT OR REPLACE INTO leveraged_snapshots({COLUMNS}) VALUES ({','.join('?' for _ in range(18))})", values)
    return list(rows.values())


def read_latest(conn, latest):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='leveraged_snapshots'").fetchone():
        return []
    # Never silently display yesterday's rows as today's data.
    cursor = conn.execute("SELECT timestamp,symbol,industry,yesterday_price,close_price,last_price,score,last_pct,trade_value_toman,buy_queue_value_toman,sell_queue_value_toman FROM leveraged_snapshots WHERE timestamp=(SELECT MAX(timestamp) FROM leveraged_snapshots WHERE timestamp<=? AND trading_date=?) AND valid=1 AND trade_volume>0 ORDER BY score DESC", (latest, latest[:10]))
    names = [x[0] for x in cursor.description]
    return [dict(zip(names, row)) for row in cursor]
