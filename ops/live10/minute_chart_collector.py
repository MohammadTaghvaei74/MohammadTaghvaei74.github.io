"""Independent one-minute live market collector.

Provider -> parse -> SQLite live tables + atomic JSON handoff.  No Telegram,
Git, GitHub Pages, archive rebuild, or optional enrichment is in this path.
"""
from __future__ import annotations

import json
from contextlib import closing
from minute_archive_outbox import Outbox
import logging
import os
import sqlite3
import statistics
import sys
import tempfile
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import main
from signal_client_type import enrich_signal_client_type
from live_redis_publisher import publish_snapshot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LIVE_PATH = Path(os.environ.get("BOURSE_LIVE_PATH", "/root/bourse-alert/live_market.json"))


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def load_previous() -> dict:
    try:
        value = json.loads(LIVE_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


CARRY_FORWARD_FIELDS = (
    "industry",
    "buy_per_capita_toman", "sell_per_capita_toman", "buyer_power",
    "legal_buy_pct", "legal_sell_pct", "client_type_date",
    "client_type_fetched_at", "client_type_status",
    "tsetmc_url", "shares_outstanding", "market_cap_toman", "market_cap_hmt",
)
CLIENT_FIELDS = {
    "buy_per_capita_toman", "sell_per_capita_toman", "buyer_power",
    "legal_buy_pct", "legal_sell_pct", "client_type_date",
    "client_type_fetched_at", "client_type_status",
}
CLIENT_REFRESH_SECONDS = 60
CLIENT_BATCH_SIZE = 200


def refresh_client_type_enrichment(rows: list[dict], previous: dict, observed: datetime) -> dict:
    """Refresh public client-type metrics without blocking minute collection.

    The first refresh of a trading day fills the full universe. Subsequent
    refreshes rotate through bounded batches, so provider latency cannot stop
    the one-minute market handoff while every symbol is refreshed repeatedly.
    """
    previous_refresh = previous.get("client_type_refreshed_at") if isinstance(previous, dict) else None
    refresh = True
    if previous_refresh:
        try:
            previous_at = datetime.fromisoformat(str(previous_refresh))
            if previous_at.tzinfo is None:
                previous_at = previous_at.replace(tzinfo=observed.tzinfo)
            refresh = (observed - previous_at).total_seconds() >= CLIENT_REFRESH_SECONDS
        except ValueError:
            refresh = True
    if not refresh:
        return {"refreshed": False, "ok": 0, "missing": 0, "batch_size": 0}

    eligible = [row for row in rows if str(row.get("instrument") or "").strip()]
    if not eligible:
        return {"refreshed": True, "ok": 0, "missing": 0, "batch_size": 0}

    today = observed.date().isoformat()
    previous_rows = previous.get("stocks") if isinstance(previous, dict) else []
    previous_by_key = {}
    for old in previous_rows if isinstance(previous_rows, list) else []:
        if isinstance(old, dict):
            for key in ("symbol", "instrument"):
                value = old.get(key)
                if value not in (None, ""):
                    previous_by_key[(key, str(value))] = old
    has_same_day_metrics = any(
        (previous_by_key.get(("instrument", str(row.get("instrument")))) or {}).get("client_type_date") == today
        and (previous_by_key.get(("instrument", str(row.get("instrument")))) or {}).get("buyer_power") is not None
        for row in eligible
    )
    if not has_same_day_metrics:
        batch = eligible
        next_cursor = 0
    else:
        cursor = int(previous.get("client_type_cursor") or 0) % len(eligible)
        batch = [eligible[(cursor + i) % len(eligible)] for i in range(min(CLIENT_BATCH_SIZE, len(eligible)))]
        next_cursor = (cursor + len(batch)) % len(eligible)

    enrich_signal_client_type(batch, observed)
    ok = sum(row.get("client_type_status") in ("ok", "ok_stale") for row in batch)
    return {
        "refreshed": True,
        "ok": ok,
        "missing": len(batch) - ok,
        "batch_size": len(batch),
        "next_cursor": next_cursor,
    }


def carry_forward_enrichment(rows: list[dict], previous: dict, observed: datetime) -> None:
    previous_rows = previous.get("stocks") if isinstance(previous, dict) else []
    if not isinstance(previous_rows, list):
        return
    by_key = {}
    for old in previous_rows:
        if not isinstance(old, dict):
            continue
        for key in ("symbol", "instrument"):
            value = old.get(key)
            if value not in (None, ""):
                by_key.setdefault((key, str(value)), old)
    today = observed.date().isoformat()
    for row in rows:
        old = None
        for key in ("symbol", "instrument"):
            value = row.get(key)
            if value not in (None, "") and (key, str(value)) in by_key:
                old = by_key[(key, str(value))]
                break
        if old is None:
            continue
        for field in CARRY_FORWARD_FIELDS:
            if row.get(field) is not None or old.get(field) is None:
                continue
            if field in CLIENT_FIELDS and old.get("client_type_date") != today:
                continue
            row[field] = old[field]


def build_handoff(rows: list[dict], observed: datetime) -> dict:
    # Every row here is from this fetch, including excluded special instruments.
    for row in rows:
        row["timestamp"] = observed.isoformat()
        row["trading_date"] = observed.date().isoformat()
    eligible = [
        row for row in rows
        if row.get("eligible_market_stock") and float(row.get("trade_volume", 0) or 0) > 0
    ]
    count, average, median, buy_hmt, sell_hmt = main.market_summary_values(rows)
    leaders = [row for row in eligible if row.get("symbol") in main.LEADERS]
    # Capture special instruments before the ordinary-stock filter.
    leveraged = sorted(
        [row for row in rows
         if row.get("symbol") in main.LEVERAGED_FUNDS
         and float(row.get("trade_volume", 0) or 0) > 0
         and row.get("score") is not None],
        key=lambda r: (-float(r.get("score", 0) or 0), str(r.get("symbol") or "")),
    )
    leader_average, leader_median = main.market_group_average_median(leaders)
    stocks = sorted(eligible, key=lambda r: (-float(r.get("score", 0) or 0), str(r.get("symbol") or "")))
    for position, row in enumerate(stocks, 1):
        row["timestamp"] = observed.isoformat()
        row["trading_date"] = observed.date().isoformat()
        row["score_rank"] = position
        row["score_rank_total"] = len(stocks)
        row["score_position_pct"] = round(position / len(stocks) * 100) if stocks else None
    queue = sorted(stocks, key=lambda r: -float(r.get("buy_queue_value_toman", 0) or 0))
    groups = []
    for name, members in (("کل بازار", eligible), ("لیدرها", leaders), ("اهرمی‌ها", leveraged)):
        scores = [float(row.get("score", 0) or 0) for row in members]
        groups.append({
            "group_name": name,
            "timestamp": observed.isoformat(),
            "count": len(scores),
            "average": statistics.mean(scores) if scores else 0,
            "median": statistics.median(scores) if scores else 0,
        })
    industries: dict[str, list[dict]] = defaultdict(list)
    for row in eligible:
        name = str(row.get("industry") or "").strip()
        if name:
            industries[name].append(row)
    industry_rows = []
    for name, members in industries.items():
        scores = [float(row.get("score", 0) or 0) for row in members]
        industry_rows.append({
            "industry": name,
            "count": len(members),
            "average": statistics.mean(scores),
            "median": statistics.median(scores),
            "turnover_toman": sum(float(row.get("trade_value_toman", 0) or 0) for row in members),
        })
    industry_rows.sort(key=lambda item: (-item["median"], item["industry"]))
    point = {
        "timestamp": observed.isoformat(),
        "time": observed.strftime("%H:%M"),
        "leader_median_score": leader_median,
        "rest_median_score": median,
        "median_score": median,
        "leader_score_count": len(leaders),
        "rest_score_count": max(0, len(eligible) - len(leaders)),
        "market_score_count": len(eligible),
    }
    previous = load_previous()
    enrichment = refresh_client_type_enrichment(stocks, previous, observed)
    carry_forward_enrichment(stocks, previous, observed)
    intraday = [
        item for item in previous.get("intraday", [])
        if str(item.get("timestamp", ""))[:10] == observed.date().isoformat()
    ]
    # Keep one actual observation per minute, never a 240 raw-event ring.
    # Duplicate collector processes historically evicted the opening hour.
    by_minute = {item["timestamp"][:16]: item for item in intraday}
    by_minute[point["timestamp"][:16]] = point
    intraday = [by_minute[key] for key in sorted(by_minute)]
    payload = {
        "schema_version": 2,
        "source": "tsetmc-live-collector",
        "generated_at": observed.isoformat(),
        "collector_observed_at": observed.isoformat(),
        "market": {
            "timestamp": observed.isoformat(),
            "count": count,
            "average": average,
            "median": median,
            "buy_value_hmt": buy_hmt,
            "sell_value_hmt": sell_hmt,
            "leader_average": leader_average,
            "leader_median": leader_median,
        },
        "stocks": stocks,
        "top_stocks": stocks[:10],
        "top_buy_queue": queue[:10],
        "groups": groups,
        "industries": industry_rows,
        "industry_table": previous.get("industry_table", {}),
        "leveraged": leveraged,
        "daily": previous.get("daily", []),
        "intraday": intraday[-240:],
        "queue_intraday": previous.get("queue_intraday", []),
        "comprehensive_stocks": stocks,
        "comprehensive_meta": {
            "source": "tsetmc-live-collector",
            "snapshot_id": observed.isoformat(),
            "expected_rows": len(stocks),
            "client_type_refresh": enrichment,
        },
        "client_type_refreshed_at": (
            observed.isoformat() if enrichment["refreshed"]
            else previous.get("client_type_refreshed_at")
        ),
        "client_type_cursor": enrichment.get("next_cursor", previous.get("client_type_cursor", 0)),
    }
    return payload


def archive_live(rows, observed: datetime) -> int:
    eligible = [
        row for row in rows
        if row.get("eligible_market_stock") and float(row.get("trade_volume", 0) or 0) > 0
    ]
    timestamp = observed.isoformat()
    trading_date = observed.date().isoformat()
    stock_rows = [
        (
            timestamp, trading_date, row.get("symbol"), row.get("instrument"),
            row.get("industry"), main.instrument_type_label(row.get("instrument_type")),
            row.get("yesterday_price"), row.get("close_price"), row.get("last_price"),
            row.get("last_pct"), row.get("trade_volume"), row.get("trade_value_toman"),
            row.get("buy_queue_volume", 0), row.get("sell_queue_volume", 0),
            row.get("buy_queue_value_toman", 0), row.get("sell_queue_value_toman", 0),
            row.get("score"), 1,
        )
        for row in eligible
    ]
    count, average, median, buy_hmt, sell_hmt = main.market_summary_values(rows)
    leaders = [row for row in eligible if row.get("symbol") in main.LEADERS]
    leader_average, leader_median = main.market_group_average_median(leaders)
    with closing(sqlite3.connect(main.DB_PATH, timeout=2)) as conn, conn:
        conn.execute("PRAGMA busy_timeout=2000")
        conn.executemany(
            "INSERT OR REPLACE INTO stock_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            stock_rows,
        )
        conn.execute(
            "INSERT OR REPLACE INTO market_snapshots VALUES (?,?,?,?,?,?,?,?)",
            (timestamp, count, average, median, buy_hmt, sell_hmt, leader_average, leader_median),
        )
        groups = {"کل بازار": eligible, "لیدرها": leaders}
        for name, members in groups.items():
            scores = [float(row.get("score", 0) or 0) for row in members]
            turnover = sum(float(row.get("trade_value_toman", 0) or 0) for row in members)
            buy = sum(float(row.get("buy_queue_value_toman", 0) or 0) for row in members) / 1e12
            sell = sum(float(row.get("sell_queue_value_toman", 0) or 0) for row in members) / 1e12
            conn.execute(
                "INSERT OR REPLACE INTO group_snapshots VALUES (?,?,?,?,?,?,?,?,?)",
                (timestamp, name, len(scores), statistics.mean(scores) if scores else 0,
                 statistics.median(scores) if scores else 0, turnover, buy, sell, buy - sell),
            )
        industries: dict[str, list[dict]] = defaultdict(list)
        for row in eligible:
            if row.get("industry"):
                industries[row["industry"]].append(row)
        for name, members in industries.items():
            scores = [float(row.get("score", 0) or 0) for row in members]
            turnover = sum(float(row.get("trade_value_toman", 0) or 0) for row in members)
            buy = sum(float(row.get("buy_queue_value_toman", 0) or 0) for row in members) / 1e12
            sell = sum(float(row.get("sell_queue_value_toman", 0) or 0) for row in members) / 1e12
            conn.execute(
                "INSERT OR REPLACE INTO industry_detail_snapshots VALUES (?,?,?,?,?,?,?,?,?)",
                (timestamp, name, len(scores), statistics.mean(scores) if scores else 0,
                 statistics.median(scores) if scores else 0, turnover, buy, sell, buy - sell),
            )
    return len(eligible)


archive_outbox = None


def restore_cached_industries(rows):
    try:
        cache = json.loads(LIVE_PATH.with_name('industry_cache.json').read_text(encoding='utf-8'))
        if not isinstance(cache, dict):
            return
        for row in rows:
            if not row.get('industry'):
                industry = cache.get(str(row.get('instrument')))
                if industry:
                    row['industry'] = industry
    except (OSError, ValueError):
        logging.warning('INDUSTRY_CACHE_UNAVAILABLE; existing metadata retained')


def persist_live(rows, observed: datetime) -> int:
    # Carry cached metadata only; no provider/enrichment I/O before durability.
    carry_forward_enrichment(rows, load_previous(), observed)
    restore_cached_industries(rows)
    archive_outbox.enqueue(rows, observed)
    # Archive retry runs independently; JSON/enrichment never holds its lock.
    handoff = build_handoff(rows, observed)
    # Isolated bounded history is persisted before archival DB work can block.
    try:
        from median_history import connect as history_connect, ingest as history_ingest
        with history_connect("/root/bourse-alert/median_history.sqlite") as history_db:
            history_ingest(history_db, [handoff["intraday"][-1]], observed, "collector-direct-v1")
    except Exception:
        logging.exception("MEDIAN_HISTORY_WRITE_FAILED; live handoff retained")
    atomic_json(LIVE_PATH, handoff)
    if publish_snapshot(handoff):
        logging.info("REDIS_LIVE_PUBLISHED timestamp=%s symbols=%d", handoff.get("collector_observed_at"), len(handoff.get("stocks", [])))
    else:
        logging.warning("REDIS_LIVE_PUBLISH_FAILED timestamp=%s; JSON handoff retained", handoff.get("collector_observed_at"))
    refresh = handoff.get("comprehensive_meta", {}).get("client_type_refresh", {})
    logging.info(
        "CLIENT_TYPE_REFRESH refreshed=%s batch=%s ok=%s missing=%s",
        refresh.get("refreshed"), refresh.get("batch_size", 0),
        refresh.get("ok", 0), refresh.get("missing", 0),
    )
    return len(handoff["stocks"])


def collect_once() -> None:
    raw, depth = main.fetch_market_data()
    rows = main.parse_market_data(raw, depth)
    if not rows:
        raise RuntimeError("Empty provider response; no live snapshot saved")
    observed = datetime.now(main.TEHRAN)
    if not main.is_market_open(observed):
        return
    count = persist_live(rows, observed)
    logging.info("LIVE_SNAPSHOT_SAVED observed=%s symbols=%d eligible=%d", observed.isoformat(), len(rows), count)


def scheduled_delay(started, finished):
    # If work crossed the next boundary, fetch now rather than skip that minute.
    return max(0.0, (started // 60 + 1) * 60 - finished)


if __name__ == "__main__":
    archive_outbox = Outbox(str(LIVE_PATH.with_name("minute_archive_pending.sqlite")), archive_live)
    archive_outbox.start()
    if "--once" in sys.argv:
        collect_once()
        while archive_outbox.pending():
            time.sleep(1)
    else:
        while True:
            started = time.time()
            try:
                if main.is_market_open():
                    collect_once()
            except Exception:
                logging.exception("Live minute collection failed; previous snapshot retained")
            time.sleep(scheduled_delay(started, time.time()))
