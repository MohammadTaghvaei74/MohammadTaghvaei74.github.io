import unittest, sqlite3, importlib.util

class ReplayTests(unittest.TestCase):
    def test_never_invents_evidence_without_matching_confirmation(self):
        self.assertIsNotNone(importlib.util.find_spec('deploy.replay_signal_evidence'))
        from deploy import replay_signal_evidence
        c=sqlite3.connect(':memory:')
        c.execute('create table event_outbox(timestamp text,event_key text,status text)')
        c.execute('create table event_symbol_snapshots(timestamp text,symbol text,score real)')
        c.execute("insert into event_outbox values ('2026-10-31T10:06:00+03:30','leader:دی','sent')")
        self.assertEqual(replay_signal_evidence.backfill(c),0)

if __name__=='__main__':unittest.main()
