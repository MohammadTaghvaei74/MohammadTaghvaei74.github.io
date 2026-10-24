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
    from .instrument_filters import filter_common_stocks
except ImportError:
    from instrument_filters import filter_common_stocks

try:
    from .chart_data import load_daily_chart_rows, load_intraday_chart_rows
except ImportError:
    from chart_data import load_daily_chart_rows, load_intraday_chart_rows
try:
    from .tsetmc_enrichment import enrich_stocks
    from .comprehensive_table import build_comprehensive_rows
    from .industry_table import build_industry_table
except ImportError:
    from tsetmc_enrichment import enrich_stocks
    from comprehensive_table import build_comprehensive_rows
    from industry_table import build_industry_table


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
    daily_columns = {row[1] for row in conn.execute("PRAGMA table_info(daily_stock_summary)")}
    has_industry_fallback = {"trading_date", "symbol", "industry"}.issubset(daily_columns)
    select_parts = [
        "COALESCE(s.industry, d.industry) AS industry" if column == "industry" and has_industry_fallback else f"s.{column}"
        for column in wanted if column in available
    ]
    from_clause = (
        "stock_snapshots s LEFT JOIN daily_stock_summary d "
        "ON d.trading_date=s.trading_date AND d.symbol=s.symbol"
        if has_industry_fallback else "stock_snapshots s"
    )
    rows = conn.execute(
        f"SELECT {','.join(select_parts)} FROM {from_clause} "
        "WHERE s.timestamp=? AND s.valid=1 AND s.trade_volume>0 ORDER BY s.score DESC, s.symbol ASC",
        (latest,),
    ).fetchall()
    stocks = []
    seen = set()
    for row in rows:
        item = dict(row)
        if row["symbol"] not in seen and filter_common_stocks([item]):
            stocks.append(dict(row))
            seen.add(row["symbol"])
    try:
        industry_by_symbol = {
            row["symbol"]: row["industry"]
            for row in conn.execute(
                "SELECT symbol,industry FROM daily_stock_summary WHERE trading_date=? AND industry IS NOT NULL",
                (latest[:10],),
            )
        }
    except sqlite3.OperationalError:
        industry_by_symbol = {}
    for item in stocks:
        if not item.get("industry"):
            item["industry"] = industry_by_symbol.get(item.get("symbol"))
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
    score_total = len(stocks)
    for score_rank, item in enumerate(stocks, start=1):
        item["score_rank"] = score_rank
        item["score_rank_total"] = score_total
        item["score_position_pct"] = round(score_rank / score_total * 100) if score_total else None
    enrich_stocks(stocks, datetime.fromisoformat(latest))
    queue_rows = build_queue_rows(stocks, datetime.fromisoformat(latest), conn)
    comprehensive_stocks, comprehensive_meta = build_comprehensive_rows(stocks, latest, conn)
    industry_table = build_industry_table(stocks, latest, conn)
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
        "comprehensive_stocks": comprehensive_stocks,
        "comprehensive_meta": comprehensive_meta,
        "industry_table": industry_table,
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
