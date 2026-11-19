import gzip
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DailyTurnoverTests(unittest.TestCase):
    def test_final_capture_accepts_recorder_second_jitter(self):
        path = ROOT / 'market/daily_turnover.py'
        spec = importlib.util.spec_from_file_location('daily_turnover_jitter', path)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        conn = sqlite3.connect(':memory:')
        prefix = 'persisted 12:30 MarketWatch final snapshot; '
        conn.execute('CREATE TABLE v2_days(day TEXT PRIMARY KEY,turnover REAL,source TEXT,complete INTEGER)')
        conn.execute('INSERT INTO v2_days VALUES (?,?,?,1)',
                     ('2026-10-28', 3e12, prefix+'2026-10-28T12:30:04+03:30'))
        with __import__('tempfile').TemporaryDirectory() as raw:
            mod.RAW_DIR = Path(raw)
            rows = []
            for instrument, isin, symbol, family, amount in [
                ('1', 'IRO1TEST', 'TEST', '5A', '100000000000'),
                ('2', 'IRT1TEST', 'LEV', '5A', '200000000000'),
            ]:
                fields = [instrument, isin, symbol] + [''] * 7 + [amount] + [''] * 14 + [family]
                rows.append(','.join(fields))
            with gzip.open(Path(raw) / '20261028T123004_stocks.json.gz', 'wt', encoding='utf8') as handle:
                json.dump(rows, handle)
            daily = mod.load_completed_daily(
                conn, datetime(2026, 10, 31, 11, tzinfo=timezone(timedelta(hours=3, minutes=30))))
        self.assertEqual(len(daily), 1)
        self.assertTrue(daily[0]['complete'])
        self.assertEqual(daily[0]['raw_source'], '20261028T123004_stocks.json.gz')
        self.assertEqual(daily[0]['final_turnover_toman'], 30000000000.0)

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
        import tempfile
        with tempfile.TemporaryDirectory() as raw:
            mod.RAW_DIR=Path(raw)
            daily=mod.load_completed_daily(conn, now)
        self.assertEqual([r['trading_date'] for r in daily], ['2026-10-28','2026-10-27','2026-10-24','2026-10-21'])
        self.assertEqual([r['final_turnover_toman'] for r in daily], [None,None,None,None])
        self.assertTrue(all(r['complete'] is False and r['source'].startswith(prefix) for r in daily))
        old={'generated_at':'old-source', 'published_at':'old-publication', 'stocks':[{'x':1}], 'daily':[]}
        updated=mod.attach_completed_daily(old,daily)
        self.assertEqual(updated['generated_at'],'old-source')
        self.assertEqual(updated['published_at'],'old-publication')
        self.assertEqual(updated['stocks'], old['stocks'])
        self.assertEqual(updated['daily_meta']['unit'],'toman')
        self.assertEqual(mod.attach_completed_daily(updated,daily),updated)
        with self.assertRaises(ValueError): mod.attach_completed_daily(updated,[])

if __name__ == '__main__': unittest.main()
