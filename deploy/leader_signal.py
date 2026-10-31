"""Symmetric, causal leader momentum: speed + efficiency + next sample retention."""
from dataclasses import dataclass
from datetime import datetime,timedelta
import math,json

@dataclass(frozen=True)
class Config:
 window_minutes:int=5
 minimum_change:float=1.5
 minimum_efficiency:float=.85
 retained_fraction:float=.85
 maximum_gap_seconds:int=120
 cooldown_seconds:int=1800

DEFAULT=Config()

def evaluate(points,pending,config=DEFAULT):
 if not points:return None,None
 now,current=points[-1]
 if not math.isfinite(current):return None,None
 event=None
 if pending:
  start=datetime.fromisoformat(pending['trigger_at']);origin=datetime.fromisoformat(pending['start_at'])
  age=(now-start).total_seconds();sign=pending['sign']
  if now.date()==start.date() and 30<=age<=config.maximum_gap_seconds and sign*(current-pending['start_score'])>=abs(pending['delta'])*config.retained_fraction and sign*(current-pending['start_score'])>0:
   event=dict(pending,direction='up' if sign>0 else 'down',confirmed_at=now.isoformat(),confirmed_score=current,confirmed_delta=current-pending['start_score'])
  if age<=0:return None,pending
 if event:return event,None
 target=now-timedelta(minutes=config.window_minutes)
 candidates=[(t,s) for t,s in points if t.date()==now.date() and t<=target]
 if not candidates:return None,None
 first=candidates[-1]
 if (target-first[0]).total_seconds()>60:return None,None
 window=[(t,s) for t,s in points if first[0]<=t<=now]
 if len(window)<4 or any(not math.isfinite(s) for t,s in window):return None,None
 if any(not 0<(b[0]-a[0]).total_seconds()<=config.maximum_gap_seconds for a,b in zip(window,window[1:])):return None,None
 delta=current-first[1];path=sum(abs(b[1]-a[1]) for a,b in zip(window,window[1:]));eff=abs(delta)/path if path else 0
 if abs(delta)+1e-9<config.minimum_change or eff+1e-9<config.minimum_efficiency:return None,None
 return None,{'start_at':first[0].isoformat(),'start_score':first[1],'trigger_at':now.isoformat(),'trigger_score':current,'delta':delta,'sign':1 if delta>0 else -1,'efficiency':eff,'window_minutes':config.window_minutes}

def format_message(symbol,event):
 digits=str.maketrans('0123456789.-','۰۱۲۳۴۵۶۷۸۹٫−')
 up=event['direction']=='up'
 gap=event.get('baseline_gap')
 label='ناموجود (کمبود سابقه)' if gap is None else f"{(0.0 if abs(gap)<.05 else gap):+.1f}".translate(digits)+' واحد'
 return '\n'.join([('📈' if up else '📉')+' #سیگنال_لیدر | '+('صعودی' if up else 'نزولی'),'📌 '+symbol,f'نسبت به میانگین: \u200e{label}\u200e'])

def events_for_database(c,now,leaders):
 c.execute('CREATE TABLE IF NOT EXISTS leader_pending(symbol TEXT PRIMARY KEY,payload TEXT NOT NULL)')
 out=[]
 for symbol in sorted(set(leaders)):
  raw=c.execute('SELECT timestamp,score FROM event_symbol_snapshots WHERE symbol=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp',(symbol,(now-timedelta(minutes=8)).isoformat(),now.isoformat())).fetchall()
  points=[(datetime.fromisoformat(t),float(s)) for t,s in raw]
  if not points or points[-1][0]!=now:continue
  old=c.execute('SELECT payload FROM leader_pending WHERE symbol=?',(symbol,)).fetchone()
  ev,pending=evaluate(points,json.loads(old[0]) if old else None)
  if pending:c.execute('INSERT OR REPLACE INTO leader_pending VALUES (?,?)',(symbol,json.dumps(pending)))
  else:c.execute('DELETE FROM leader_pending WHERE symbol=?',(symbol,))
  if ev:
   history=c.execute('SELECT score FROM event_symbol_snapshots WHERE symbol=? AND timestamp>=? AND timestamp<? ORDER BY timestamp DESC LIMIT 20',(symbol,now.date().isoformat()+'T00:00:00',now.isoformat())).fetchall()
   values=[float(r[0]) for r in history]
   ev['ma20']=sum(values)/20 if len(values)==20 and all(math.isfinite(v) for v in values) else None
   ev['baseline_gap']=ev['confirmed_score']-ev['ma20'] if ev['ma20'] is not None else None
   # Persist the causal event before pending state is discarded; no rule changes.
   from dataclasses import asdict
   evidence = dict(ev, thresholds=asdict(DEFAULT), basis='recorded')
   c.execute('CREATE TABLE IF NOT EXISTS signal_trigger_evidence(timestamp TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(timestamp,event_key))')
   c.execute('INSERT OR IGNORE INTO signal_trigger_evidence VALUES (?,?,?)', (now.isoformat(), f'leader:{symbol}', json.dumps(evidence, ensure_ascii=False)))
   out.append((f'leader:{symbol}',format_message(symbol,ev),ev['direction'],ev['confirmed_score']))
 return out
