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


def test_intraday_chart_uses_the_0900_session_and_excludes_prior_days(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)
    seed_market(conn, '2026-10-19')
    add_scores(conn, '2026-10-18', [('فولاد', 99, 1, 1)], time='12:00:00')
    add_scores(conn, '2026-10-19', [('فولاد', 88, 1, 1), ('A', 77, 1, 1)], time='08:59:00')
    add_scores(conn, '2026-10-19', [('فولاد', 4, 1, 1), ('A', 2, 1, 1)], time='09:10:00')
    add_scores(conn, '2026-10-19', [('فولاد', 3, 1, 1), ('A', 1, 1, 1)], time='09:15:00')
    add_scores(conn, '2026-10-19', [('فولاد', 5, 1, 1), ('A', 3, 1, 1)], time='10:00:00')
    conn.commit()
    rows = publish_snapshot.load_intraday_chart_rows(conn, '2026-10-19')
    assert len(rows) == 61
    assert rows[0]['time'] == '09:00'
    assert rows[0]['median_score'] is None
    assert rows[10]['time'] == '09:10'
    assert rows[10]['median_score'] == 3
    assert rows[rows.index(next(row for row in rows if row['time'] == '10:00'))]['median_score'] == 4
    assert rows[-1]['time'] == '10:00'
    assert rows[-1]['median_score'] == 4
    conn.close()


def test_intraday_symbol_rows_are_observed_minute_bars_and_keep_missing_prices_null(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)
    add_scores(conn, '2026-10-19', [('فولاد', 2, 1, 10)], time='09:15')
    add_scores(conn, '2026-10-19', [('فولاد', 4, 1, 11)], time='09:15:45')
    add_scores(conn, '2026-10-19', [('فولاد', 6, 1, 12)], time='09:17')
    conn.commit()
    bars = publish_snapshot.load_intraday_symbol_rows(conn, '2026-10-19')
    assert [bar['time'] for bar in bars['فولاد']] == ['09:15', '09:17']
    assert [bar['score'] for bar in bars['فولاد']] == [4.0, 6.0]
    assert bars['فولاد'][0]['price_open'] is None
    conn.close()


def test_queue_count_uses_last_snapshot_per_symbol_and_counts_each_side(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)


    conn.executemany(
        'INSERT INTO stock_snapshots(trading_date,timestamp,valid,symbol,buy_queue_value_toman,sell_queue_value_toman) VALUES (?,?,?,?,?,?)',
        [
            ('2026-10-27', '2026-10-27T09:15:00+03:30', 1, 'AAA', 10, 0),
            ('2026-10-27', '2026-10-27T09:15:10+03:30', 1, 'AAA', 0, 20),
            ('2026-10-27', '2026-10-27T09:15:20+03:30', 1, 'BBB', 30, 40),
            ('2026-10-27', '2026-10-27T09:16:00+03:30', 1, 'AAA', 10, 0),
            ('2026-10-27', '2026-10-27T09:16:00+03:30', 1, 'BBB', 0, 40),
            ('2026-10-27', '2026-10-27T09:16:00+03:30', 0, 'CCC', 50, 50),
        ],
    )
    conn.commit()
    rows = publish_snapshot.load_intraday_queue_count_rows(conn, '2026-10-27')
    assert rows == [
        {'timestamp': '2026-10-27T09:15:20+03:30', 'time': '09:15', 'buy_queue_count': 1, 'sell_queue_count': 2},
        {'timestamp': '2026-10-27T09:16:00+03:30', 'time': '09:16', 'buy_queue_count': 1, 'sell_queue_count': 1},
    ]
    conn.close()
