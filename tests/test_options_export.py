import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market.export_options import build_snapshot, atomic_export


def test_partial_history_is_rejected_and_diagnostic_is_real(tmp_path):
    db = tmp_path / 'options.sqlite'
    conn = sqlite3.connect(db)
    conn.execute('CREATE TABLE option_daily_values (trading_date TEXT, symbol TEXT, value_toman REAL, complete INTEGER)')
    conn.executemany('INSERT INTO option_daily_values VALUES (?,?,?,?)', [
        ('2026-10-01', 'ضAAA', 20_000_000_000, 1),
        ('2026-10-02', 'ضAAA', 20_000_000_000, 1),
    ])
    conn.commit(); conn.close()
    now = datetime(2026, 10, 3, 10, tzinfo=timezone.utc)
    contracts = [{
        'symbol': 'ضAAA', 'underlying': 'AAA', 'expiry': '1405/07/20',
        'strike': 100, 'ask': 12, 'bid': 11, 'trade_value_toman': 20_000_000_000,
        'quote_timestamp': now.isoformat(), 'leader_rank': 1,
    }]
    payload = build_snapshot(db, contracts, {'AAA': {'last_price': 120, 'quote_timestamp': now.isoformat(), 'leader_rank': 1}}, now)
    assert payload['status'] == 'no_opportunity'
    assert payload['counts']['contracts'] == 1
    assert payload['pairs'] == []
    assert not any('تاریخچه' in d['label'] for d in payload['diagnostics'])


def test_legacy_unverified_history_is_never_accepted(tmp_path):
    from market.export_options import _history
    db = tmp_path / 'legacy.db'
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE option_daily_values(trading_date TEXT,symbol TEXT,value_toman REAL)')
        c.executemany('INSERT INTO option_daily_values VALUES (?,?,?)', [(f'2026-10-{i:02}', 'X', 20e9) for i in range(1, 8)])
    assert _history(db, 'X', '2026-10-09') == (None, 0)


def test_today_value_replaces_history_liquidity_filter(tmp_path):
    db = tmp_path / 'options.sqlite'
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE option_daily_values(trading_date TEXT,symbol TEXT,value_toman REAL,complete INTEGER)')
    now = datetime(2026, 10, 3, 10, tzinfo=timezone.utc)
    contracts = [{"symbol":"ضAAA","underlying":"AAA","expiry":"1405/07/20","strike":100,"ask":12,"bid":11,"trade_value_toman":20_000_000_001,"quote_timestamp":now.isoformat()}, {"symbol":"ضAAB","underlying":"AAA","expiry":"1405/07/20","strike":120,"ask":8,"bid":7,"trade_value_toman":15_000_000_001,"quote_timestamp":now.isoformat()}]
    p = build_snapshot(db, contracts, {"AAA":{"last_price":110,"quote_timestamp":now.isoformat(),"leader_rank":1}}, now)
    assert p['contracts'][0]['today_value_toman'] >= 15_000_000_000
    assert not any('۷روزه' in r or '۷ روزه' in r for r in p['contracts'][0]['reasons'])
    assert all(x['long_history_days'] == 0 and x['short_history_days'] == 0 for x in p['pairs'])


def test_atomic_export_writes_schema_and_replaces_existing_file(tmp_path):
    path = tmp_path / 'market' / 'data' / 'options.json'
    atomic_export(path, {'schema_version': 1, 'status': 'unavailable', 'pairs': []})
    assert json.loads(path.read_text(encoding='utf-8'))['status'] == 'unavailable'
    atomic_export(path, {'schema_version': 1, 'status': 'no_opportunity', 'pairs': []})
    assert json.loads(path.read_text(encoding='utf-8'))['status'] == 'no_opportunity'


def test_export_real_raw_normalizes_units_depth_universe_and_staleness(tmp_path, monkeypatch):
    from market.export_options import export_from_scores_db
    db = tmp_path / 'scores.db'
    stocks = tmp_path / 'stocks.json'
    depth = tmp_path / 'depth.json'
    leader_file = tmp_path / 'event_engine.py'
    leader_file.write_text('LEADERS = ' + repr(['AAA'] + [f'L{i}' for i in range(39)]), encoding='utf-8')
    monkeypatch.setenv('OPTIONS_LEADERS_FILE', str(leader_file))
    stamp = '2026-10-03T12:30:00+00:00'
    rows = []
    for code, symbol, strike in [('2', 'ضHIGH', 1040), ('1', 'ضLOW', 850)]:
        fields = ['0'] * 26
        fields[0:4] = [code, 'ID', symbol, f'اختيارخ AAA-{strike}-1405/07/20']
        fields[7] = '100'; fields[10] = '200000000000'; fields[21] = '1000'
        rows.append(','.join(fields))
    stocks.write_text(json.dumps(rows), encoding='utf-8')
    depth.write_text(json.dumps(['1,1,1,1,120,110,10,10', '1,5,1,1,999,999,1,1', '2,1,1,1,30,20,10,10']), encoding='utf-8')
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE raw_tse_snapshots(timestamp TEXT,trading_date TEXT,stocks_path TEXT,depth_path TEXT)')
        c.execute('INSERT INTO raw_tse_snapshots VALUES (?,?,?,?)', (stamp,'2026-10-03',str(stocks),str(depth)))
        c.execute('CREATE TABLE stock_snapshots(timestamp TEXT,symbol TEXT,last_price REAL,score REAL,valid INTEGER)')
        c.executemany('INSERT INTO stock_snapshots VALUES (?,?,?,?,?)', [(stamp,'NOT_LEADER',9999,99,1),(stamp,'AAA',1000,1,1)])
    out = export_from_scores_db(db, tmp_path / 'options.json', datetime(2026,10,3,10,3,tzinfo=timezone.utc))
    assert out['status'] == 'stale'
    assert out['counts'] == {'contracts':2,'pairs':1,'eligible_pairs':0}
    low = next(c for c in out['contracts'] if c['symbol'] == 'ضLOW')
    assert (low['strike_toman'],low['ask_toman'],low['bid_toman'],low['leader_rank']) == (85,12,11,1)
    pair = out['pairs'][0]
    assert pair['underlying_price_toman'] == 100
    assert pair['long_symbol'] == 'ضLOW'
    assert pair['gross_debit_toman'] == 10
    assert pair['long_avg7d_toman'] is None


def test_missing_source_is_explicitly_unavailable(tmp_path):
    payload = build_snapshot(tmp_path / 'missing.sqlite', [], {}, datetime.now(timezone.utc))
    assert payload['status'] == 'unavailable'
    assert payload['source_at'] is None
    assert payload['pairs'] == []


def test_risk_budget_is_non_executable_without_verified_multiplier(tmp_path, monkeypatch):
    monkeypatch.setenv('OPTION_TOTAL_CAPITAL_TOMAN', '5000000000')
    payload = build_snapshot(tmp_path / 'missing.sqlite', [], {}, datetime.now(timezone.utc))
    assert payload['risk']['max_risk_percent'] == 1.5
    assert payload['risk']['max_strategy_loss_toman'] == 75000000
    assert payload['risk']['multiplier_verified'] is False
    assert payload['risk']['max_contracts'] is None


def test_export_records_verified_snapshot_history(tmp_path, monkeypatch):
    from market.export_options import export_from_scores_db
    db = tmp_path / 'scores.db'
    stocks = tmp_path / 'stocks.json'
    depth = tmp_path / 'depth.json'
    leader_file = tmp_path / 'event_engine.py'
    leader_file.write_text('LEADERS = ' + repr(['AAA'] + [f'L{i}' for i in range(39)]), encoding='utf-8')
    monkeypatch.setenv('OPTIONS_LEADERS_FILE', str(leader_file))
    stamp = '2026-10-03T12:30:00+00:00'
    fields = ['0'] * 26
    fields[0:4] = ['1', 'ID', 'ضLOW', 'اختيارخ AAA-850-1405/07/20']
    fields[10] = '200000000000'
    stocks.write_text(json.dumps([','.join(fields)]), encoding='utf-8')
    depth.write_text(json.dumps(['1,1,1,1,120,110,10,10']), encoding='utf-8')
    with sqlite3.connect(db) as c:
        c.execute('CREATE TABLE raw_tse_snapshots(timestamp TEXT,trading_date TEXT,stocks_path TEXT,depth_path TEXT)')
        c.execute('INSERT INTO raw_tse_snapshots VALUES (?,?,?,?)', (stamp, '2026-10-03', str(stocks), str(depth)))
        c.execute('CREATE TABLE stock_snapshots(timestamp TEXT,symbol TEXT,last_price REAL,score REAL,valid INTEGER)')
        c.execute('INSERT INTO stock_snapshots VALUES (?,?,?,?,?)', (stamp, 'AAA', 1000, 1, 1))
    out = export_from_scores_db(db, tmp_path / 'options.json', datetime(2026, 10, 3, 10, 3, tzinfo=timezone.utc))
    assert out['counts']['contracts'] == 1
    assert not (tmp_path / 'options_history.sqlite').exists()

import pytest
@pytest.mark.parametrize('value,pass_liquidity', [(15000000001,True),(15000000000,False),(14999999999,False),(None,False),(float('nan'),False),(float('inf'),False),(-1,False)])
def test_today_strict_threshold_without_history(tmp_path,value,pass_liquidity):
    now=datetime(2026,10,17,8,tzinfo=timezone.utc)
    contracts=[dict(symbol='A',underlying='X',expiry='1405/08/06',strike=80,ask=25,bid=24,trade_value_toman=value,quote_timestamp=now.isoformat()),dict(symbol='B',underlying='X',expiry='1405/08/06',strike=100,ask=7,bid=6,trade_value_toman=20e9,quote_timestamp=now.isoformat())]
    p=build_snapshot(tmp_path/'missing.db',contracts,{'X':dict(last_price=100,leader_rank=1,quote_timestamp=now.isoformat())},now)
    assert p['pairs'][0]['eligible'] is pass_liquidity
    assert not any('تاریخچه' in r for r in p['pairs'][0]['reasons'])

def test_yesterday_and_stale_still_rejected(tmp_path):
    now=datetime(2026,10,17,8,tzinfo=timezone.utc)
    c=dict(symbol='A',underlying='X',expiry='1405/08/06',strike=80,ask=25,bid=24,trade_value_toman=20e9,quote_timestamp='2026-10-16T08:00:00+00:00')
    p=build_snapshot(tmp_path/'missing.db',[c],{},now)
    assert 'ارزش معاملات مربوط به امروز نیست' in p['contracts'][0]['reasons']
    assert p['status']=='stale'
