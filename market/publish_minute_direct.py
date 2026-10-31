#!/usr/bin/env python3
"""Publish the validated minute handoff directly to the VPS origin.

This path intentionally has no Git, GitHub Pages, Telegram, SQLite archive
queries, or optional enrichment dependency.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import requests
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import sys

sys.path.insert(0, "/root/bourse-alert")
from fund_bubble_history import record_and_attach

from bourse_site_enrichment import enrich_market_cap

sys.path.insert(0, "/root/bourse-site")
from market.export_signals import export as export_signals

SITE = Path(os.environ.get("SITE_OUT", "/srv/sorena"))
INPUT = Path(os.environ.get("BOURSE_LIVE_PATH", "/root/bourse-alert/live_market.json"))
TEHRAN = ZoneInfo("Asia/Tehran")
MAX_SOURCE_AGE = int(os.environ.get("LIVE_MAX_SOURCE_AGE", "90"))
DB_PATH = Path(os.environ.get("BOURSE_DB", "/root/bourse-alert/scores_history.db"))


def build_public_comprehensive_rows(stocks: list[dict], generated: str):
    site_market = "/root/bourse-site/market"
    if site_market not in sys.path:
        sys.path.insert(0, site_market)
    from comprehensive_table import build_comprehensive_rows
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        industry_by_symbol = {}
        for row in conn.execute(
            "SELECT symbol,MAX(industry) AS industry FROM stock_snapshots "
            "WHERE valid=1 AND industry IS NOT NULL AND trim(industry)<>'' "
            "GROUP BY symbol"
        ):
            industry_by_symbol.setdefault(row[0], row[1])
        for item in stocks:
            if not item.get("industry"):
                item["industry"] = industry_by_symbol.get(item.get("symbol"))
        return build_comprehensive_rows(stocks, generated, conn)


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(tmp, path)
        os.chmod(path, 0o644)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_object(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON root is not an object")
        return value
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeError(f"invalid JSON at {path}: {exc}") from exc


def _number(value):
    return isinstance(value, (int, float)) and value == value


CLIENT_METRIC_FIELDS = (
    "buy_per_capita_toman",
    "buyer_power",
    "legal_buy_pct",
    "legal_sell_pct",
)


def merge_client_metrics(stocks: list[dict], fallback_rows: object) -> dict[str, int]:
    """Recover validated client metrics before the public write boundary."""
    if not isinstance(fallback_rows, list):
        return {field: 0 for field in CLIENT_METRIC_FIELDS}
    index = {}
    for row in fallback_rows:
        if not isinstance(row, dict):
            continue
        for key in ("instrument", "symbol"):
            value = row.get(key)
            if value not in (None, ""):
                index[(key, str(value))] = row
    recovered = {field: 0 for field in CLIENT_METRIC_FIELDS}
    for stock in stocks:
        source = None
        for key in ("instrument", "symbol"):
            value = stock.get(key)
            if value not in (None, ""):
                source = index.get((key, str(value)))
                if source:
                    break
        if not source:
            continue
        for field in CLIENT_METRIC_FIELDS:
            if stock.get(field) is None and _number(source.get(field)):
                stock[field] = source[field]
                recovered[field] += 1
    return recovered


def validate_client_metrics(rows: object, label: str) -> dict[str, int]:
    """Fail closed if a non-empty live source becomes an empty public feed."""
    if not isinstance(rows, list) or len(rows) < 100:
        raise RuntimeError(f"{label} client-metric row count invalid")
    counts = {field: sum(_number(row.get(field)) for row in rows if isinstance(row, dict)) for field in CLIENT_METRIC_FIELDS}
    minimum = max(1, int(len(rows) * 0.50))
    missing = [field for field, count in counts.items() if count < minimum]
    if missing:
        raise RuntimeError(f"{label} client metrics incomplete: counts={counts} minimum={minimum}")
    return counts


def refresh_fund_report(root: Path) -> dict:
    """Refresh fund scores from the latest raw TSETMC snapshot.

    The minute-origin publisher previously copied the old fund report forever.
    This keeps the Codal portfolio scores, merges the latest complete report,
    refreshes board scores from raw TSETMC, and never publishes rows with a
    missing score.
    """
    target = root / "market/data/funds.json"
    existing = read_object(target) if target.exists() else {"rows": []}
    public_path = Path("/root/bourse-alert/fund_report_public.json")
    public = read_object(public_path) if public_path.exists() else existing
    final_path = Path("/root/bourse-alert/final_fund_report.json")
    final = read_object(final_path) if final_path.exists() else {}
    by_symbol = {r.get("symbol"): dict(r) for r in public.get("rows", []) if r.get("symbol")}
    for row in final.get("ranked_all", []):
        symbol = row.get("symbol")
        if symbol:
            by_symbol.setdefault(symbol, {}).update(row)
    rows = list(by_symbol.values())

    try:
        import gzip, glob, sys
        sys.path.insert(0, "/root/bourse-alert")
        import main as alert_main
        stock_files = sorted(glob.glob("/root/bourse-alert/raw_tse/*_stocks.json.gz"))
        depth_files = sorted(glob.glob("/root/bourse-alert/raw_tse/*_depth.json.gz"))
        if stock_files and depth_files:
            stamp = Path(stock_files[-1]).name.split("_stocks.json.gz")[0]
            depth_path = f"/root/bourse-alert/raw_tse/{stamp}_depth.json.gz"
            if Path(depth_path).exists():
                with gzip.open(stock_files[-1], "rt", encoding="utf-8") as handle:
                    raw_stocks = json.load(handle)
                with gzip.open(depth_path, "rt", encoding="utf-8") as handle:
                    raw_depth = json.load(handle)
                live = alert_main.parse_market_data(raw_stocks, raw_depth)
                live_scores = {r.get("symbol"): r.get("score") for r in live if r.get("symbol") and _number(r.get("score"))}
                for row in rows:
                    if row.get("symbol") in live_scores:
                        row["board_score"] = float(live_scores[row["symbol"]])
                print(f"FUND_BOARD_REFRESH source={stamp} matched={sum(1 for r in rows if r.get('symbol') in live_scores)}", flush=True)
    except Exception as exc:
        print(f"FUND_BOARD_REFRESH_UNAVAILABLE {exc}", flush=True)

    # The board score is the market snapshot score captured above.  It is not
    # the price-change percentage: that is a separate bubble metric.  Keep the
    # snapshot value intact so the fund table agrees with the 12:30 market
    # snapshot and the leveraged-funds table.
    enriched = 0
    for row in rows:
        try:
            etf = requests.get(f"https://cdn.tsetmc.com/api/Fund/GetETFByInsCode/{row['instrument']}", timeout=20).json()["etf"]
            closing = requests.get(f"https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDaily/{row['instrument']}/{etf['deven']}", timeout=20).json()["closingPriceDaily"]
            nav = float(etf.get("pRedTran") or 0)
            last = float(closing.get("pDrCotVal") or 0)
            yesterday = float(closing.get("priceYesterday") or 0)
            row["bubble_pct"] = round((last-nav)/nav*100, 2) if nav else None
            row["nav_redemption"] = nav if nav else None
            row["last_price"] = last if last else None
            row["price_yesterday"] = yesterday if yesterday else None
            enriched += 1
        except Exception as exc:
            print(f"FUND_TSE_ENRICH_UNAVAILABLE symbol={row.get('symbol')} error={exc}", flush=True)
    print(f"FUND_TSE_ENRICH matched={enriched}", flush=True)
    record_and_attach(rows, datetime.now(TEHRAN))

    rows = [r for r in rows if _number(r.get("portfolio_score")) and _number(r.get("board_score"))]
    for row in rows:
        row["score_diff"] = float(row["portfolio_score"]) - float(row["board_score"])
    rows.sort(key=lambda row: row.get("score_diff", -999), reverse=True)
    payload = dict(existing)
    payload.update({
        "schema_version": 2,
        "generated_at": datetime.now(TEHRAN).isoformat(),
        "rows": rows,
        "row_count": len(rows),
        "eligible_count": len(rows),
        "coverage_is_filter": False,
    })
    atomic_json(target, payload)
    # Keep the producer handoff and repository data feed aligned with the
    # minute-origin feed; otherwise the next report run can resurrect stale
    # unscored rows.
    atomic_json(public_path, payload)
    repo_target = Path("/root/bourse-site/market/data/funds.json")
    if repo_target.parent.exists():
        atomic_json(repo_target, payload)
    print(f"FUND_REPORT_PUBLISHED rows={len(rows)} complete={sum(_number(r.get('portfolio_score')) and _number(r.get('board_score')) for r in rows)}", flush=True)
    return payload


def parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.astimezone(TEHRAN) if parsed.tzinfo else parsed.replace(tzinfo=TEHRAN)


def in_window(now: datetime) -> bool:
    if os.environ.get("FORCE_LIVE_PUBLISH") == "1":
        return True
    return now.weekday() in (0, 1, 2, 5, 6) and now.replace(hour=8, minute=45, second=0, microsecond=0) <= now < now.replace(hour=12, minute=31, second=0, microsecond=0)


def main() -> int:
    now = datetime.now(TEHRAN)
    if not in_window(now):
        print("SKIP_OUTSIDE_MARKET_WINDOW", flush=True)
        return 0
    payload = read_object(INPUT)
    generated = str(payload.get("generated_at") or "")
    observed = parse_time(generated)
    age = (now - observed).total_seconds()
    stocks = payload.get("stocks")
    if age < -10 or age > MAX_SOURCE_AGE:
        raise RuntimeError(f"live handoff stale: age={age:.1f}s generated_at={generated}")
    if not isinstance(stocks, list) or len(stocks) < 100:
        raise RuntimeError(f"live handoff row count invalid: {len(stocks) if isinstance(stocks, list) else 'not-list'}")
    recovered_metrics = merge_client_metrics(stocks, payload.get("comprehensive_stocks"))
    source_metric_counts = validate_client_metrics(stocks, "live source")
    print(f"CLIENT_METRICS source={source_metric_counts} recovered={recovered_metrics}", flush=True)
    old = read_object(SITE / "market/data/market.json") if (SITE / "market/data/market.json").exists() else {}
    if old.get("generated_at") == generated:
        print(f"NO_NEW_SOURCE {generated}", flush=True)
        return 0
    market = dict(payload)
    market.pop("comprehensive_stocks", None)
    market.pop("comprehensive_meta", None)
    # The minute handoff omits the historical queue series used by the
    # dashboard chart. Rebuild it from the same read-only scores database at
    # the publication boundary, so the live origin cannot publish a valid
    # snapshot with an empty queue_intraday array.
    from market.chart_data import load_intraday_queue_rows, load_intraday_queue_count_rows
    with sqlite3.connect(DB_PATH) as chart_conn:
        queue_day = observed.date().isoformat()
        queue_rows = load_intraday_queue_rows(chart_conn, queue_day, "09:15")
        queue_count_rows = load_intraday_queue_count_rows(chart_conn, queue_day, "09:15")
        source_queue_count = chart_conn.execute(
            "SELECT COUNT(*) FROM market_snapshots WHERE substr(timestamp,1,10)=? AND substr(timestamp,12,5)>=?",
            (queue_day, "09:15"),
        ).fetchone()[0]
    # Fail closed: never replace a valid chart with an empty array when the
    # source database proves that today's queue snapshots exist.
    if source_queue_count > 0 and not queue_rows:
        raise RuntimeError(
            f"refusing empty queue_intraday publication: source_rows={source_queue_count} day={queue_day}"
        )
    if queue_rows:
        market["queue_intraday"] = queue_rows
    else:
        previous_queue = old.get("queue_intraday")
        same_day = (
            isinstance(previous_queue, list)
            and previous_queue
            and str(previous_queue[0].get("timestamp", ""))[:10] == observed.date().isoformat()
        )
        market["queue_intraday"] = previous_queue if same_day else []
    if queue_count_rows:
        market["queue_count_intraday"] = queue_count_rows
    else:
        previous_count = old.get("queue_count_intraday")
        market["queue_count_intraday"] = previous_count if isinstance(previous_count, list) else []
    market["published_at"] = now.isoformat()
    market["publisher"] = "vps-direct-origin"
    market["source_age_seconds"] = round(age, 3)
    # Fund-report enrichment is optional and must not block minute publishing.
    market["fund_report"] = old.get("fund_report", {})

    for key in ("options", "portfolio_special"):
        if key in old:
            market[key] = old[key]
    # The direct collector keeps the industry-enriched universe in
    # comprehensive_stocks while the lightweight stocks list omits it.
    # Merge the validated industry mapping before publishing; otherwise the
    # industries page receives a valid-looking snapshot with zero groups.
    comprehensive_rows = payload.get("comprehensive_stocks")
    by_key = {}
    if isinstance(comprehensive_rows, list):
        for row in comprehensive_rows:
            if not isinstance(row, dict):
                continue
            for key in ("symbol", "instrument"):
                value = row.get(key)
                if value not in (None, ""):
                    by_key[(key, str(value))] = row
    # If the minute handoff has no industry labels, carry forward the last
    # validated symbol mapping instead of replacing a healthy table with {}.
    for row in old.get("stocks", []):
        if isinstance(row, dict) and row.get("industry"):
            for key in ("symbol", "instrument"):
                value = row.get(key)
                if value not in (None, ""):
                    existing = by_key.get((key, str(value)))
                    if not existing or not existing.get("industry"):
                        by_key[(key, str(value))] = row
    mapped = 0
    for item in stocks:
        source = None
        for key in ("symbol", "instrument"):
            value = item.get(key)
            if value not in (None, "") and (key, str(value)) in by_key:
                source = by_key[(key, str(value))]
                break
        if source and not item.get("industry") and source.get("industry"):
            item["industry"] = source["industry"]
            mapped += 1
    mapped_industries = sum(1 for row in stocks if row.get("industry"))
    previous_industries = sum(1 for row in old.get("stocks", []) if isinstance(row, dict) and row.get("industry"))
    if previous_industries and not mapped_industries:
        print("INDUSTRY_MAPPING_SOURCE_EMPTY; DB mapping will be applied during comprehensive build", flush=True)
    if not any(isinstance(row, dict) and row.get("industry") for row in (comprehensive_rows or [])) and old.get("industry_table"):
        market["industry_table"] = old["industry_table"]
    print(f"INDUSTRY_MAPPING mapped={mapped} output={mapped_industries} previous={previous_industries}", flush=True)
    # Rebuild the comprehensive contract from the current rows and verified
    # history. This is local SQLite work and avoids the old raw-payload path,
    # which dropped all score_10d_* and turnover fields.
    comprehensive_rows, comprehensive_meta = build_public_comprehensive_rows(stocks, generated)
    computed_by_symbol = {str(row.get("symbol")): row for row in comprehensive_rows}
    for item in stocks:
        computed = computed_by_symbol.get(str(item.get("symbol")))
        if computed:
            item.update({key: value for key, value in computed.items() if key not in {"symbol", "instrument"}})
    market["stocks"] = stocks
    # Rebuild daily baselines from final symbol/day observations, never from
    # intraday cumulative snapshots or a previous snapshot's industry table.
    from market.industry_table import build_industry_table
    with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True) as industry_conn:
        market["industry_table"] = build_industry_table(stocks, generated, industry_conn)
    comprehensive = {
        "schema_version": 2,
        "source": "tsetmc-live-collector",
        "generated_at": generated,
        "published_at": now.isoformat(),
        "rows": comprehensive_rows,
        "meta": comprehensive_meta,
    }
    public_market_counts = validate_client_metrics(stocks, "public market")
    public_table_counts = validate_client_metrics(comprehensive_rows, "public comprehensive")
    print(f"CLIENT_METRICS public_market={public_market_counts} public_comprehensive={public_table_counts}", flush=True)
    root = SITE / "market/data"
    atomic_json(root / "market.json", market)
    atomic_json(root / "comprehensive.json", comprehensive)
    atomic_json(root / "health.json", {
        "schema_version": 1,
        "status": "ok",
        "source_timestamp": generated,
        "published_at": now.isoformat(),
        "source_age_seconds": round(age, 3),
        "row_count": len(stocks),
        "origin": "vps-direct-origin",
    })
    # Signal export is a separate workload; retain its last valid file here.
    signal_path = root / "signals.json"
    signal_payload = read_object(signal_path) if signal_path.exists() else {"status": "stale", "count": 0}
    print(f"SIGNALS_PUBLISHED status={signal_payload.get('status')} count={signal_payload.get('count')}", flush=True)
    print(f"LIVE_PUBLISHED {generated} stocks={len(stocks)} source_age={age:.1f}s root={SITE}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
