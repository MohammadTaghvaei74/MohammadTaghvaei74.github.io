"""Exercise the deployed main entrypoint without network/enrichment imports."""
import ast
import json
import sqlite3
import types
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def test_history_refresh_runs_outside_hours_without_restamping(tmp_path):
    from market.daily_turnover import load_completed_daily, attach_completed_daily
    db = tmp_path / 'db.sqlite'
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE v2_days(day TEXT,turnover REAL,source TEXT,complete INT)')
        c.execute('INSERT INTO v2_days VALUES (?,?,?,1)', ('2026-10-28', 4e12, 'persisted 12:30 MarketWatch final snapshot; 2026-10-28T12:30:00+03:30'))
    target = tmp_path / 'market/data/market.json'; target.parent.mkdir(parents=True)
    old = {'generated_at':'2026-10-28T12:30:00+03:30', 'published_at':'original', 'stocks':[1], 'daily':[]}
    target.write_text(json.dumps(old))
    tree=ast.parse((ROOT/'deploy/publish_minute_direct.py').read_text())
    main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
    namespace={'datetime':datetime,'TEHRAN':timezone.utc,'DB_PATH':db,'sqlite3':sqlite3,'SITE':tmp_path,
               'in_window':lambda now:False,'read_object':lambda p:json.loads(p.read_text()),
               'atomic_json':lambda p,v:p.write_text(json.dumps(v))}
    exec(compile(ast.Module(body=[main],type_ignores=[]),'<publisher-main>','exec'),namespace)
    assert namespace['main']()==0
    result=json.loads(target.read_text())
    assert len(result['daily'])==1
    assert {k:v for k,v in result.items() if k not in ('daily','daily_meta')} == {k:v for k,v in old.items() if k!='daily'}
    before=target.stat().st_mtime_ns
    assert namespace['main']()==0
    assert target.stat().st_mtime_ns==before
