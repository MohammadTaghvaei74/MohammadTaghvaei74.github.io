import unittest,sqlite3
from datetime import datetime
from median_history import *
class HistoryTests(unittest.TestCase):
 def setUp(self): self.c=connect(':memory:'); self.now=datetime.fromisoformat('2026-10-31T12:31:00+03:30')
 def p(self,t='2026-10-31T09:15:01+03:30',m=1,l=2): return dict(timestamp=t,median_score=m,leader_median_score=l,market_score_count=100,leader_score_count=16)
 def test_session(self):
  for t,valid in [('09:14',False),('09:15',True),('12:30',True),('12:31',False)]: self.assertEqual(normalize(self.p('2026-10-31T'+t+':59+03:30'),'test') is not None,valid)
 def test_retention_only_new_table(self):
  self.c.execute('create table unrelated (v int)');self.c.execute('insert into unrelated values (1)')
  ingest(self.c,[self.p('2026-10-01T09:15:00+03:30'),self.p('2026-10-02T09:15:00+03:30'),self.p()],self.now,'test')
  self.assertEqual(self.c.execute('select count(*) from median_minutes').fetchone()[0],2)
  self.assertEqual(self.c.execute('select count(*) from unrelated').fetchone()[0],1)
 def test_last_minute_wins_and_no_stale_replacement(self):
  ingest(self.c,[self.p(),self.p('2026-10-31T09:15:40+03:30',3),self.p()],self.now,'test')
  self.assertEqual(self.c.execute('select market from median_minutes').fetchone()[0],3)
 def test_null_not_zero_and_nonfinite(self):
  p=self.p();p['leader_score_count']=0
  self.assertIsNone(normalize(p,'test')[3]); self.assertIsNone(normalize(self.p(m=float('nan')),'test')[2])
 def test_no_future(self):
  ingest(self.c,[self.p('2026-11-01T09:15:00+03:30')],self.now,'test');self.assertEqual(export(self.c,self.now)['points'],[])
 def test_missing_ranges_and_no_fake_days(self):
  ingest(self.c,[self.p(),self.p('2026-10-31T09:17:00+03:30')],self.now,'test');d=export(self.c,self.now)
  self.assertEqual(len(d['coverage']),1); self.assertEqual(len(d['dates_without_observations']),29)
  self.assertEqual(d['coverage'][0]['missing_ranges'],[['09:16','09:16'],['09:18','12:30']])
if __name__=='__main__': unittest.main()
