import unittest, sqlite3, json
from datetime import datetime,timedelta
from deploy import leader_signal

class TriggerEvidenceTests(unittest.TestCase):
    def test_persists_exact_event_without_changing_emission(self):
        c=sqlite3.connect(':memory:')
        c.execute('create table event_symbol_snapshots(timestamp text,symbol text,score real)')
        start=datetime.fromisoformat('2026-10-31T10:00:00+03:30')
        events=[]
        for minute,score in enumerate([0,.4,.8,1.2,1.6,2,1.9]):
            now=start+timedelta(minutes=minute)
            c.execute('insert into event_symbol_snapshots values (?,?,?)',(now.isoformat(),'دی',score))
            events += leader_signal.events_for_database(c,now,['دی'])
        self.assertEqual(len(events),1)
        table=c.execute("select 1 from sqlite_master where name='signal_trigger_evidence'").fetchone()
        self.assertIsNotNone(table,'trigger evidence must survive deletion of pending state')
        payload=json.loads(c.execute('select payload from signal_trigger_evidence').fetchone()[0])
        self.assertEqual(payload['start_score'],0)
        self.assertEqual(payload['trigger_score'],2)
        self.assertEqual(payload['confirmed_score'],1.9)
        self.assertEqual(payload['thresholds']['minimum_change'],1.5)
        self.assertEqual(payload['basis'],'recorded')

if __name__=='__main__': unittest.main()
