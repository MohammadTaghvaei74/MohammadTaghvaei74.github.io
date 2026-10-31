"""One-off, explicitly labelled reconstruction. Never send or alter trading state."""
import json
import sqlite3
from dataclasses import asdict
from datetime import datetime,timedelta
try:
    from .leader_signal import evaluate, DEFAULT
except ImportError:
    from leader_signal import evaluate, DEFAULT


def backfill(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS signal_trigger_evidence(timestamp TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(timestamp,event_key))')
    targets = {(t,k) for t,k in conn.execute("SELECT timestamp,event_key FROM event_outbox WHERE status='sent' AND event_key LIKE 'leader:%'") if 'T' in t}
    count=0
    for symbol in sorted({k.split(':',1)[1] for t,k in targets}):
        pending=None; window=[]
        for ts,score in conn.execute('SELECT timestamp,score FROM event_symbol_snapshots WHERE symbol=? ORDER BY timestamp',(symbol,)):
            now=datetime.fromisoformat(ts)
            window=[p for p in window if p[0]>=now-timedelta(minutes=8)]
            window.append((now,float(score)))
            ev,pending=evaluate(window,pending)
            if ev and (ts,'leader:'+symbol) in targets:
                ev.update(basis='reconstructed',thresholds=asdict(DEFAULT))
                count += conn.execute('INSERT OR IGNORE INTO signal_trigger_evidence VALUES (?,?,?)',(ts,'leader:'+symbol,json.dumps(ev,ensure_ascii=False))).rowcount
    conn.commit()
    return count

if __name__=='__main__':
    import sys
    with sqlite3.connect(sys.argv[1],timeout=60) as conn:
        print('reconstructed evidence:',backfill(conn))
