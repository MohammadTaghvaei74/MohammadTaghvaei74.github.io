"""Incremental, durable daily score medians. No imputation or universe changes."""
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
from statistics import median
import math

TEHRAN = ZoneInfo('Asia/Tehran')
EXPECTED_MINUTES = 211  # inclusive 09:00 .. 12:30 minute buckets

def finite(value):
    if value is None or isinstance(value, bool): return None
    try: value = float(value)
    except (TypeError, ValueError, OverflowError): return None
    return value if math.isfinite(value) else None

def schema(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS score_daily_cursor(source TEXT, day TEXT, last_id INTEGER, PRIMARY KEY(source,day))')
    conn.execute('CREATE TABLE IF NOT EXISTS score_daily_minutes(day TEXT, symbol TEXT, minute TEXT, score REAL, observed TEXT, source TEXT, source_id INTEGER, PRIMARY KEY(day,symbol,minute))')
    conn.execute('CREATE TABLE IF NOT EXISTS score_daily_medians(day TEXT, symbol TEXT, median REAL, minute_count INTEGER, first_minute TEXT, last_minute TEXT, PRIMARY KEY(day,symbol))')

def load_daily(conn, days):
    schema(conn)
    tables={r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    dirty=set()
    for source in ('stock_snapshots','score_observations'):
        if source not in tables: continue
        high=conn.execute('SELECT max(rowid) FROM '+source).fetchone()[0] or 0
        for day in days:
            last=conn.execute('SELECT last_id FROM score_daily_cursor WHERE source=? AND day=?',(source,day)).fetchone()
            last=last[0] if last else 0
            if high<=last: continue
            query='SELECT rowid,symbol,timestamp,score FROM '+source+' WHERE trading_date=? AND rowid>? AND rowid<=? AND valid=1 AND score IS NOT NULL'
            for rid,symbol,timestamp,score in conn.execute(query,(day,last,high)):
                score=finite(score)
                if score is None: continue
                try:
                    dt=datetime.fromisoformat(timestamp)
                    dt=dt.replace(tzinfo=TEHRAN) if dt.tzinfo is None else dt.astimezone(TEHRAN)
                except (ValueError,TypeError): continue
                minute=dt.strftime('%H:%M')
                if dt.date().isoformat()!=day or not '09:00'<=minute<='12:30': continue
                observed=dt.isoformat(timespec='microseconds')
                cur=conn.execute('''INSERT INTO score_daily_minutes VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(day,symbol,minute) DO UPDATE SET score=excluded.score, observed=excluded.observed,source=excluded.source,source_id=excluded.source_id
                    WHERE excluded.observed>score_daily_minutes.observed OR
                    (excluded.observed=score_daily_minutes.observed AND (excluded.source>score_daily_minutes.source OR (excluded.source=score_daily_minutes.source AND excluded.source_id>score_daily_minutes.source_id)))''',
                    (day,symbol,minute,score,observed,source,rid))
                if cur.rowcount: dirty.add((day,symbol))
            conn.execute('INSERT OR REPLACE INTO score_daily_cursor VALUES(?,?,?)',(source,day,high))
    for day,symbol in dirty:
        values=list(conn.execute('SELECT minute,score FROM score_daily_minutes WHERE day=? AND symbol=? ORDER BY minute',(day,symbol)))
        conn.execute('INSERT OR REPLACE INTO score_daily_medians VALUES(?,?,?,?,?,?)',(day,symbol,median([v[1] for v in values]),len(values),values[0][0],values[-1][0]))
    conn.commit()
    out=defaultdict(list)
    for day in sorted(days):
        for symbol,score,count,first,last in conn.execute('SELECT symbol,median,minute_count,first_minute,last_minute FROM score_daily_medians WHERE day=?',(day,)):
            out[symbol].append({'day':day,'score':score,'minute_count':count,'expected_minutes':EXPECTED_MINUTES,'missing_minutes':EXPECTED_MINUTES-count,'first_minute':first,'last_minute':last,'partial':count<EXPECTED_MINUTES})
    return dict(out)
