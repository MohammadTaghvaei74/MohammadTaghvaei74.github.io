import unittest
from market import export_signals

class ExplanationTests(unittest.TestCase):
    def test_missing_trigger_is_explicit_not_distance_from_average(self):
        row = {'category':'leader','text':'نسبت به میانگین: +۲٫۶ واحد'}
        self.assertTrue(hasattr(export_signals, 'explain_signal'), 'evidence explanation is missing')
        result = export_signals.explain_signal(None, 'leader:دی', '2026-10-31T11:03:00+03:30', row['text'])
        self.assertIn('ثبت نشده', result['text'])
        self.assertIn('علت صدور نیست', result['text'])
        self.assertEqual(result['basis'], 'unavailable')

class RecordedTests(unittest.TestCase):
    def test_recorded_leader_evidence_is_explained(self):
        import sqlite3, json
        c = sqlite3.connect(':memory:')
        c.execute('create table signal_trigger_evidence(timestamp text,event_key text,payload text,primary key(timestamp,event_key))')
        event = dict(start_at='2026-10-31T10:00:00+03:30',start_score=1.0,trigger_at='2026-10-31T10:05:00+03:30',trigger_score=3.0,delta=2.0,efficiency=1.0,confirmed_at='2026-10-31T10:06:00+03:30',confirmed_score=2.9,confirmed_delta=1.9,window_minutes=5,thresholds=dict(minimum_change=1.5,minimum_efficiency=.85,retained_fraction=.85,maximum_gap_seconds=120))
        c.execute('insert into signal_trigger_evidence values (?,?,?)',(event['confirmed_at'],'leader:دی',json.dumps(event)))
        result=export_signals.explain_signal(c,'leader:دی',event['confirmed_at'],'نسبت به میانگین: +2')
        self.assertEqual(result['basis'],'recorded')
        for part in ['۱٫۰۰','۳٫۰۰','۲٫۹۰','۱۰:۰۰','۱۰:۰۵','۱۰:۰۶','۱٫۵','۸۵']:
            self.assertIn(part,result['text'])

if __name__ == '__main__': unittest.main()
