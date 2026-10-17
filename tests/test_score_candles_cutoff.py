import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market.score_candles import build_candles


def db(rows):
    conn = sqlite3.connect(':memory:')
    conn.execute('create table stock_snapshots(trading_date text,symbol text,timestamp text,score real,valid integer)')
    conn.executemany('insert into stock_snapshots values (?,?,?,?,1)', rows)
    return conn


def test_0914_excluded_0915_included_and_ohlc_uses_filtered_interval():
    conn = db([
        ('2026-09-20', 'چفیبر', '2026-09-20T05:44:00Z', -1569),  # 09:14 Tehran
        ('2026-09-20', 'چفیبر', '2026-09-20T05:45:00Z', 10),     # 09:15 Tehran
        ('2026-09-20', 'چفیبر', '2026-09-20T05:46:00Z', 25),
        ('2026-09-20', 'چفیبر', '2026-09-20T09:00:00Z', 15),    # 12:30 Tehran, included
        ('2026-09-20', 'چفیبر', '2026-09-20T09:01:00Z', -777),   # 12:31 Tehran, outside window
    ])
    row = build_candles(conn)['rows'][0]
    assert (row['open'], row['high'], row['low'], row['close']) == (10, 25, 10, 15)
    assert row['first_timestamp'] == '2026-09-20T05:45:00Z'
    assert row['window_start'] == '09:15'
    assert row['window_end'] == '12:30'
    assert row['coverage'] == 'partial'
    assert row['coverage_basis'] == 'expected window 09:15–12:30 Asia/Tehran'


def test_timezone_normalization_and_no_post_start_samples_means_no_candle():
    conn = db([
        ('2026-09-20', 'AAA', '2026-09-20T09:14:59+03:30', 4),
        ('2026-09-20', 'AAA', '2026-09-20T05:44:59Z', 5),
    ])
    assert build_candles(conn)['rows'] == []


def test_complete_trading_day_is_distinguished_from_complete_window():
    conn = db([
        ('2026-09-20', 'AAA', f'2026-09-20T{hour:02d}:00:00+03:30', hour)
        for hour in range(9, 13)
    ])
    row = build_candles(conn)['rows'][0]
    assert row['coverage'] == 'partial'
    assert row['coverage_basis'] == 'expected window 09:15–12:30 Asia/Tehran'
    assert row['trading_day_coverage'] == 'unknown'
    assert row['observed_minutes'] == 3


def test_invalid_and_nan_samples_do_not_enter_candle():
    conn = db([
        ('2026-09-20', 'AAA', '2026-09-20T09:15:00+03:30', 1),
        ('2026-09-20', 'AAA', '2026-09-20T09:16:00+03:30', float('nan')),
    ])
    assert build_candles(conn)['rows'][0]['high'] == 1
