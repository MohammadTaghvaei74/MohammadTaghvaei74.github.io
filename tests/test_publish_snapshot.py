import json
import sqlite3
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import market.publish_snapshot as publisher


def make_scores_db(path):
    conn = sqlite3.connect(path)
    conn.executescript('''
        CREATE TABLE v2_days(day TEXT PRIMARY KEY, turnover REAL, source TEXT, complete INTEGER NOT NULL);
        CREATE TABLE v2_daily_scores(day TEXT, symbol TEXT, payload TEXT, PRIMARY KEY(day, symbol));
        CREATE TABLE stock_snapshots(timestamp TEXT, valid INTEGER, symbol TEXT, industry TEXT, score REAL,
            last_pct REAL, trade_value_toman REAL, buy_queue_value_toman REAL, sell_queue_value_toman REAL,
            trade_volume REAL, trading_date TEXT);
        CREATE TABLE market_snapshots(timestamp TEXT, count INTEGER, average REAL, median REAL,
            buy_value_hmt REAL, sell_value_hmt REAL, leader_average REAL, leader_median REAL);
        CREATE TABLE group_snapshots(timestamp TEXT, group_name TEXT, count INTEGER, average REAL, median REAL,
            turnover_toman REAL, buy_value_hmt REAL, sell_value_hmt REAL, net_queue_hmt REAL);
        CREATE TABLE industry_detail_snapshots(timestamp TEXT, industry TEXT, count INTEGER, average REAL,
            median REAL, turnover_toman REAL, net_queue_hmt REAL);
        CREATE TABLE daily_market_summary(trading_date TEXT, snapshot_count INTEGER, traded_stock_count INTEGER,
            average_score REAL, median_score REAL, final_turnover_toman REAL, final_buy_value_hmt REAL,
            final_sell_value_hmt REAL, average_net_queue_hmt REAL, final_net_queue_hmt REAL, turnover_ratio_3_10 REAL);
    ''')
    return conn


def payload(last=1.0, mean=1.0):
    return json.dumps({'count': 2, 'mean': mean, 'median': 1.0, 'min': 0.0, 'max': 2.0, 'last': last})


def test_history_keeps_all_complete_days_and_checks_every_quality_field(tmp_path):
    db = tmp_path / 'scores.db'
    conn = make_scores_db(db)
    conn.executemany('INSERT INTO v2_days VALUES (?,?,?,?)', [
        ('2026-10-13', 100.0, 'verified', 1), ('2026-10-14', 200.0, 'verified', 1), ('2026-10-15', 300.0, 'partial', 0)])
    conn.executemany('INSERT INTO v2_daily_scores VALUES (?,?,?)', [
        ('2026-10-13', 'AAA', payload(last=1.0, mean=30.0)),
        ('2026-10-14', 'BBB', payload(last=1.0, mean=1.0))])
    conn.executemany('INSERT INTO stock_snapshots(trading_date,timestamp,valid,symbol,score) VALUES (?,?,?,?,?)', [
        ('2026-10-13', '2026-10-13T10:00:00+03:30', 1, 'AAA', 59.0),
        ('2026-10-13', '2026-10-13T12:00:00+03:30', 1, 'AAA', 1.0),
        ('2026-10-14', '2026-10-14T10:00:00+03:30', 1, 'BBB', 1.0)])
    conn.commit()
    history = publisher.build_history(conn)
    assert history['valid_day_count'] == 2
    assert [row['day'] for row in history['valid_days']] == ['2026-10-13', '2026-10-14']
    assert history['rows'][0]['quality'] == 'review'
    assert history['rows'][1]['quality'] == 'valid'
    assert conn.row_factory is None
    conn.close()


def test_xlsx_has_numeric_cells_and_reproducible_bytes(tmp_path):
    target = tmp_path / 'history.xlsx'
    history = {
        'valid_day_count': 1, 'symbols': ['AAA'], 'row_count': 1,
        'valid_days': [{'day': '2026-10-14', 'turnover': 123.5, 'source': 'verified'}],
        'rows': [{'day': '2026-10-14', 'symbol': 'AAA', 'count': 2, 'mean': 1.5,
                  'median': 1.0, 'min': 0.5, 'max': 2.5, 'last': 2.0, 'quality': 'valid'}],
    }
    publisher.write_xlsx(target, history)
    first = target.read_bytes()
    publisher.write_xlsx(target, history)
    second = target.read_bytes()
    assert first == second
    with zipfile.ZipFile(target) as archive:
        xml = archive.read('xl/worksheets/sheet2.xml').decode()
        score_xml = archive.read('xl/worksheets/sheet3.xml').decode()
    assert '<c r="B2"><v>123.5</v></c>' in xml
    assert '<c r="C2"><v>2</v></c>' in score_xml


def test_main_uses_event_exporter_and_explicit_environment(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setenv('BOURSE_DB', str(tmp_path / 'scores.db'))
    monkeypatch.setenv('EVENT_DB', str(tmp_path / 'events.db'))
    monkeypatch.setenv('SITE_REPO', str(tmp_path / 'site'))

    monkeypatch.setattr(publisher, 'build_market', lambda conn: {'generated_at': 't'})
    monkeypatch.setattr(publisher, 'build_history', lambda conn: {'valid_day_count': 0, 'valid_days': [], 'symbols': [], 'row_count': 0, 'rows': []})
    monkeypatch.setattr(publisher, 'export_signals', lambda db, path: calls.append((str(db), str(path))) or {'status': 'unavailable'})
    monkeypatch.setattr(publisher, 'git_publish', lambda site, paths: calls.append(('git', str(site), paths)))
    (tmp_path / 'scores.db').touch()
    (tmp_path / 'events.db').touch()
    publisher.main()
    assert calls[0][0] == str(tmp_path / 'events.db')
    assert calls[0][1].replace('\\', '/').endswith('market/data/signals.json')
    assert calls[-1][0] == 'git'


def test_dirty_unrelated_worktree_is_refused(tmp_path):
    try:
        publisher.assert_safe_worktree([' M market/app.js'])
    except publisher.UnsafeWorktreeError:
        pass
    else:
        raise AssertionError('unrelated dirty state must refuse publication')


@pytest.mark.parametrize('entry', [
    'M  market/app.js', '?? notes.txt',
    'R  market/app.js -> market/data/market.json',
    'UU market/data/signals.json', ' D market/data/signals.json',
    '?? market/data/signals.json.bak',
])
def test_unsafe_status_entries_are_refused(entry):
    with pytest.raises(publisher.UnsafeWorktreeError):
        publisher.assert_safe_worktree([entry])


def test_generated_files_are_allowed():
    publisher.assert_safe_worktree([
        ' M market/data/market.json', 'M  market/history/data/history.json',
        '?? market/data/signals.json', 'AM market/history/data/market-score-history.xlsx',
    ])


def test_git_publish_refuses_dirty_worktree_before_any_mutation(tmp_path, monkeypatch):
    from subprocess import CompletedProcess
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        assert 'status' in command, 'must not mutate an unsafe worktree'
        return CompletedProcess(command, 0, stdout=' M market/app.js\n')

    monkeypatch.setattr(publisher.subprocess, 'run', run)
    with pytest.raises(publisher.UnsafeWorktreeError):
        publisher.git_publish(tmp_path, ['market/data/signals.json'])
    assert len(calls) == 1


@pytest.mark.parametrize('diff_code', [0, 1, 2])
def test_git_publish_scopes_staging_and_checks_diff_errors(tmp_path, monkeypatch, diff_code):
    from subprocess import CalledProcessError, CompletedProcess
    calls = []
    paths = ['market/data/signals.json']

    def run(command, **kwargs):
        calls.append(command[3:])
        return CompletedProcess(command, diff_code if 'diff' in command else 0,
                                stdout=' M market/data/signals.json\n' if 'status' in command else '')

    monkeypatch.setattr(publisher.subprocess, 'run', run)
    if diff_code == 2:
        with pytest.raises(CalledProcessError):
            publisher.git_publish(tmp_path, paths)
        assert [call[0] for call in calls] == ['status', 'add', 'diff']
    else:
        assert publisher.git_publish(tmp_path, paths) is (diff_code == 1)
        assert [call[0] for call in calls] == (['status', 'add', 'diff'] +
            (['commit'] if diff_code == 1 else []) + ['pull', 'push'])
    assert calls[1] == ['add', '--', *paths]


def test_history_preserves_upstream_raw_scores_not_stale_v2_payloads(tmp_path):
    conn = make_scores_db(tmp_path / 'scores.db')
    conn.execute('INSERT INTO v2_days VALUES (?,?,?,?)', ('2026-10-14', 200.0, 'verified', 1))
    conn.execute('INSERT INTO v2_daily_scores VALUES (?,?,?)', ('2026-10-14', 'AAA', payload()))
    conn.executemany('INSERT INTO stock_snapshots(trading_date,timestamp,valid,symbol,score) VALUES (?,?,?,?,?)', [
        ('2026-10-14', '2026-10-14T10:00:00+03:30', 1, 'AAA', 2.0),
        ('2026-10-14', '2026-10-14T11:00:00+03:30', 1, 'AAA', 3.0),
        ('2026-10-14', '2026-10-14T12:00:00+03:30', 1, 'AAA', 7.0),
        ('2026-10-14', '2026-10-14T12:01:00+03:30', 0, 'AAA', 99.0),
        ('2026-10-14', '2026-10-14T12:02:00+03:30', 1, 'BBB', None),
        ('2026-10-15', '2026-10-15T10:00:00+03:30', 1, 'AAA', 9.0)])
    history = publisher.build_history(conn)
    conn.close()
    assert history['schema_version'] == 2
    assert history['rows'] == [{'day': '2026-10-14', 'symbol': 'AAA', 'source': 'stock_snapshots',
                               'count': 3, 'mean': 4.0, 'median': 3.0, 'min': 2.0, 'max': 7.0,
                               'last': 7.0, 'quality': 'valid'}]
    assert history['excluded_raw_days'] == ['2026-10-15']
    assert history['coverage'][0]['valid_snapshot_count'] == 4
    assert history['coverage'][1]['included'] is False
