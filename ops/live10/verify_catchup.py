"""Recheck the SAME failed window after bounded backlog drain; no omitted minutes."""
import json,re,sqlite3,subprocess
from pathlib import Path
from datetime import datetime
from contextlib import closing
folder=Path('/root/live10-remediation')
prior=json.loads((folder/'minute-verification.json').read_text());start=prior['start']
journal=subprocess.check_output(['journalctl','-u','bourse-chart-collector','--since',start,'--no-pager','-o','cat'],text=True)
committed=re.findall(r'MINUTE_ARCHIVE_COMMITTED observed=(\S+)',journal)
observed=re.findall(r'LIVE_SNAPSHOT_SAVED observed=(\S+)',journal)
with closing(sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True)) as c:
 tables={t:[r[0] for r in c.execute('select distinct timestamp from '+t+' where timestamp>=? order by timestamp',(start,))] for t in ['market_snapshots','stock_snapshots','group_snapshots','industry_detail_snapshots','raw_tse_snapshots']}
with closing(sqlite3.connect('file:/root/bourse-alert/minute_archive_pending.sqlite?mode=ro',uri=True)) as c: pending=c.execute('select stamp from pending').fetchall()
minutes=sorted({s[:16] for s in committed});deltas=[(datetime.fromisoformat(b)-datetime.fromisoformat(a)).total_seconds() for a,b in zip(minutes,minutes[1:])]
checks={'at_least_five_minutes':len(minutes)>=5,'consecutive_minutes':bool(deltas) and all(d==60 for d in deltas),'every_observed_committed':set(observed)<=set(committed),'committed_present_all_four_tables':all(s in tables[t] for s in committed for t in ['market_snapshots','stock_snapshots','group_snapshots','industry_detail_snapshots']),'outbox_empty':not pending,'one_collector_observation_per_minute':len(minutes)==len(committed),'no_fast_cadence':all(len([s for s in stamps if s[:16]==m])<=3 for stamps in tables.values() for m in {s[:16] for s in stamps})}
r={'start':start,'end':datetime.now().astimezone().isoformat(),'prior_result':prior['assertions'],'committed':committed,'observed':observed,'minute_deltas_seconds':deltas,'pending':pending,'tables':tables,'assertions':checks,'journal':journal}
(folder/'catchup-verification.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2));assert all(checks.values()),checks
