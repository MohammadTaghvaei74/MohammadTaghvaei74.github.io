#!/usr/bin/env python3
"""Publish a sanitized, read-only market snapshot to this static site.

Runs on the Bourse Alert VPS. The SQLite database is opened read-only; only
public JSON/XLSX files in the checked-out website are written.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape

DB = Path(os.environ.get("BOURSE_DB", "/root/bourse-alert/scores_history.db"))
SITE = Path(os.environ.get("SITE_REPO", "/root/bourse-site"))
MARKET_OUT = SITE / "market/data/market.json"
HISTORY_OUT = SITE / "market/history/data/history.json"
XLSX_OUT = SITE / "market/history/data/market-score-history.xlsx"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def build_market(conn: sqlite3.Connection) -> dict:
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
    columns = "symbol,industry,score,last_pct,trade_value_toman,buy_queue_value_toman,sell_queue_value_toman"
    rows = conn.execute(
        f"SELECT {columns} FROM stock_snapshots WHERE timestamp=? AND valid=1 AND trade_volume>0 ORDER BY score DESC LIMIT 20",
        (latest,),
    ).fetchall()
    top_stocks, seen = [], set()
    for row in rows:
        if row["symbol"] not in seen:
            top_stocks.append(dict(row))
            seen.add(row["symbol"])
        if len(top_stocks) == 10:
            break
    industries = [dict(row) for row in conn.execute(
        "SELECT industry,count,average,median,turnover_toman,net_queue_hmt FROM industry_detail_snapshots WHERE timestamp=? ORDER BY median DESC LIMIT 6",
        (latest,),
    )]
    daily = [dict(row) for row in conn.execute(
        "SELECT * FROM daily_market_summary ORDER BY trading_date DESC LIMIT 7"
    )]
    return {
        "schema_version": 1,
        "source": "scores_history.db",
        "generated_at": latest,
        "market": market,
        "groups": groups,
        "top_stocks": top_stocks,
        "leveraged": [],
        "industries": industries,
        "daily": daily,
        "options": {"status": "connecting", "message": "داده معتبر آپشن بعد از نهایی شدن قرارداد داده اضافه می‌شود."},
    }


def build_history(conn: sqlite3.Connection) -> dict:
    """Build complete-day history from raw snapshots, never stale v2 rows.

    v2_days is the explicit completeness/finalization fence. For every fenced
    day, scores are recomputed from valid stock_snapshots. This deliberately
    keeps mean, median, min, max, and last distinct: the old exporter copied
    incomplete v2_daily_scores and silently lost days after 2026-10-05.
    """
    days = [dict(row) for row in conn.execute(
        "SELECT day,turnover,source FROM v2_days WHERE complete=1 ORDER BY day"
    )]
    complete_days = {d["day"] for d in days}
    observed = {}
    for row in conn.execute(
        "SELECT trading_date, COUNT(*) AS snapshot_count,
                COUNT(DISTINCT timestamp) AS timestamp_count,
                MIN(timestamp) AS first_timestamp, MAX(timestamp) AS last_timestamp,
                SUM(CASE WHEN valid=1 THEN 1 ELSE 0 END) AS valid_snapshot_count
           FROM stock_snapshots GROUP BY trading_date ORDER BY trading_date"
    ):
        observed[row["trading_date"]] = dict(row)

    rows = []
    for day in days:
        day_key = day["day"]
        samples = {}
        # score IS NOT NULL matches the producer's score eligibility. Do not
        # invent a score from another table or mutate the production database.
        for row in conn.execute(
            "SELECT symbol, score, timestamp FROM stock_snapshots
               WHERE trading_date=? AND valid=1 AND score IS NOT NULL
               ORDER BY symbol, timestamp",
            (day_key,),
        ):
            samples.setdefault(row["symbol"], []).append((row["timestamp"], float(row["score"])))
        for symbol in sorted(samples):
            values = samples[symbol]
            scores = [v for _, v in values]
            stats = {
                "count": len(scores),
                "mean": sum(scores) / len(scores),
                "median": statistics.median(scores),
                "min": min(scores),
                "max": max(scores),
                "last": values[-1][1],
            }
            stats.update({"day": day_key, "symbol": symbol, "source": "stock_snapshots"})
            stats["quality"] = "review" if abs(stats["last"]) > 20 else "valid"
            rows.append(stats)

    coverage = []
    for day_key, meta in observed.items():
        coverage.append({
            "day": day_key,
            "complete": day_key in complete_days,
            "snapshot_count": meta["snapshot_count"],
            "valid_snapshot_count": meta["valid_snapshot_count"],
            "timestamp_count": meta["timestamp_count"],
            "first_timestamp": meta["first_timestamp"],
            "last_timestamp": meta["last_timestamp"],
            "included": day_key in complete_days,
            "note": "complete fence in v2_days" if day_key in complete_days else "raw snapshots observed but no complete v2_days fence",
        })
    symbols = sorted({row["symbol"] for row in rows})
    return {
        "schema_version": 2,
        "source": "scores_history.db / v2_days completeness fence + stock_snapshots raw scores",
        "generated_at": days[-1]["day"] if days else None,
        "valid_day_count": len(days),
        "valid_days": days,
        "symbols": symbols,
        "row_count": len(rows),
        "rows": rows,
        "coverage": coverage,
        "excluded_raw_days": [c["day"] for c in coverage if not c["complete"]],
    }


def _col(n: int) -> str:
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _sheet_xml(rows: list[list[object]]) -> str:
    cells = []
    for r, row in enumerate(rows, 1):
        parts = []
        for c, value in enumerate(row, 1):
            text = escape("" if value is None else str(value))
            parts.append(f'<c r="{_col(c)}{r}" t="inlineStr"><is><t>{text}</t></is></c>')
        cells.append(f'<row r="{r}">' + "".join(parts) + "</row>")
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(cells) + "</sheetData></worksheet>"


def build_xlsx(history: dict) -> None:
    XLSX_OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = XLSX_OUT.with_suffix(".tmp.xlsx")
    readme = [["آرشیو امتیاز نبض بازار"], ["روزهای کامل و تأییدشده", history["valid_day_count"]], ["تعداد نمادها", len(history["symbols"])], ["تعداد ردیف‌های امتیاز", history["row_count"]], ["منبع", "scores_history.db / v2_days + v2_daily_scores"]]
    summary = [["تاریخ", "ارزش معاملات (تومان)", "وضعیت", "منبع تأیید"]] + [[d["day"], d["turnover"], "کامل و تأییدشده", d["source"]] for d in history["valid_days"]]
    scores = [["تاریخ", "نماد", "تعداد نمونه", "میانگین", "میانه", "کمینه", "بیشینه", "آخرین", "کیفیت"]] + [[r.get("day"), r.get("symbol"), r.get("count"), r.get("mean"), r.get("median"), r.get("min"), r.get("max"), r.get("last"), "نیازمند بررسی" if r.get("quality") == "review" else "معتبر"] for r in history["rows"]]
    content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="راهنما" sheetId="1" r:id="rId1"/><sheet name="روزهای معتبر" sheetId="2" r:id="rId2"/><sheet name="امتیاز روزانه" sheetId="3" r:id="rId3"/></sheets></workbook>'
    workbook_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'
    with ZipFile(temp, "w", ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types); z.writestr("_rels/.rels", rels); z.writestr("xl/workbook.xml", workbook); z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/worksheets/sheet1.xml", _sheet_xml(readme)); z.writestr("xl/worksheets/sheet2.xml", _sheet_xml(summary)); z.writestr("xl/worksheets/sheet3.xml", _sheet_xml(scores))
    os.replace(temp, XLSX_OUT)


def main() -> None:
    # Incorporate frontend changes and retry any previously unpushed commit.
    subprocess.run(["git", "-C", str(SITE), "pull", "--rebase", "origin", "main"], check=True, timeout=60)
    subprocess.run(["git", "-C", str(SITE), "push", "origin", "main"], check=True, timeout=60)
    with connect() as conn:
        market = build_market(conn)
        history = build_history(conn)
    old_market = MARKET_OUT.read_bytes() if MARKET_OUT.exists() else b""
    old_history = HISTORY_OUT.read_bytes() if HISTORY_OUT.exists() else b""
    new_market = (json.dumps(market, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    new_history = (json.dumps(history, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    changed = old_market != new_market or old_history != new_history
    if not changed:
        print("NO_CHANGE", market["generated_at"], history["valid_day_count"])
        return
    atomic_json(MARKET_OUT, market)
    atomic_json(HISTORY_OUT, history)
    build_xlsx(history)
    subprocess.run(["git", "-C", str(SITE), "add", "market/data/market.json", "market/history/data/history.json", "market/history/data/market-score-history.xlsx"], check=True)
    staged = subprocess.run(["git", "-C", str(SITE), "diff", "--cached", "--quiet"])
    if staged.returncode == 0:
        print("NO_CHANGE", market["generated_at"], history["valid_day_count"])
        return
    message = f"chore: publish market data {market['generated_at']}"
    subprocess.run(["git", "-C", str(SITE), "commit", "-m", message], check=True)
    subprocess.run(["git", "-C", str(SITE), "push", "origin", "main"], check=True)
    print("PUBLISHED", market["generated_at"], history["valid_day_count"], history["row_count"])


if __name__ == "__main__":
    main()
