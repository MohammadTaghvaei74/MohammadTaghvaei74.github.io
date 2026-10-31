import importlib.util
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DailyTurnoverTests(unittest.TestCase):
    def test_complete_validated_history_and_timestamp_preservation(self):
        path = ROOT / 'market/daily_turnover.py'
        self.assertTrue(path.exists(), 'completed daily history loader is missing')
        spec = importlib.util.spec_from_file_location('daily_turnover', path)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        conn = sqlite3.connect(':memory:')
        conn.execute('CREATE TABLE v2_days(day TEXT PRIMARY KEY,turnover REAL,source TEXT,complete INTEGER)')
        prefix = 'persisted 12:30 MarketWatch final snapshot; '
        conn.executemany('INSERT INTO v2_days VALUES (?,?,?,?)', [
            ('2026-10-27', 2e12, prefix+'2026-10-27T12:30:00+03:30', 1),
            ('2026-10-28', 3e12, prefix+'2026-10-28T12:30:00+03:30', 1),
            ('2026-10-26', 7e12, prefix+'2026-10-26T12:30:00+03:30', 0),
            ('2026-10-25', 8e12, 'unknown', 1),
            ('2026-10-24', -1, prefix+'2026-10-24T12:30:00+03:30', 1),
            ('2026-10-21', float('inf'), prefix+'2026-10-21T12:30:00+03:30', 1),
            ('2026-10-20', 9e12, prefix+'2026-10-20T12:29:00+03:30', 1),
            ('2026-10-19', 9e12, prefix+'2026-10-18T12:30:00+03:30', 1),
            ('2026-10-31', 9e12, prefix+'2026-10-31T12:30:00+03:30', 1),
        ])
        now=datetime(2026,10,31,11,tzinfo=timezone(timedelta(hours=3,minutes=30)))
        daily=mod.load_completed_daily(conn, now)
        self.assertEqual([r['trading_date'] for r in daily], ['2026-10-28','2026-10-27'])
        self.assertEqual([r['final_turnover_toman'] for r in daily], [3e12,2e12])
        self.assertTrue(all(r['complete'] is True and r['source'].startswith(prefix) for r in daily))
        old={'generated_at':'old-source', 'published_at':'old-publication', 'stocks':[{'x':1}], 'daily':[]}
        updated=mod.attach_completed_daily(old,daily)
        self.assertEqual(updated['generated_at'],'old-source')
        self.assertEqual(updated['published_at'],'old-publication')
        self.assertEqual(updated['stocks'], old['stocks'])
        self.assertEqual(updated['daily_meta']['unit'],'toman')
        self.assertEqual(mod.attach_completed_daily(updated,daily),updated)
        with self.assertRaises(ValueError): mod.attach_completed_daily(updated,[])

if __name__ == '__main__': unittest.main()
