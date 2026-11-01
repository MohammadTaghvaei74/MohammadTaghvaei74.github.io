"""Refresh history contract without restamping source snapshot or health."""
import json
import sqlite3
import sys
import time
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
sys.path.insert(0,'/root/bourse-site/market')
from comprehensive_table import build_comprehensive_rows

def refresh(root='/srv/sorena/market/data', db='/root/bourse-alert/scores_history.db'):
    root=Path(root)
    now=datetime.now(ZoneInfo('Asia/Tehran')).isoformat()
    c=sqlite3.connect(db,timeout=120)
    payload=json.loads((root/'comprehensive.json').read_text())
    rows,meta=build_comprehensive_rows(payload['rows'],now,c)
    payload['rows']=rows; payload['meta']=meta; payload['score_history_updated_at']=now
    market=json.loads((root/'market.json').read_text())
    by={r['symbol']:r for r in rows}
    for r in market.get('stocks',[]):
        match=by.get(r.get('symbol'))
        if match:
            r.update({k:v for k,v in match.items() if k.startswith('score_10d_')})
    market['comprehensive_meta']=meta
    market['score_history_updated_at']=now
    for name,value in [('comprehensive.json',payload),('market.json',market)]:
        tmp=root/(name+'.scoretmp'); tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n'); tmp.chmod(0o644); tmp.replace(root/name)
    print(json.dumps({'rows':len(rows),'null':sum(r['score_10d_total'] is None for r in rows),'days':meta['days'],'version':meta['contract_version'],'source_timestamp':payload['generated_at']},ensure_ascii=False))
    c.close()
if __name__=='__main__':
    start=time.monotonic(); refresh(); print('seconds',time.monotonic()-start)
