"""Incremental, durable daily score medians. No imputation or universe changes."""
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
from statistics import median
import math
import sqlite3

TEHRAN = ZoneInfo("Asia/Tehran")
EXPECTED_MINUTES = 211  # inclusive 09:00 .. 12:30 minute buckets


def finite(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return value if math.isfinite(value) else None


def schema(conn):
    conn.execute(
        "CREATE TABLE IF NOT EXISTS score_daily_cursor(" \
        "source TEXT, day TEXT, last_id INTEGER, PRIMARY KEY(source,day))"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS score_daily_minutes(" \
        "day TEXT, symbol TEXT, minute TEXT, score REAL, observed TEXT, " \
        "source TEXT, source_id INTEGER, PRIMARY KEY(day,symbol,minute))"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS score_daily_medians(" \
        "day TEXT, symbol TEXT, median REAL, minute_count INTEGER, " \
        "first_minute TEXT, last_minute TEXT, PRIMARY KEY(day,symbol))"
    )


def _tables(conn):
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _minute_info(timestamp, day):
    try:
        dt = datetime.fromisoformat(str(timestamp))
        dt = dt.replace(tzinfo=TEHRAN) if dt.tzinfo is None else dt.astimezone(TEHRAN)
    except (ValueError, TypeError):
        return None
    minute = dt.strftime("%H:%M")
    if dt.date().isoformat() != day or not "09:00" <= minute <= "12:30":
        return None
    return minute, dt.isoformat(timespec="microseconds")


def _source_rows(conn, source, day, last_id=0, high_id=None):
    """Yield normalized observations from one producer schema."""
    high_clause = "" if high_id is None else " AND rowid<=?"
    if source == "stock_snapshots":
        query = (
            "SELECT rowid,symbol,timestamp,score FROM stock_snapshots "
            "WHERE trading_date=? AND rowid>?" + high_clause +
            " AND valid=1 AND score IS NOT NULL"
        )
        params = [day, last_id] + ([] if high_id is None else [high_id])
        for rid, symbol, timestamp, score in conn.execute(query, params):
            info = _minute_info(timestamp, day)
            value = finite(score)
            if info and value is not None:
                yield rid, str(symbol), info[0], info[1], value
        return

    if source == "score_observations":
        query = (
            "SELECT rowid,symbol,observed,observed_minute,score,"
            "eligible_market_stock FROM score_observations "
            "WHERE substr(observed_minute,1,10)=? AND rowid>?" + high_clause +
            " AND score IS NOT NULL AND eligible_market_stock=1"
        )
        params = [day, last_id] + ([] if high_id is None else [high_id])
        for rid, symbol, observed, observed_minute, score, _eligible in conn.execute(query, params):
            info = _minute_info(observed_minute, day)
            value = finite(score)
            if info and value is not None:
                # observed is the freshness/provenance timestamp; the minute
                # remains the source bucket used by the daily median contract.
                observed_stamp = str(observed or info[1])
                yield rid, str(symbol), info[0], observed_stamp, value


def _choose_observation(current, candidate):
    if current is None:
        return candidate
    current_key = (current[1], current[2], current[3])
    candidate_key = (candidate[1], candidate[2], candidate[3])
    return candidate if candidate_key > current_key else current


def _build_output(minutes, days):
    out = defaultdict(list)
    for day in sorted(days):
        by_symbol = defaultdict(list)
        for (row_day, symbol, minute), item in minutes.items():
            if row_day == day:
                by_symbol[symbol].append((minute, item[0]))
        for symbol, values in by_symbol.items():
            values.sort(key=lambda value: value[0])
            out[symbol].append({
                "day": day,
                "score": median([value[1] for value in values]),
                "minute_count": len(values),
                "expected_minutes": EXPECTED_MINUTES,
                "missing_minutes": EXPECTED_MINUTES - len(values),
                "first_minute": values[0][0],
                "last_minute": values[-1][0],
                "partial": len(values) < EXPECTED_MINUTES,
            })
    return dict(out)


def _load_read_only(conn, days):
    """Aggregate source rows without creating or updating cache tables."""
    minutes = {}
    tables = _tables(conn)
    for source in ("stock_snapshots", "score_observations"):
        if source not in tables:
            continue
        for day in days:
            for rid, symbol, minute, observed, score in _source_rows(conn, source, day):
                candidate = (score, observed, source, rid)
                key = (day, symbol, minute)
                minutes[key] = _choose_observation(minutes.get(key), candidate)
    return _build_output(minutes, days)


def load_daily(conn, days):
    try:
        schema(conn)
    except sqlite3.OperationalError as exc:
        if "readonly" not in str(exc).lower() and "read-only" not in str(exc).lower():
            raise
        return _load_read_only(conn, days)

    tables = _tables(conn)
    dirty = set()
    for source in ("stock_snapshots", "score_observations"):
        if source not in tables:
            continue
        high = conn.execute("SELECT max(rowid) FROM " + source).fetchone()[0] or 0
        for day in days:
            last_row = conn.execute(
                "SELECT last_id FROM score_daily_cursor WHERE source=? AND day=?",
                (source, day),
            ).fetchone()
            last = last_row[0] if last_row else 0
            if high <= last:
                continue
            for rid, symbol, minute, observed, score in _source_rows(conn, source, day, last, high):
                conn.execute(
                    """INSERT INTO score_daily_minutes
                       VALUES(?,?,?,?,?,?,?)
                       ON CONFLICT(day,symbol,minute) DO UPDATE SET
                         score=excluded.score, observed=excluded.observed,
                         source=excluded.source, source_id=excluded.source_id
                       WHERE excluded.observed>score_daily_minutes.observed OR
                         (excluded.observed=score_daily_minutes.observed AND
                          (excluded.source>score_daily_minutes.source OR
                           (excluded.source=score_daily_minutes.source AND
                            excluded.source_id>score_daily_minutes.source_id)))""",
                    (day, symbol, minute, score, observed, source, rid),
                )
                dirty.add((day, symbol))
            conn.execute(
                "INSERT OR REPLACE INTO score_daily_cursor VALUES(?,?,?)",
                (source, day, high),
            )

    for day, symbol in dirty:
        values = list(conn.execute(
            "SELECT minute,score FROM score_daily_minutes "
            "WHERE day=? AND symbol=? ORDER BY minute",
            (day, symbol),
        ))
        conn.execute(
            "INSERT OR REPLACE INTO score_daily_medians "
            "VALUES(?,?,?,?,?,?)",
            (day, symbol, median([value[1] for value in values]), len(values), values[0][0], values[-1][0]),
        )
    conn.commit()

    out = defaultdict(list)
    for day in sorted(days):
        for symbol, score, count, first, last in conn.execute(
            "SELECT symbol,median,minute_count,first_minute,last_minute "
            "FROM score_daily_medians WHERE day=?",
            (day,),
        ):
            out[symbol].append({
                "day": day,
                "score": score,
                "minute_count": count,
                "expected_minutes": EXPECTED_MINUTES,
                "missing_minutes": EXPECTED_MINUTES - count,
                "first_minute": first,
                "last_minute": last,
                "partial": count < EXPECTED_MINUTES,
            })
    return dict(out)
