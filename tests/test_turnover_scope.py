import pytest
import gzip
import json
import sqlite3
from datetime import datetime
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from market import daily_turnover as m


def raw(code, symbol, family, value):
    row = [''] * 26
    row[0], row[1], row[2], row[3], row[10], row[25] = code, code, symbol, symbol, str(value), family
    return ','.join(row)


def test_only_common_shares_and_all_leveraged_funds(tmp_path, monkeypatch):
    monkeypatch.setattr(m, 'RAW_DIR', tmp_path, raising=False)
    c = sqlite3.connect(':memory:')
    c.execute('CREATE TABLE v2_days(day TEXT,turnover REAL,source TEXT,complete INT)')
    c.execute('INSERT INTO v2_days VALUES (?,?,?,1)', ('2026-11-01',999999,m.SOURCES[1]+'2026-11-01T12:30:02+03:30'))
    rows = [raw('IRO1AAA','سهم','N1',1000),raw('IRO3BBB','سهمب','Z1',2000),raw('IRT1AAA','اهرمیالف','5A',3000),raw('IRT3BBB','اهرمب','TA',4000)]
    for code,sym,typ in [('IRT1CCC','سهامی','51'),('IRT3CCC','ثابت','1A'),('IRTKCCC','طلا','QS'),('IRR1CCC','سهمح','N1'),('IRO9CCC','اختیار','31'),('IRB3CCC','اوراق','I1'),('IRE9CCC','برق','E1'),('IRO1CCC','بلوک2','O1'),('IRO6CCC','تسه','M1')]:
        rows.append(raw(code,sym,typ,900000))
    with gzip.open(tmp_path/'20261101T123000_stocks.json.gz','wt') as f: json.dump(rows,f)
    result = m.load_completed_daily(c,datetime.fromisoformat('2026-11-01T18:00:00+03:30'))[0]
    assert result['final_turnover_toman'] == 1000
    assert result['stocks_turnover_toman'] == 300
    assert result['leveraged_turnover_toman'] == 700
    assert result['turnover_scope'] == 'common_stocks_plus_leveraged_funds'


@pytest.mark.parametrize('value', ['-1','NaN','Infinity','-Infinity','bad',''])
def test_invalid_eligible_value_fails_closed(value):
    with pytest.raises((ValueError, ArithmeticError)):
        m.raw_components([raw('IRO1A','سهم','N1',value),raw('IRT1A','اهرم','5A',10)])


def test_duplicate_instrument_rejected():
    row=raw('IRO1A','سهم','N1',10)
    with pytest.raises(ValueError): m.raw_components([row,row,raw('IRT1A','اهرم','5A',10)])


def test_missing_leveraged_is_not_zero():
    with pytest.raises(ValueError): m.raw_components([raw('IRO1A','سهم','N1',10)])


def test_missing_archive_and_date_fences(tmp_path, monkeypatch):
    monkeypatch.setattr(m,'RAW_DIR',tmp_path)
    c=sqlite3.connect(':memory:')
    c.execute('CREATE TABLE v2_days(day TEXT,turnover REAL,source TEXT,complete INT)')
    for day,stamp,complete in [('2026-10-28','2026-10-28T12:30:00+03:30',1),('2026-10-27','2026-10-27T12:30:00+03:30',0),('2026-10-26','2026-10-26T12:29:00+03:30',1),('2026-10-25','2026-10-24T12:30:00+03:30',1),('2026-11-02','2026-11-02T12:30:00+03:30',1)]:
        c.execute('INSERT INTO v2_days VALUES (?,?,?,?)',(day,999999,m.SOURCES[1]+stamp,complete))
    result=m.load_completed_daily(c,datetime.fromisoformat('2026-11-01T18:00:00+03:30'))
    assert len(result)==1
    assert result[0]['final_turnover_toman'] is None
    assert result[0]['complete'] is False
    verified={**result[0], 'complete':True, 'status':'verified','final_turnover_toman':123,'stocks_turnover_toman':100,'leveraged_turnover_toman':23}
    payload={'generated_at':'unchanged','stocks':[{'score':7}], 'daily':[verified]}
    enriched=m.attach_completed_daily(payload,result)
    assert enriched['daily']==[verified]
    assert enriched['stocks']==payload['stocks']
    assert enriched['generated_at']=='unchanged'
    legacy={**verified,'turnover_scope':'ordinary_shares'}
    assert m.attach_completed_daily({**payload,'daily':[legacy]},result)['daily'][0]['final_turnover_toman'] is None
