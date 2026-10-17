"""Observed-score OHLC; stock snapshots take precedence for each symbol/day."""
import json
import math
import sqlite3
from datetime import datetime


def build_candles(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    rows, seen = [], set()
    expected = {f'{m // 60:02}:{m % 60:02}' for m in range(9 * 60, 12 * 60 + 31)}
    for table in ('stock_snapshots', 'chart_snapshots'):
        if table not in tables:
            continue
        grouped = {}
        for day, symbol, timestamp, score in conn.execute(
            f'SELECT trading_date,symbol,timestamp,score FROM {table} '
            'WHERE valid=1 AND score IS NOT NULL ORDER BY trading_date,symbol,timestamp'
        ):
            if (day, symbol) in seen or not math.isfinite(float(score)):
                continue
            grouped.setdefault((day, symbol), []).append((timestamp, float(score)))
        for (day, symbol), samples in grouped.items():
            seen.add((day, symbol))
            # Build one true minute bar first. Duplicate samples in a minute
            # are not discarded: the minute keeps first/open, high, low and
            # last/close. The daily bar is then aggregated from those bars.
            minute_bars = {}
            for timestamp, score in samples:
                minute = datetime.fromisoformat(timestamp).strftime('%H:%M')
                bar = minute_bars.setdefault(minute, {
                    'open': score, 'high': score, 'low': score, 'close': score,
                    'first_timestamp': timestamp, 'last_timestamp': timestamp,
                })
                bar['high'] = max(bar['high'], score)
                bar['low'] = min(bar['low'], score)
                if timestamp < bar['first_timestamp']:
                    bar['open'], bar['first_timestamp'] = score, timestamp
                if timestamp >= bar['last_timestamp']:
                    bar['close'], bar['last_timestamp'] = score, timestamp
            ordered_minutes = sorted(minute_bars)
            bars = [minute_bars[minute] for minute in ordered_minutes]
            minutes = set(ordered_minutes)
            rows.append(dict(day=day, symbol=symbol, open=bars[0]['open'],
                             high=max(bar['high'] for bar in bars),
                             low=min(bar['low'] for bar in bars), close=bars[-1]['close'],
                             count=len(bars), first_timestamp=bars[0]['first_timestamp'],
                             last_timestamp=bars[-1]['last_timestamp'],
                             observed_minutes=len(minutes), expected_minutes=len(expected),
                             coverage='complete' if expected.issubset(minutes) else 'partial',
                             source=table))
    rows.sort(key=lambda r: (r['day'], r['symbol']))
    return dict(schema_version=1, source='scores_history.db / stock_snapshots (chart_snapshots fallback)',
                semantics='first/max/min/last valid observed score; no interpolation or daily-summary fallback',
                row_count=len(rows), days=sorted({r['day'] for r in rows}), rows=rows)


if __name__ == '__main__':
    import sys
    conn = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
    conn.execute('PRAGMA query_only=ON')
    print(json.dumps(build_candles(conn), ensure_ascii=False, separators=(',', ':'), allow_nan=False))
