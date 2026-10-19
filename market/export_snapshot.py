"""Export a public, read-only Market Pulse snapshot from scores_history.db.

Run this on the Bourse Alert VPS and publish the resulting JSON through the
chosen server-side delivery path. Never put Telegram credentials in the JSON.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

try:
    from .queue_data import build_queue_rows
except ImportError:
    from queue_data import build_queue_rows
from pathlib import Path

try:
    from .chart_data import load_daily_chart_rows, load_intraday_chart_rows
except ImportError:
    from chart_data import load_daily_chart_rows, load_intraday_chart_rows
try:
    from .tsetmc_enrichment import enrich_stocks
except ImportError:
    from tsetmc_enrichment import enrich_stocks


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
    wanted = "symbol,instrument,industry,instrument_type,trading_date,timestamp,yesterday_price,close_price,last_price,last_pct,trade_volume,trade_value_toman,buy_queue_volume,sell_queue_volume,buy_queue_value_toman,sell_queue_value_toman,score".split(",")
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
    avg_volume_by_symbol = {}
    if complete_days:
        placeholders = ",".join("?" for _ in complete_days)
        for row in conn.execute(
            f"SELECT symbol, AVG(trade_value_toman) FROM ("
            f"SELECT symbol, trade_value_toman, ROW_NUMBER() OVER ("
            f"PARTITION BY symbol, trading_date ORDER BY timestamp DESC) AS rn "
            f"FROM stock_snapshots WHERE valid=1 AND trade_volume>0 "
            f"AND trading_date IN ({placeholders})) WHERE rn=1 GROUP BY symbol",
            complete_days,
        ):
            avg_by_symbol[row[0]] = row[1]
        for row in conn.execute(
            f"SELECT symbol, AVG(trade_volume) FROM ("
            f"SELECT symbol, trade_volume, ROW_NUMBER() OVER ("
            f"PARTITION BY symbol, trading_date ORDER BY timestamp DESC) AS rn "
            f"FROM stock_snapshots WHERE valid=1 AND trade_volume>0 "
            f"AND trading_date IN ({placeholders})) WHERE rn=1 GROUP BY symbol",
            complete_days,
        ):
            avg_volume_by_symbol[row[0]] = row[1]
    for item in stocks:
        item["avg15_trade_value_toman"] = avg_by_symbol.get(item.get("symbol"))
        item["avg15_trade_volume"] = avg_volume_by_symbol.get(item.get("symbol"))
    enrich_stocks(stocks, datetime.fromisoformat(latest))
    queue_rows = build_queue_rows(stocks, datetime.fromisoformat(latest), conn)
    industries = [dict(row) for row in conn.execute(
        "SELECT industry,count,average,median,turnover_toman,net_queue_hmt FROM industry_detail_snapshots WHERE timestamp=? ORDER BY median DESC LIMIT 6",
        (latest,),
    )]
    daily = load_daily_chart_rows(conn)
    intraday = load_intraday_chart_rows(conn, latest[:10])
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
        "intraday": intraday,
        "options": {
            "status": "connecting",
            "message": "داده معتبر آپشن بعد از نهایی شدن قرارداد داده اضافه می‌شود.",
        },
    }
    Path(output_path).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    export("/root/bourse-alert/scores_history.db", "data/market.json")
