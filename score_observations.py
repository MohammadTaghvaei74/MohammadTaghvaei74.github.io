import math
import sqlite3
from datetime import datetime

def persist(conn, rows, observed: datetime, source='collector'):
    conn.execute('''CREATE TABLE IF NOT EXISTS score_observation_batches(
      observed TEXT PRIMARY KEY, source TEXT NOT NULL, row_count INTEGER NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS score_observations(
      observed_minute TEXT NOT NULL, observed TEXT NOT NULL, symbol TEXT NOT NULL,
      instrument TEXT, score REAL NOT NULL, eligible_market_stock INTEGER NOT NULL,
      trade_volume REAL, source TEXT NOT NULL, PRIMARY KEY(observed_minute,symbol))''')
    stamp=observed.isoformat(); minute=observed.replace(second=0,microsecond=0).isoformat()
    valid=[]
    for row in rows:
        try: score=float(row.get('score'))
        except (TypeError,ValueError): continue
        if not math.isfinite(score) or not row.get('symbol'): continue
        valid.append((minute,stamp,str(row['symbol']),row.get('instrument'),score,1 if row.get('eligible_market_stock') else 0,row.get('trade_volume'),source))
    conn.executemany('''INSERT INTO score_observations VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(observed_minute,symbol) DO UPDATE SET observed=excluded.observed, instrument=excluded.instrument, score=excluded.score, eligible_market_stock=excluded.eligible_market_stock, trade_volume=excluded.trade_volume, source=excluded.source
      WHERE excluded.observed>score_observations.observed''',valid)
    conn.execute('INSERT OR IGNORE INTO score_observation_batches VALUES(?,?,?)',(stamp,source,len(valid)))
    return len(valid)
