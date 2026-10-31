import sqlite3,tempfile,unittest,importlib.util,sys,types,threading,time
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).parent
class ArchiveTests(unittest.TestCase):
 def test_locked_archive_keeps_real_minutes_and_survives_restart(self):
  # Real SQLite contention; no mocked connection or invented live observations.
  from minute_archive_outbox import Outbox
  with tempfile.TemporaryDirectory() as tmp:
   target=str(Path(tmp)/'archive.db'); spool=str(Path(tmp)/'pending.db')
   c=sqlite3.connect(target); c.execute('create table observations(stamp text primary key, value int)'); c.commit()
   def archive(rows,observed):
    with __import__('contextlib').closing(sqlite3.connect(target,timeout=.01)) as dest, dest:
     dest.execute('insert or replace into observations values (?,?)',(observed.isoformat(),rows[0]['value']))
   box=Outbox(spool,archive)
   stamps=['2026-10-31T11:00:01+03:30','2026-10-31T11:01:02+03:30']
   c.execute('begin immediate')
   try:
    try:
     for i,s in enumerate(stamps): box.enqueue([{'value':i}],datetime.fromisoformat(s))
    except sqlite3.OperationalError:
     self.fail('Minute capture must remain durable while the archive is locked')
    self.assertFalse(box.drain_once()); self.assertEqual(box.pending(),2)
   finally:
    c.rollback(); c.close()
   box=Outbox(spool,archive)
   self.assertTrue(box.drain_once()); self.assertTrue(box.drain_once()); self.assertEqual(box.pending(),0)
   with __import__('contextlib').closing(sqlite3.connect(target)) as dest:self.assertEqual(dest.execute('select stamp from observations order by stamp').fetchall(),[(s,) for s in stamps])
 def test_schedule_does_not_skip_boundary_crossed_during_work(self):
  import ast
  source=ast.parse((ROOT/'minute_chart_collector.py').read_text(encoding='utf8'))
  funcs=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='scheduled_delay']
  self.assertTrue(funcs,'Schedule must use cycle start, not completion')
  ns={};exec(compile(ast.Module(body=funcs,type_ignores=[]),'<collector>','exec'),ns)
  self.assertEqual(ns['scheduled_delay'](108,121),0)
  self.assertEqual(ns['scheduled_delay'](121,130),50)
 def test_industry_cache_recovers_empty_previous(self):
  import ast
  source=ast.parse((ROOT/'minute_chart_collector.py').read_text(encoding='utf8'))
  funcs=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='restore_cached_industries']
  self.assertTrue(funcs,'Need cache recovery when the previous handoff lost industries')
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'live_market.json';path.with_name('industry_cache.json').write_text('{"1":"sector"}')
   ns={'LIVE_PATH':path,'json':__import__('json'),'logging':__import__('logging')}
   exec(compile(ast.Module(body=funcs,type_ignores=[]),'<collector>','exec'),ns)
   rows=[{'instrument':'1'},{'instrument':'2','industry':'existing'}]
   ns['restore_cached_industries'](rows)
   self.assertEqual([r.get('industry') for r in rows],['sector','existing'])
 def test_minute_archive_preserves_known_industry(self):
  import ast,copy
  source=ast.parse((ROOT/'minute_chart_collector.py').read_text(encoding='utf8'))
  funcs=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ['persist_live','carry_forward_enrichment']]
  captured=[]
  ns={'datetime':datetime,'CARRY_FORWARD_FIELDS':['industry'],'CLIENT_FIELDS':set(),
      'load_previous':lambda:{'stocks':[{'instrument':'1','industry':'known-sector'}]},
      'restore_cached_industries':lambda rows:None,
      'archive_outbox':types.SimpleNamespace(enqueue=lambda rows,at:captured.extend(copy.deepcopy(rows))),
      'build_handoff':lambda rows,at: (_ for _ in ()).throw(RuntimeError('stop after durable capture'))}
  exec(compile(ast.Module(body=funcs,type_ignores=[]),'<collector>','exec'),ns)
  with self.assertRaisesRegex(RuntimeError,'stop after durable capture'):
   ns['persist_live']([{'instrument':'1'}],datetime.now(timezone.utc))
  self.assertEqual(captured[0].get('industry'),'known-sector')
 def test_collector_durably_enqueues_before_enrichment(self):
  import ast
  source=ast.parse((ROOT/'minute_chart_collector.py').read_text(encoding='utf8'))
  f=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='persist_live')
  calls=[ast.unparse(n.func) for n in ast.walk(f) if isinstance(n,ast.Call)]
  self.assertIn('archive_outbox.enqueue',calls)
  self.assertLess(calls.index('archive_outbox.enqueue'),calls.index('build_handoff'))
  self.assertNotIn('sqlite3.connect',calls)
if __name__=='__main__':unittest.main()
