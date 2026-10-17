import sqlite3
from tests.test_publish_snapshot import make_scores_db
from market import publish_snapshot as p


def test_export_all_traded_stocks_not_just_top10(tmp_path, monkeypatch):
    c=make_scores_db(tmp_path/'scores.db');c.row_factory=sqlite3.Row
    t='2026-10-17T12:00:00+03:30'
    c.execute('INSERT INTO market_snapshots(timestamp) VALUES (?)',(t,))
    for i in range(25):
        c.execute('INSERT INTO stock_snapshots(timestamp,valid,symbol,industry,score,trade_volume) VALUES (?,?,?,?,?,?)',(t,1,f'S{i:02}',f'I{i%8}',25-i,1))
    c.execute('INSERT INTO stock_snapshots(timestamp,valid,symbol,industry,score,trade_volume) VALUES (?,?,?,?,?,?)',(t,0,'INVALID','I',99,1))
    c.execute('INSERT INTO stock_snapshots(timestamp,valid,symbol,industry,score,trade_volume) VALUES (?,?,?,?,?,?)',(t,1,'UNTRADED','I',99,0))
    monkeypatch.setattr(p,'read_leveraged',lambda *_:[])
    data=p.build_market(c)
    assert len(data['stocks'])==25
    assert len(data['top_stocks'])==10
    assert len({r['industry'] for r in data['stocks']})==8
    assert data['stocks'][0]['symbol']=='S00'
    assert data['stocks'][-1]['symbol']=='S24'
