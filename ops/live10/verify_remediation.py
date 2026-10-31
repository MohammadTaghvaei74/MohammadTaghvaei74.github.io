import json,sqlite3,subprocess,time,re
from pathlib import Path
from contextlib import closing
from datetime import datetime
start=datetime.now().astimezone().isoformat(); samples=[]
for i in range(37):
 with closing(sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True,timeout=2)) as c:
  stamps=[r[0] for r in c.execute('select timestamp from market_snapshots where timestamp>=? order by timestamp',(start,))]
 with closing(sqlite3.connect('file:/root/bourse-alert/minute_archive_pending.sqlite?mode=ro',uri=True)) as c:
  pending=c.execute('select stamp from pending order by stamp').fetchall()
 samples.append({'wall':datetime.now().astimezone().isoformat(),'stamps':stamps,'pending':pending})
 if i<36:time.sleep(10)
journal=subprocess.check_output(['journalctl','-u','bourse-chart-collector','--since',start,'--no-pager','-o','cat'],text=True)
committed=re.findall('MINUTE_ARCHIVE_COMMITTED observed=(\S+)',journal)
with closing(sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True)) as c:
 tables={t:[r[0] for r in c.execute('select distinct timestamp from '+t+' where timestamp>=? order by timestamp',(start,))] for t in ['market_snapshots','stock_snapshots','group_snapshots','industry_detail_snapshots','raw_tse_snapshots']}
minutes=sorted(set(x[:16] for x in committed)); diffs=[(datetime.fromisoformat(b)-datetime.fromisoformat(a)).total_seconds() for a,b in zip(minutes,minutes[1:])]
result={'start':start,'end':datetime.now().astimezone().isoformat(),'samples':samples,'committed':committed,'minute_deltas_seconds':diffs,'tables':tables,'journal':journal,'fast_journal':subprocess.check_output(['journalctl','-u','bourse-fast-live','--since',start,'--no-pager','-o','cat'],text=True),'units':subprocess.check_output(['systemctl','show','bourse-chart-collector','bourse-fast-live','bourse-live-fast','-p','Id','-p','MainPID','-p','ActiveState','-p','NRestarts','-p','UnitFileState'],text=True)}
result['assertions']={'at_least_five_minutes':len(minutes)>=5,'consecutive_minutes':bool(diffs) and all(d==60 for d in diffs),'committed_present_all_stock_market_group':all(s in tables[t] for s in committed for t in ['market_snapshots','stock_snapshots','group_snapshots']),'no_fast_cadence':all(len([s for s in stamps if s[:16]==m])<=3 for m in {s[:16] for s in stamps}),'outbox_empty':not samples[-1]['pending']}
Path('/root/live10-remediation/minute-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2));assert all(result['assertions'].values()),result['assertions']
