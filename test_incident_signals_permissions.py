import tempfile,unittest,stat
from pathlib import Path
from market.export_signals import export
class PublicSignalPermissions(unittest.TestCase):
 def test_public_json_readable_after_replace_and_unchanged_retry(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'signals.json'; db=Path(t)/'missing.db'
   export(db,p)
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)
   p.chmod(0o600);export(db,p)
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)
if __name__=='__main__':unittest.main()
