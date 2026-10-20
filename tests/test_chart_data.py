"""Daily chart contract; use real SQLite and both public export paths."""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market import publish_snapshot, export_snapshot
from test_publish_snapshot import make_scores_db


def seed_market(conn, day='2026-10-14'):
    conn.execute('INSERT INTO daily_market_summary(trading_date,average_score,median_score,final_turnover_toman) VALUES (?,?,?,?)', (day, 99, 88, 1234))
    conn.execute('INSERT INTO market_snapshots(timestamp) VALUES (?)', (day + 'T12:00:00+03:30',))


def add_scores(conn, day, values, time='12:00:00'):
    conn.executemany('INSERT INTO stock_snapshots(trading_date,timestamp,symbol,score,valid,trade_volume) VALUES (?,?,?,?,?,?)',
                     [(day, day + 'T' + time + '+03:30', symbol, score, valid, volume)
                      for symbol, score, valid, volume in values])


def test_both_exporters_compute_three_raw_medians_with_unequal_cohort_sizes(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)
    seed_market(conn)
    add_scores(conn, '2026-10-14', [('فولاد', 9, 1, 1), ('فملی', 11, 1, 1),
                                  ('A', 1, 1, 1), ('B', 2, 1, 1), ('C', 3, 1, 1)])
    conn.commit()
    conn.row_factory = sqlite3.Row
    published = publish_snapshot.build_market(conn)
    output = tmp_path / 'market.json'
    export_snapshot.export(str(db), str(output))
    exported = json.loads(output.read_text(encoding='utf-8'))
    assert published['daily'] == exported['daily']
    row = published['daily'][0]
    assert row['median_score'] == 3
    assert row['leader_median_score'] == 10
    assert row['rest_median_score'] == 2
    assert row['average_score'] == 99
    assert row['final_turnover_toman'] == 1234
    assert row['score_snapshot_timestamp'] == '2026-10-14T12:00:00+03:30'
    assert (row['leader_score_count'], row['rest_score_count'], row['market_score_count']) == (2, 3, 5)
    conn.close()


def test_intraday_chart_excludes_prior_days_and_pre_open_samples(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)
    seed_market(conn, '2026-10-19')
    add_scores(conn, '2026-10-18', [('فولاد', 99, 1, 1)], time='12:00:00')
    add_scores(conn, '2026-10-19', [('فولاد', 4, 1, 1), ('A', 2, 1, 1)], time='09:10:00')
    add_scores(conn, '2026-10-19', [('فولاد', 3, 1, 1), ('A', 1, 1, 1)], time='09:15:00')
    add_scores(conn, '2026-10-19', [('فولاد', 5, 1, 1), ('A', 3, 1, 1)], time='10:00:00')
    conn.commit()
    rows = publish_snapshot.load_intraday_chart_rows(conn, '2026-10-19')
    assert len(rows) == 56
    assert rows[0]['time'] == '09:05'
    assert rows[5]['time'] == '09:10'
    assert rows[5]['median_score'] == 3
    assert rows[10]['time'] == '09:15'
    assert rows[10]['median_score'] == 2
    assert rows[-1]['time'] == '10:00'
    assert rows[-1]['median_score'] == 4
    conn.close()
