import ast,json,sqlite3,tempfile,unittest,types,sys
from pathlib import Path

SOURCE=Path(__file__).parent/'ops/publish_minute_direct.py'
def functions():
 tree=ast.parse(SOURCE.read_text())
 names={'build_public_comprehensive_rows','merge_client_metrics','_number','validate_client_metrics'}
 nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
 ns={'Path':Path,'json':json,'sqlite3':sqlite3,'sys':sys,'CLIENT_METRIC_FIELDS':('buy_per_capita_toman','buyer_power','legal_buy_pct','legal_sell_pct')}
 exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),'exec'),ns)
 return ns
class PublisherTests(unittest.TestCase):
 def test_mapping_does_not_scan_historical_stock_snapshots(self):
  ns=functions()
  with tempfile.TemporaryDirectory() as temp:
   p=Path(temp); ns['DB_PATH']=p/'history.db'; ns['INDUSTRY_CACHE']=p/'industries.json'
   sqlite3.connect(ns['DB_PATH']).close()
   ns['INDUSTRY_CACHE'].write_text(json.dumps({'123':'Industry'}))
   fake=types.ModuleType('comprehensive_table'); fake.build_comprehensive_rows=lambda stocks,generated,conn:(stocks,{})
   prior=sys.modules.get('comprehensive_table');sys.modules['comprehensive_table']=fake
   try:
    stocks=[{'instrument':'123','symbol':'ABC'}]
    rows,_=ns['build_public_comprehensive_rows'](stocks,'2026-10-31T10:00:00+03:30')
    self.assertEqual(rows[0]['industry'],'Industry')
   finally:
    if prior:sys.modules['comprehensive_table']=prior
    else:sys.modules.pop('comprehensive_table',None)
 def test_metric_recovery_preserves_original_source_provenance(self):
  ns=functions(); rows=[{'symbol':'ABC'}]
  source={'symbol':'ABC','buyer_power':1.5,'client_type_date':'2026-10-28','client_type_status':'ok_stale','client_type_fetched_at':'2026-10-31T07:00:00+00:00'}
  ns['merge_client_metrics'](rows,[source])
  self.assertEqual(rows[0].get('client_type_date'),'2026-10-28')
  self.assertEqual(rows[0].get('client_type_status'),'ok_stale')
  self.assertEqual(rows[0].get('client_type_fetched_at'),source['client_type_fetched_at'])
if __name__=='__main__':unittest.main()
