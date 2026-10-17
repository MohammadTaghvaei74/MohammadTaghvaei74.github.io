"""Export a public, read-only Market Pulse snapshot from scores_history.db.

Run this on the Bourse Alert VPS and publish the resulting JSON through the
chosen server-side delivery path. Never put Telegram credentials in the JSON.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

try:
    from .chart_data import load_daily_chart_rows
except ImportError:
    from chart_data import load_daily_chart_rows


def export(db_path: str, output_path: str) -> None:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    latest = conn.execute(
        "SELECT timestamp FROM stock_snapshots WHERE valid=1 ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()["timestamp"]
    market = dict(conn.execute(
        "SELECT * FROM market_snapshots WHERE timestamp <= ? ORDER BY timestamp DESC LIMIT 1",
        (latest,),
    ).fetchone())
    groups = [dict(row) for row in conn.execute(
        "SELECT * FROM group_snapshots WHERE timestamp=? AND group_name IN (?, ?, ?)",
        (latest, "لیدرها", "اهرمی‌ها", "اهرمی\u200cها"),
    )]
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    wanted = "symbol,industry,instrument_type,trading_date,timestamp,yesterday_price,close_price,last_price,last_pct,trade_volume,trade_value_toman,buy_queue_volume,sell_queue_volume,buy_queue_value_toman,sell_queue_value_toman,score".split(",")
    columns = ",".join(column for column in wanted if column in available)
    rows = conn.execute(
        f"SELECT {columns} FROM stock_snapshots WHERE timestamp=? AND valid=1 AND trade_volume>0 ORDER BY score DESC, symbol ASC",
        (latest,),
    ).fetchall()
    stocks = []
    seen = set()
    for row in rows:
        if row["symbol"] not in seen:
            stocks.append(dict(row))
            seen.add(row["symbol"])
    top_stocks = stocks[:10]
    complete_days = [row[0] for row in conn.execute(
        "SELECT day FROM v2_days WHERE complete=1 AND day < ? ORDER BY day DESC LIMIT 15",
        (latest[:10],),
    )] if "v2_days" in {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")} else []
    avg_by_symbol = {}
    if complete_days:
        placeholders = ",".join("?" for _ in complete_days)
        for row in conn.execute(
            f"SELECT symbol, AVG(day_value) FROM ("
            f"SELECT symbol, trading_date, SUM(trade_value_toman) AS day_value FROM stock_snapshots "
            f"WHERE valid=1 AND trade_volume>0 AND trading_date IN ({placeholders}) GROUP BY symbol, trading_date) GROUP BY symbol",
            complete_days,
        ):
            avg_by_symbol[row[0]] = row[1]
    queue_rows = []
    for row in stocks:
        queue = row.get("buy_queue_value_toman")
        if queue is None or float(queue or 0) <= 0:
            continue
        item = dict(row)
        item["avg15_trade_value_toman"] = avg_by_symbol.get(item.get("symbol"))
        item["queue_to_avg15"] = float(queue) / float(item["avg15_trade_value_toman"]) if item["avg15_trade_value_toman"] else None
        for key in ("legal_buy_value_toman", "legal_sell_value_toman", "retail_buy_value_toman", "retail_sell_value_toman"):
            item[key] = None
        queue_rows.append(item)
    queue_rows.sort(key=lambda item: (-float(item.get("buy_queue_value_toman") or 0), -float(item.get("score") or 0), str(item.get("symbol") or "")))
    industries = [dict(row) for row in conn.execute(
        "SELECT industry,count,average,median,turnover_toman,net_queue_hmt FROM industry_detail_snapshots WHERE timestamp=? ORDER BY median DESC LIMIT 6",
        (latest,),
    )]
    daily = load_daily_chart_rows(conn)
    payload = {
        "schema_version": 1,
        "source": "scores_history.db",
        "generated_at": latest,
        "market": market,
        "groups": groups,
        "top_stocks": top_stocks,
        "top_buy_queue": queue_rows[:10],
        "stocks": [row for row in stocks if row.get("industry")],
        "leveraged": [],
        "industries": industries,
        "daily": daily,
        "options": {
            "status": "connecting",
            "message": "داده معتبر آپشن بعد از نهایی شدن قرارداد داده اضافه می‌شود.",
        },
    }
    Path(output_path).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    export("/root/bourse-alert/scores_history.db", "data/market.json")
