"""Minute median contract v1: observed traded eligible universe, not prices.
Isolated SQLite store. Only this module's median_minutes table is pruned.
30 Tehran calendar dates includes today; last observation wins per minute.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
import json, math, os, sqlite3, tempfile, argparse
TZ = ZoneInfo('Asia/Tehran')
CONTRACT = 'eligible-traded-score-median-v1'

def connect(path):
    c = sqlite3.connect(path, timeout=10)
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('CREATE TABLE IF NOT EXISTS median_minutes (minute TEXT PRIMARY KEY, observed_at TEXT NOT NULL, market REAL, leaders REAL, market_count INTEGER, leader_count INTEGER, source TEXT NOT NULL, contract TEXT NOT NULL)')
    return c

def normalize(p, source):
    try:
        dt = datetime.fromisoformat(p['timestamp'])
        if dt.tzinfo is None: return None
        dt = dt.astimezone(TZ)
        if not '09:15' <= dt.strftime('%H:%M') <= '12:30': return None
        values = []
        for field, count in [('median_score','market_score_count'),('leader_median_score','leader_score_count')]:
            v = p.get(field)
            values.append(float(v) if p.get(count,0) > 0 and isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) else None)
        if all(v is None for v in values): return None
        return (dt.replace(second=0,microsecond=0).isoformat(),dt.isoformat(),*values,int(p.get('market_score_count',0)),int(p.get('leader_score_count',0)),source,CONTRACT)
    except (ValueError,TypeError,KeyError): return None

def ingest(c, points, now, source):
    cutoff = (now.astimezone(TZ).date()-timedelta(days=29)).isoformat()
    for p in points:
        row = normalize(p,source)
        if row and cutoff <= row[0][:10] <= now.astimezone(TZ).date().isoformat() and datetime.fromisoformat(row[1]) <= now:
            c.execute('INSERT INTO median_minutes VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(minute) DO UPDATE SET observed_at=excluded.observed_at,market=excluded.market,leaders=excluded.leaders,market_count=excluded.market_count,leader_count=excluded.leader_count,source=excluded.source,contract=excluded.contract WHERE excluded.observed_at > median_minutes.observed_at',row)
    c.execute('DELETE FROM median_minutes WHERE minute < ?', (cutoff,))
    c.commit()

def export(c, now):
    c.row_factory=sqlite3.Row
    points=[dict(r) for r in c.execute('SELECT * FROM median_minutes ORDER BY minute')]
    days=[]
    for day in sorted({p['minute'][:10] for p in points}):
        rows=[p for p in points if p['minute'][:10]==day]
        start=datetime.fromisoformat(day+'T09:15:00+03:30')
        expected=[(start+timedelta(minutes=i)).isoformat() for i in range(196)]
        present={p['minute'] for p in rows if p['market'] is not None and p['leaders'] is not None}
        missing=[]; run=[]
        for t in expected:
            if t not in present: run.append(t[11:16])
            elif run: missing.append([run[0],run[-1]]); run=[]
        if run: missing.append([run[0],run[-1]])
        days.append({'date':day,'observed_minutes':len(rows),'both_series_minutes':len(present),'expected_minutes':196,'partial':bool(missing),'missing_ranges':missing,'first':rows[0]['minute'],'last':rows[-1]['minute']})
    cutoff=(now.astimezone(TZ).date()-timedelta(days=29))
    dates=[(cutoff+timedelta(days=i)).isoformat() for i in range(30)]
    return {'schema_version':1,'contract':CONTRACT,'generated_at':now.isoformat(),'timezone':'Asia/Tehran','retention_calendar_days':30,'window_start':cutoff.isoformat(),'window_end':now.astimezone(TZ).date().isoformat(),'session':['09:15','12:30'],'unit':'score','minute_policy':'last valid observed snapshot per Tehran minute; no fill','line_policy':'last observed minute in each 10-minute bucket anchored at 09:15; gap breaks at any missing minute; no interpolation','coverage':days,'dates_without_observations':[d for d in dates if d not in {x['date'] for x in days}],'points':points}

def atomic_json(path,data):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix=path.name+'.')
    try:
        with os.fdopen(fd,'w',encoding='utf8') as f: json.dump(data,f,ensure_ascii=False,allow_nan=False,separators=(',',':'))
        os.chmod(tmp,0o644); os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def run(db,input_path,out):
    now=datetime.now(TZ)
    # Only collector-direct writes observations; exporter never trusts a shared
    # rolling handoff that a stale/orphan process could overwrite.
    with connect(db) as c:
        ingest(c,[],now,'retention-only')
        data=export(c,now)
        atomic_json(out,data)
    print(json.dumps({'points':len(data['points']),'days':len(data['coverage']),'last':data['points'][-1]['minute'] if data['points'] else None}))

if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--db',default='/root/bourse-alert/median_history.sqlite'); p.add_argument('--input',default='/root/bourse-alert/live_market.json'); p.add_argument('--out',default='/srv/sorena/market/data/median-history.json'); a=p.parse_args(); run(a.db,a.input,a.out)
