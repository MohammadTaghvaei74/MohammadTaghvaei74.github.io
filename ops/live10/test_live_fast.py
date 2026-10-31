import unittest
import importlib.util
from pathlib import Path

class FastTests(unittest.TestCase):
    def test_fast_builder_preserves_history_and_enrichment(self):
        path=Path(__file__).with_name('live_fast.py')
        self.assertTrue(path.exists(), 'missing read-only fast producer')
        spec=importlib.util.spec_from_file_location('fast',path); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        previous={'stocks':[{'instrument':'1','symbol':'A','industry':'X','buyer_power':2}], 'daily':[{'x':1}], 'intraday':[{'timestamp':'old'}], 'queue_intraday':[1], 'industry_table':{'rows':[1]},'extra_section':{'a':1}}
        rows=[{'instrument':'1','symbol':'A','eligible_market_stock':True,'trade_volume':10,'score':2,'trade_value_toman':10}]
        result=m.build_snapshot(rows,previous,'2026-10-31T11:00:10+03:30',[],[])
        for key in ('daily','intraday','queue_intraday','industry_table','extra_section'): self.assertEqual(result[key],previous[key])
        self.assertEqual(result['stocks'][0]['industry'],'X')
        self.assertEqual(result['stocks'][0]['buyer_power'],2)
        self.assertNotIn('timestamp',rows[0])

    def test_write_guard_rejects_all_persistence(self):
        import live_fast as m
        self.assertTrue(hasattr(m,'deny_persistence'),'missing persistence guard')
        for event,args in [('sqlite3.connect',('x.db',)),('open',('raw.json','w',0)),('open',('raw.json',None,65)),('subprocess.Popen',('sh',)),('os.rename',('a','b'))]:
            with self.assertRaises(PermissionError): m.deny_persistence(event,args)
        m.deny_persistence('open',('snapshot.json','r',0))

    def test_fresh_changed_only(self):
        import live_fast as m
        self.assertTrue(hasattr(m,'should_publish'),'missing change/freshness guard')
        self.assertFalse(m.should_publish('a','a',0,True))
        self.assertFalse(m.should_publish('a','b',100,True))
        self.assertFalse(m.should_publish('a','b',0,False))
        self.assertTrue(m.should_publish('a','b',1,True))

if __name__=='__main__': unittest.main()
