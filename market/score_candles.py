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
            scores = [s[1] for s in samples]
            minutes = {datetime.fromisoformat(s[0]).strftime('%H:%M') for s in samples}
            rows.append(dict(day=day, symbol=symbol, open=scores[0], high=max(scores),
                             low=min(scores), close=scores[-1], count=len(samples),
                             first_timestamp=samples[0][0], last_timestamp=samples[-1][0],
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
