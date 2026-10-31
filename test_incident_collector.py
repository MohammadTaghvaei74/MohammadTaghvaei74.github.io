import ast,unittest,types,statistics,tempfile,sqlite3,time
from collections import defaultdict
from pathlib import Path
from datetime import datetime,timezone

def load():
 p=Path(__file__).parent/'ops/minute_chart_collector.py';tree=ast.parse(p.read_text())
 nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'build_handoff','persist_live'}]
 main=types.SimpleNamespace(market_summary_values=lambda rows:(1,1,1,0,0),market_group_average_median=lambda rows:(1,1),LEADERS=set(),LEVERAGED_FUNDS={'Fund'},instrument_type_label=lambda x:x)
 ns=dict(datetime=datetime,main=main,statistics=statistics,defaultdict=defaultdict,load_previous=lambda:{},refresh_client_type_enrichment=lambda *args:{'refreshed':False},carry_forward_enrichment=lambda *args:None,sqlite3=sqlite3)
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),ns);return ns
class CollectorTests(unittest.TestCase):
 def test_special_rows_and_groups_have_true_batch_observation(self):
  ns=load(); observed=datetime(2026,10,31,8,tzinfo=timezone.utc)
  rows=[{'symbol':'Fund','trade_volume':1,'score':1,'eligible_market_stock':False}]
  payload=ns['build_handoff'](rows,observed)
  self.assertEqual(payload['leveraged'][0].get('timestamp'),observed.isoformat())
  self.assertTrue(all(r.get('timestamp')==observed.isoformat() for r in payload['groups']))
 def test_archive_connection_has_bounded_lock_wait(self):
  ns=load(); ns['main'].DB_PATH='unused'
  ns['atomic_json']=lambda *args:None; ns['publish_snapshot']=lambda x:True;ns['LIVE_PATH']=Path('unused')
  ns['logging']=types.SimpleNamespace(info=lambda *args:None,exception=lambda *args:None)
  def connect(path,timeout):
   self.assertLessEqual(timeout,2,'archive lock may not block the live collector for minutes')
   raise sqlite3.OperationalError('bounded lock')
  ns['sqlite3']=types.SimpleNamespace(connect=connect)
  with self.assertRaises(sqlite3.OperationalError):
   ns['persist_live']([],datetime(2026,10,31,8,tzinfo=timezone.utc))
if __name__=='__main__':unittest.main()
