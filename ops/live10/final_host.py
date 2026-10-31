import json,hashlib,subprocess,urllib.request,sqlite3
from pathlib import Path
from datetime import datetime
from contextlib import closing
root=Path('/root/bourse-alert');p=json.loads((root/'live_market.json').read_text())
r={'time':datetime.now().astimezone().isoformat(),'hashes':{str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in [root/'main.py',root/'minute_chart_collector.py',root/'minute_archive_outbox.py',Path('/root/bourse-live-10s/fast_live_collector.py')]},'snapshot':{'timestamp':p['generated_at'],'stocks':len(p['stocks']),'industry_count':len(p['industries']),'stocks_with_industry':sum(bool(x.get('industry')) for x in p['stocks']),'leveraged':len(p['leveraged']),'intraday':len(p['intraday'])},'units':subprocess.check_output(['systemctl','show','bourse-chart-collector','bourse-fast-live','bourse-live-fast','-p','Id','-p','ActiveState','-p','MainPID','-p','UnitFileState','-p','MemoryCurrent','-p','NRestarts'],text=True),'fast_open_fds':subprocess.check_output(['sh','-c','for f in /proc/1612269/fd/*; do readlink "$f"; done'],text=True)}
for endpoint in ['health','latest']:
 with urllib.request.urlopen('https://94-101-184-98.sslip.io/api/live/'+endpoint,timeout=25) as resp:v=json.load(resp)
 r[endpoint]=v if endpoint=='health' else {'source':v.get('source'),'generated_at':v.get('generated_at'),'keys':list(v)[:15],'stocks':len(v.get('stocks',[])),'industries':len(v.get('industries',[]))}
with closing(sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True)) as c:
 r['latest_db']={t:c.execute('select max(timestamp) from '+t).fetchone()[0] for t in ['market_snapshots','stock_snapshots','group_snapshots','industry_detail_snapshots','raw_tse_snapshots']}
Path('/root/live10-remediation/final-host.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
