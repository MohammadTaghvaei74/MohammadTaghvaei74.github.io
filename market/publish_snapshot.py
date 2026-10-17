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

try:
    from .queue_data import build_queue_rows
except ImportError:
    from queue_data import build_queue_rows
import statistics
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.sax.saxutils import escape

if __package__:
    from .export_signals import export as export_signals
    from .leveraged_snapshots import read_latest as read_leveraged
    from .chart_data import load_daily_chart_rows
    from .export_options import export_from_scores_db
    from .score_candles import build_candles
    from .tsetmc_enrichment import enrich_stocks
else:
    from export_signals import export as export_signals
    from leveraged_snapshots import read_latest as read_leveraged
    from chart_data import load_daily_chart_rows
    from export_options import export_from_scores_db
    from score_candles import build_candles
    from tsetmc_enrichment import enrich_stocks

PUBLISHED_FILES = (
    "market/data/market.json",
    "market/data/signals.json",
    "market/data/options.json",
    "market/history/data/history.json",
    "market/history/data/score-candles.json",
    "market/history/data/market-score-history.xlsx",
)

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
    available = {row[1] for row in conn.execute("PRAGMA table_info(stock_snapshots)")}
    wanted = "symbol,instrument,industry,instrument_type,trading_date,timestamp,yesterday_price,close_price,last_price,last_pct,trade_volume,trade_value_toman,buy_queue_volume,sell_queue_volume,buy_queue_value_toman,sell_queue_value_toman,score".split(",")
    columns = ",".join(column for column in wanted if column in available)
    rows = conn.execute(
        f"SELECT {columns} FROM stock_snapshots WHERE timestamp=? AND valid=1 AND trade_volume>0 ORDER BY score DESC, symbol ASC",
        (latest,),
    ).fetchall()
    stocks, seen = [], set()
    for row in rows:
        if row["symbol"] not in seen:
            stocks.append(dict(row))
            seen.add(row["symbol"])
    top_stocks = stocks[:10]
    # Same ranking basis as Telegram's #صف_خرید_برتر: valid traded stocks
    # with a positive buy queue, ordered by queue value. Missing history stays
    # null; the public UI must never invent a value.
    complete_days = [row[0] for row in conn.execute(
        "SELECT day FROM v2_days WHERE complete=1 AND day < ? ORDER BY day DESC LIMIT 15",
        (latest[:10],),
    )]
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
    # Attach the prior-15-complete-trading-day average to every displayed stock.
    # The current snapshot day is deliberately excluded by the query above.
    for item in stocks:
        item["avg15_trade_value_toman"] = avg_by_symbol.get(item.get("symbol"))
        item["avg15_trade_volume"] = avg_volume_by_symbol.get(item.get("symbol"))
    enrich_stocks(stocks, datetime.fromisoformat(latest))
    queue_rows = build_queue_rows(stocks, datetime.fromisoformat(latest), conn)
    selected_industries = (
        "خودرو", "بانک", "شیمیایی", "استخراج کانه فلزی",
        "شرکتهای چند رشته ای", "فلزات اساسی", "فراورده های نفتی",
        "انبوه سازی، املاک و مستغلات", "سرمایه گذاریها", "محصولات فلزی",
        "بیمه وصندوق بازنشستگی به جزتامین اجتماعی", "محصولات دارویی",
        "سیمان", "محصولات غذایی", "زراعت", "کاشی سرامیک",
        "سایر محصولات کانی غیرفلزی",
    )
    placeholders = ",".join("?" for _ in selected_industries)
    industries = [dict(row) for row in conn.execute(
        "SELECT industry,count,average,median,turnover_toman,net_queue_hmt "
        "FROM industry_detail_snapshots WHERE timestamp=? AND count >= 5 "
        f"AND industry IN ({placeholders}) ORDER BY median DESC LIMIT 6",
        (latest, *selected_industries),
    )]
    daily = load_daily_chart_rows(conn)
    return {
        "schema_version": 1,
        "source": "scores_history.db",
        "generated_at": latest,
        "market": market,
        "groups": groups,
        "top_stocks": top_stocks,
        "top_buy_queue": queue_rows[:10],
        "stocks": [row for row in stocks if row.get("industry")],
        "leveraged": read_leveraged(conn, latest),
        "industries": industries,
        "daily": daily,
        "options": {"status": "connecting", "message": "داده معتبر آپشن بعد از نهایی شدن قرارداد داده اضافه می‌شود."},
    }


def _rows_as_dicts(cursor: sqlite3.Cursor) -> list[dict]:
    """Return query rows as mappings without changing the connection factory."""
    columns = [column[0] for column in cursor.description or ()]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def build_history(conn: sqlite3.Connection) -> dict:
    """Build complete-day history from raw snapshots, never stale v2 rows.

    v2_days is the explicit completeness/finalization fence. For every fenced
    day, scores are recomputed from valid stock_snapshots. This deliberately
    keeps mean, median, min, max, and last distinct: the old exporter copied
    incomplete v2_daily_scores and silently lost days after 2026-10-05.
    """
    days = _rows_as_dicts(conn.execute(
        "SELECT day,turnover,source FROM v2_days WHERE complete=1 ORDER BY day"
    ))
    complete_days = {d["day"] for d in days}
    observed = {}
    for row in _rows_as_dicts(conn.execute(
        """SELECT trading_date, COUNT(*) AS snapshot_count,
                COUNT(DISTINCT timestamp) AS timestamp_count,
                MIN(timestamp) AS first_timestamp, MAX(timestamp) AS last_timestamp,
                SUM(CASE WHEN valid=1 THEN 1 ELSE 0 END) AS valid_snapshot_count
           FROM stock_snapshots GROUP BY trading_date ORDER BY trading_date"""
    )):
        observed[row["trading_date"]] = row

    rows = []
    for day in days:
        day_key = day["day"]
        samples = {}
        # score IS NOT NULL matches the producer's score eligibility. Do not
        # invent a score from another table or mutate the production database.
        for row in _rows_as_dicts(conn.execute(
            """SELECT symbol, score, timestamp FROM stock_snapshots
               WHERE trading_date=? AND valid=1 AND score IS NOT NULL
               ORDER BY symbol, timestamp""",
            (day_key,),
        )):
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
            stats["quality"] = "review" if any(abs(score) > 20 for score in scores) else "valid"
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
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                parts.append(f'<c r="{_col(c)}{r}"><v>{value}</v></c>')
                continue
            text = escape("" if value is None else str(value))
            parts.append(f'<c r="{_col(c)}{r}" t="inlineStr"><is><t>{text}</t></is></c>')
        cells.append(f'<row r="{r}">' + "".join(parts) + "</row>")
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(cells) + "</sheetData></worksheet>"


def write_xlsx(target: Path, history: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.xlsx")
    readme = [["آرشیو امتیاز نبض بازار"], ["روزهای کامل و تأییدشده", history["valid_day_count"]], ["تعداد نمادها", len(history["symbols"])], ["تعداد ردیف‌های امتیاز", history["row_count"]], ["منبع", "scores_history.db / v2_days + v2_daily_scores"]]
    summary = [["تاریخ", "ارزش معاملات (تومان)", "وضعیت", "منبع تأیید"]] + [[d["day"], d["turnover"], "کامل و تأییدشده", d["source"]] for d in history["valid_days"]]
    scores = [["تاریخ", "نماد", "تعداد نمونه", "میانگین", "میانه", "کمینه", "بیشینه", "آخرین", "کیفیت"]] + [[r.get("day"), r.get("symbol"), r.get("count"), r.get("mean"), r.get("median"), r.get("min"), r.get("max"), r.get("last"), "نیازمند بررسی" if r.get("quality") == "review" else "معتبر"] for r in history["rows"]]
    content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="راهنما" sheetId="1" r:id="rId1"/><sheet name="روزهای معتبر" sheetId="2" r:id="rId2"/><sheet name="امتیاز روزانه" sheetId="3" r:id="rId3"/></sheets></workbook>'
    workbook_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>'
    with ZipFile(temp, "w", ZIP_DEFLATED) as z:
        for name, content in (
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_rels),
            ("xl/worksheets/sheet1.xml", _sheet_xml(readme)),
            ("xl/worksheets/sheet2.xml", _sheet_xml(summary)),
            ("xl/worksheets/sheet3.xml", _sheet_xml(scores)),
        ):
            # Explicit metadata avoids ZIP wall-clock timestamps changing bytes.
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, content)
    os.replace(temp, target)


def build_xlsx(history: dict) -> None:
    write_xlsx(XLSX_OUT, history)


class UnsafeWorktreeError(RuntimeError):
    """Raised when publication could overwrite unrelated local work."""


def assert_safe_worktree(status_lines: list[str]) -> None:
    """Allow only generated outputs, never conflicts, deletes, or renames."""
    unrelated = []
    for line in status_lines:
        if len(line) < 3:
            unrelated.append(line)
            continue
        index_status, worktree_status = line[0], line[1]
        path = line[3:].strip().replace("\\", "/")
        # The option history DB is a private runtime cache. It is deliberately
        # not published, but an older/manual run may leave it untracked under
        # the site tree. Ignore only this exact cache; all other unexpected
        # files remain fail-closed.
        safe_path = path in PUBLISHED_FILES
        runtime_cache = path == "market/data/options_history.sqlite"
        unsafe_status = "U" in (index_status, worktree_status) or "D" in (index_status, worktree_status) or index_status == "R" or worktree_status == "R" or " -> " in path
        if (not safe_path and not runtime_cache) or unsafe_status:
            unrelated.append(line)
    if unrelated:
        raise UnsafeWorktreeError(
            "refusing publication with unrelated or unsafe dirty files: " + ", ".join(unrelated)
        )


def _git(site: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(site), *args],
        check=check,
        text=True,
        capture_output=True,
    )


def git_publish(site: Path, paths: list[str]) -> bool:
    """Commit and push only the generated public files.

    ``git diff --cached --quiet`` follows Git's convention: 0 means no staged
    change, 1 means staged changes, and 2+ is an error that must propagate.
    """
    status = _git(site, "status", "--porcelain").stdout.splitlines()
    assert_safe_worktree(status)
    _git(site, "add", "--", *paths)
    staged = _git(site, "diff", "--cached", "--quiet", check=False)
    if staged.returncode == 2:
        raise subprocess.CalledProcessError(staged.returncode, staged.args)
    if staged.returncode == 0:
        _git(site, "pull", "--rebase", "origin", "main")
        _git(site, "push", "origin", "main")
        return False
    _git(site, "commit", "-m", "chore: publish market and signal data")
    _git(site, "pull", "--rebase", "origin", "main")
    _git(site, "push", "origin", "main")
    return True


def main() -> None:
    global DB, SITE, MARKET_OUT, HISTORY_OUT, XLSX_OUT
    DB = Path(os.environ.get("BOURSE_DB", str(DB)))
    event_db = Path(os.environ.get("EVENT_DB", "/root/bourse-alert/event_live.db"))
    SITE = Path(os.environ.get("SITE_REPO", str(SITE)))
    MARKET_OUT = SITE / "market/data/market.json"
    SIGNALS_OUT = SITE / "market/data/signals.json"
    HISTORY_OUT = SITE / "market/history/data/history.json"
    XLSX_OUT = SITE / "market/history/data/market-score-history.xlsx"
    OPTIONS_OUT = SITE / "market/data/options.json"
    with connect() as conn:
        market = build_market(conn)
        history = build_history(conn)
        candles = build_candles(conn)
    signal_payload = export_signals(event_db, SIGNALS_OUT)
    options_payload = export_from_scores_db(DB, OPTIONS_OUT)
    atomic_json(MARKET_OUT, market)
    atomic_json(HISTORY_OUT, history)
    atomic_json(SITE / "market/history/data/score-candles.json", candles)
    build_xlsx(history)
    changed = git_publish(SITE, list(PUBLISHED_FILES))
    print("PUBLISHED" if changed else "NO_CHANGE", market["generated_at"], history["valid_day_count"], history["row_count"], signal_payload["status"], options_payload["status"], options_payload["counts"])


if __name__ == "__main__":
    main()
