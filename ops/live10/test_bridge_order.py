import unittest
import realtime_bridge as b
class OrderTests(unittest.TestCase):
 def test_older_fallback_cannot_replace_fast(self):
  s=b.BridgeState()
  fresh={'collector_observed_at':'2026-10-31T11:00:10+03:30'}
  old={'collector_observed_at':'2026-10-31T11:00:00+03:30'}
  s.accept(fresh,1,'new','redis-pubsub')
  self.assertFalse(s.accept(old,11,'old','file-fallback'))
  self.assertEqual(s.latest,fresh)
if __name__=='__main__':unittest.main()
