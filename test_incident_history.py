import sqlite3,unittest
from market.comprehensive_table import load_score_samples
class HistoryQueryTests(unittest.TestCase):
 def test_uses_bounded_existing_history_covering_index(self):
  conn=sqlite3.connect(':memory:');conn.row_factory=sqlite3.Row
  conn.executescript('CREATE TABLE v2_days(day TEXT,complete INTEGER); CREATE TABLE stock_snapshots(symbol TEXT,trading_date TEXT,score REAL,timestamp TEXT,valid INTEGER);CREATE INDEX idx_stock_snapshots_history_lookup ON stock_snapshots(trading_date,valid,timestamp,symbol,score);')
  conn.execute("INSERT INTO v2_days VALUES('2026-10-28',1)")
  conn.execute("INSERT INTO stock_snapshots VALUES('A','2026-10-28',2,'2026-10-28T10:00:00+03:30',1)")
  queries=[];conn.set_trace_callback(queries.append)
  days,rows=load_score_samples(conn,'2026-10-31')
  self.assertEqual(rows['A'][0]['score'],2)
  query=next(q for q in queries if 'SELECT rowid' in q)
  plan=' '.join(str(tuple(r)) for r in conn.execute('EXPLAIN QUERY PLAN '+query))
  self.assertIn('SEARCH',plan);self.assertIn('idx_stock_snapshots_history_lookup',plan)
  conn.close()
if __name__=='__main__':unittest.main()
