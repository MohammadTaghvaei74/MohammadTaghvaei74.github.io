import sqlite3,json,subprocess,time
from pathlib import Path
r={'time':time.time(),'locks':subprocess.check_output(['lslocks'],text=True),'processes':subprocess.check_output(['ps','-p','1372280','-o','pid,lstart,args'],text=True)}
with sqlite3.connect('file:/root/bourse-alert/scores_history.db?mode=ro',uri=True,timeout=2) as c:
 r['journal_mode']=c.execute('pragma journal_mode').fetchall()
 r['indexes']=c.execute("select name,sql from sqlite_master where type='index' and tbl_name='stock_snapshots'").fetchall()
 r['tables']={t:c.execute('select distinct timestamp from '+t+' order by timestamp desc limit 20').fetchall() for t in ['market_snapshots','stock_snapshots','group_snapshots','industry_detail_snapshots','raw_tse_snapshots']}
 r['plan']=c.execute("explain query plan SELECT trading_date, symbol, MAX(industry), COUNT(*) FROM stock_snapshots WHERE trading_date = ? GROUP BY trading_date,symbol",('2026-10-31',)).fetchall()
print(json.dumps(r,indent=2))
Path('/root/live10-backup/diagnosis.json').write_text(json.dumps(r,indent=2))
