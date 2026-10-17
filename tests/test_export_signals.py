import importlib
import json
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timezone

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat('2026-10-14T12:30:00+03:30').astimezone(tz or timezone.utc)
    monkeypatch.setattr(exporter(), 'datetime', FixedDateTime, raising=False)


def make_db(path):
    conn = sqlite3.connect(path)
    conn.executescript('''
        CREATE TABLE event_delivery(timestamp TEXT, event_key TEXT, message TEXT, provider_message_id TEXT);
        CREATE TABLE event_outbox(timestamp TEXT, event_key TEXT, message TEXT, status TEXT,
            provider_message_id TEXT, error TEXT, artifact_path TEXT, provider_response TEXT);
        CREATE TABLE event_health(id INTEGER, last_ok_at TEXT);
        INSERT INTO event_health VALUES (1, '2026-10-14T12:30:00+03:30');
    ''')
    return conn


def add_event(conn, timestamp='2026-10-14T12:03:00+03:30', key='leader:وبملت',
              text='📈 #سیگنال_لیدر\n📌 وبملت', message_id=7, status='sent', ok=True,
              delivery=True, response_id=None, delivery_id=None):
    response = {'ok': ok, 'result': {'message_id': response_id or message_id,
        'text': text, 'chat': {'id': 'PRIVATE-CHAT'}}}
    conn.execute('INSERT INTO event_outbox VALUES (?,?,?,?,?,?,?,?)',
        (timestamp, key, 'unformatted source', status, str(message_id), None,
         '/private/artifact.png', json.dumps(response, ensure_ascii=False)))
    if delivery:
        conn.execute('INSERT INTO event_delivery VALUES (?,?,?,?)',
            (timestamp, key, 'unformatted source', str(delivery_id or message_id)))
    conn.commit()


def exporter():
    import importlib.util
    assert importlib.util.find_spec('market.export_signals'), 'sanitized signal exporter missing'
    return importlib.import_module('market.export_signals')


def test_exact_acknowledged_telegram_text_and_public_contract(tmp_path):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn)
    conn.close()
    payload = exporter().build_payload(db)
    assert payload == {
        'schema_version': 1, 'status': 'ok', 'source': 'telegram_event_delivery',
        'generated_at': '2026-10-14T12:03:00+03:30',
        'last_signal_at': '2026-10-14T12:03:00+03:30',
        'items': [{'id': payload['items'][0]['id'], 'timestamp': '2026-10-14T12:03:00+03:30',
                   'category': 'leader', 'label': 'وبملت', 'text': '📈 #سیگنال_لیدر\n📌 وبملت',
                   'experimental': False}],
        'count': 1, 'has_more': False, 'health': {'last_ok_at': '2026-10-14T12:30:00+03:30'}}
    assert len(payload['items'][0]['id']) == 64
    assert 'PRIVATE' not in json.dumps(payload)
    assert 'artifact' not in json.dumps(payload)
    assert payload == exporter().build_payload(db)


def test_only_correlated_sent_rows_are_public_and_no_data_is_not_no_signals(tmp_path):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn, key='market:bad-status', status='uncertain', delivery=False)
    add_event(conn, timestamp='2026-10-14T12:04:00+03:30', key='market:bad-ack', response_id=9, delivery_id=8)
    conn.close()
    payload = exporter().build_payload(db)
    assert payload['status'] == 'unavailable'
    assert payload['items'] == []
    assert payload['count'] == 0
    assert payload['has_more'] is False
    assert payload['message']


def test_stale_health_keeps_historical_items_but_marks_feed_unavailable(tmp_path):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    conn.execute("UPDATE event_health SET last_ok_at=?", ('2026-10-14T11:00:00+03:30',))
    add_event(conn)
    conn.close()
    payload = exporter().build_payload(db)
    assert payload['status'] == 'unavailable'
    assert payload['count'] == 1
    assert payload['items'][0]['text'] == '📈 #سیگنال_لیدر\n📌 وبملت'
    assert payload['message']


def test_latest_100_are_deterministic_and_has_more_is_explicit(tmp_path):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    for index in range(105):
        add_event(conn, timestamp=f'2026-10-14T12:{index // 60:02d}:{index % 60:02d}+03:30',
                  key=f'market:{index:03d}', text=f'exact-{index}', message_id=index)
    conn.close()
    payload = exporter().build_payload(db)
    assert payload['status'] == 'ok'
    assert payload['count'] == 100
    assert payload['has_more'] is True
    assert payload['items'][0]['text'] == 'exact-104'
    assert payload['items'][-1]['text'] == 'exact-5'


def test_public_category_values_and_experimental_tag(tmp_path):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn, key='gap:sharp', text='🧪 نمونه آزمایشی')
    add_event(conn, timestamp='2026-10-14T12:04:00+03:30', key='allocation:foo', text='allocation')
    add_event(conn, timestamp='2026-10-14T12:05:00+03:30', key='unknown:foo', text='other')
    conn.close()
    items = exporter().build_payload(db)['items']
    assert {item['category'] for item in items} == {'pressure', 'allocation', 'other'}
    assert items[2]['experimental'] is True


def test_missing_database_is_unavailable(tmp_path):
    payload = exporter().build_payload(tmp_path / 'missing.db')
    assert payload['status'] == 'unavailable'
    assert payload['generated_at'] is None
    assert payload['last_signal_at'] is None
    assert payload['items'] == []
    assert payload['message']


@pytest.mark.parametrize('response', [[], None, True, 12, 'text', {'ok': True, 'result': []}])
def test_malformed_json_array_is_skipped_not_treated_as_healthy(tmp_path, response):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn)
    conn.execute("UPDATE event_outbox SET provider_response=?", (json.dumps(response),))
    conn.commit()
    conn.close()
    payload = exporter().build_payload(db)
    assert payload['status'] == 'unavailable'
    assert payload['items'] == []
    assert payload['count'] == 0
    assert payload['message']


@pytest.mark.parametrize('timestamp', [None, 'not-a-time', '2026-10-14T12:03:00'])
def test_invalid_signal_time_is_never_published(tmp_path, timestamp):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn, timestamp=timestamp)
    conn.close()
    result = exporter().build_payload(db)
    assert result['status'] == 'unavailable'
    assert result['items'] == []


@pytest.mark.parametrize('health_time', [None, 'invalid', '2026-10-14T12:30:00',
    '2026-10-14T12:14:59+03:30', '2026-10-14T12:35:01+03:30'])
def test_missing_invalid_old_or_future_health_is_not_healthy(tmp_path, health_time):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn)
    conn.execute('UPDATE event_health SET last_ok_at=?', (health_time,))
    conn.commit()
    conn.close()
    result = exporter().build_payload(db)
    assert result['status'] == 'unavailable'
    assert result['count'] == len(result['items']) == 1
    assert result['health']['last_ok_at'] == health_time
    assert result['message']


@pytest.mark.parametrize('timestamp', ['2026-10-12T12:03:00+03:30', '2026-10-15T12:03:00+03:30'])
def test_stale_or_future_signal_is_not_healthy_even_with_fresh_health(tmp_path, timestamp):
    db = tmp_path / 'events.db'
    conn = make_db(db)
    add_event(conn, timestamp=timestamp)
    conn.close()
    result = exporter().build_payload(db)
    assert result['status'] == 'unavailable'
    assert result['last_signal_at'] == timestamp
    assert result['items'][0]['timestamp'] == timestamp
    assert result['message']


def test_missing_source_replaces_previous_file_with_explicit_unavailable(tmp_path):
    db = tmp_path / 'events.db'
    target = tmp_path / 'signals.json'
    conn = make_db(db)
    add_event(conn)
    conn.close()
    first = exporter().export(db, target)
    assert first['status'] == 'ok'
    result = exporter().export(tmp_path / 'missing.db', target)
    assert json.loads(target.read_text(encoding='utf-8')) == result
    assert result['status'] == 'unavailable'
    assert result['items'] == []
    assert result['generated_at'] is None
    assert not (tmp_path / 'missing.db').exists()
    before = target.stat().st_mtime_ns
    assert exporter().export(tmp_path / 'missing.db', target) == result
    assert target.stat().st_mtime_ns == before
