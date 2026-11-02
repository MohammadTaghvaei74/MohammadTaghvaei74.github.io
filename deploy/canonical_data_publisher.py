#!/usr/bin/env python3
"""Publish exact validated snapshot bytes without using any checkout's index.

No checkout/reset/rebase/add; no source writes or database access. main only.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

from datetime import datetime, timezone, timedelta

# Deliberately excludes signals (replay clock), history, health and all frontend.
CONTRACTS = {
    'market.json': ('generated_at', 'stocks'),
    'comprehensive.json': ('generated_at', 'rows'),
    'funds.json': ('generated_at', 'rows'),
    'options.json': ('generated_at', 'contracts'),
    'portfolio-special.json': ('reference_timestamp', 'symbols'),
}
CORE = ('market.json', 'comprehensive.json')
MEDIAN_MAX_AGE = timedelta(minutes=15)


def convert_median_history(raw, previous=None, now=None):
    doc = json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    if not isinstance(doc, dict) or type(doc.get('schema_version')) is not int:
        raise ValueError('median-history: missing schema version or object')
    generated = timestamp(doc.get('generated_at'))
    now = now or datetime.now(timezone.utc)
    if generated < now - MEDIAN_MAX_AGE:
        raise ValueError('median-history: source is stale')
    if previous is not None:
        previous_doc = json.loads(previous, object_pairs_hook=unique_object, parse_constant=invalid_constant)
        if generated < timestamp(previous_doc.get('generated_at')):
            raise ValueError('median-history: source timestamp regression')
    points, coverage = doc.get('points'), doc.get('coverage')
    if not isinstance(points, list) or not points or not isinstance(coverage, list) or not coverage:
        raise ValueError('median-history: missing points or coverage')
    converted = []
    for point in points:
        if not isinstance(point, dict) or not isinstance(point.get('minute'), str):
            raise ValueError('median-history: invalid point')
        if point.get('market') is not None:
            if not isinstance(point['market'], (int, float)) or isinstance(point['market'], bool):
                raise ValueError('median-history: invalid market value')
            converted.append({'minute': point['minute'], 'market': float(point['market']),
                              'market_count': int(point.get('market_count', 0)),
                              'source': 'bourse-median-history',
                              'contract': 'eligible-traded-score-median-v1'})
    if not converted:
        raise ValueError('median-history: no usable points')
    target_coverage = []
    for day in coverage:
        if not isinstance(day, dict) or not isinstance(day.get('date'), str):
            raise ValueError('median-history: invalid coverage')
        target_coverage.append({'date': day['date'],
                                'observed_rows': int(day.get('observed_minutes', 0)),
                                'observed_minutes': int(day.get('observed_minutes', 0)),
                                'expected_minutes': int(day.get('expected_minutes', 0)),
                                'complete': not bool(day.get('partial', False)),
                                'missing_ranges': day.get('missing_ranges', []),
                                'first': day.get('first'), 'last': day.get('last')})
    return {'schema_version': 2, 'generated_at': generated.isoformat(),
            'timezone': doc.get('timezone', 'Asia/Tehran'),
            'retention_calendar_days': doc.get('retention_calendar_days', 30),
            'window_start': '09:15', 'window_end': '12:30',
            'session': ['09:15', '12:30'], 'unit': 'score', 'series': 'total-market',
            'source': 'bourse-median-history', 'coverage': target_coverage,
            'dates_without_observations': doc.get('dates_without_observations', []),
            'minute_policy': 'all real median-history observations; no interpolation',
            'candle_policy': 'incomplete or gapped candles omitted; daily 09:15-close',
            'points': converted}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('missing source timestamp')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('invalid source timestamp') from exc
    if result.tzinfo is None or result > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError('naive or future source timestamp')
    return result


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError('non-finite JSON number: ' + value)


def validate(name, raw, previous=None):
    doc = json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_constant)
    clock, collection = CONTRACTS[name]
    if not isinstance(doc, dict) or type(doc.get('schema_version')) is not int:
        raise ValueError('missing schema version or object')
    observed = timestamp(doc.get(clock))
    rows = doc.get(collection)
    expected = dict if collection == 'symbols' else list
    if not isinstance(rows, expected) or not rows:
        raise ValueError('missing or empty rows')
    records = list(rows.values()) if isinstance(rows, dict) else rows
    symbols = set()
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get('symbol'), str) or not row['symbol'].strip():
            raise ValueError('invalid row identity')
        if row['symbol'] in symbols:
            raise ValueError('duplicate row identity')
        symbols.add(row['symbol'])
        if 'timestamp' in row and timestamp(row['timestamp']) > observed:
            raise ValueError('row newer than source timestamp')
    for field in ('source_at', 'collector_observed_at'):
        if field in doc:
            timestamp(doc[field])
    if previous is not None:
        old = validate(name, previous)
        if observed < timestamp(old[clock]):
            raise ValueError('source timestamp regression')
        for field in ('source_at', 'collector_observed_at'):
            if old.get(field) is not None and (doc.get(field) is None or timestamp(doc[field]) < timestamp(old[field])):
                raise ValueError(field + ' regression')
        if len(rows) < len(old[collection]) / 2:
            raise ValueError('suspicious row count collapse')
    return doc


def select_snapshots(repo, source, parent, env):
    selected, docs = {}, {}
    for name in CONTRACTS:
        try:
            raw = (source / name).read_bytes()
            old = run(repo, 'show', f'{parent}:market/data/{name}', env=env, check=False)
            doc = validate(name, raw, old.stdout if old.returncode == 0 else None)
            selected[name], docs[name] = raw, doc
        except (ValueError, OSError) as exc:
            if name in CORE:
                raise ValueError(name + ': ' + str(exc)) from exc
            print('SKIP', name, str(exc), flush=True)
    # Source writes are atomic per file, not across both files. Fail closed on
    # a mixed collection; next timer retries with a coherent pair.
    a, b = [docs[name] for name in CORE]
    if timestamp(a['generated_at']) != timestamp(b['generated_at']):
        raise ValueError('core source timestamps differ')
    if {r['symbol'] for r in a['stocks']} != {r['symbol'] for r in b['rows']}:
        raise ValueError('core symbol universes differ')
    median_path = source / 'median-history.json'
    if median_path.exists():
        previous_median = run(repo, 'show', f'{parent}:market/data/market-score-history.json', env=env, check=False)
        median_doc = convert_median_history(median_path.read_bytes(),
                                            previous_median.stdout if previous_median.returncode == 0 else None)
        selected['market-score-history.json'] = (json.dumps(median_doc, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n').encode()
    else:
        print('ALERT_MEDIAN_HISTORY_SOURCE_MISSING', flush=True)
    return selected


def run(repo, *args, env=None, data=None, check=True):
    return subprocess.run(['git', '-C', str(repo), *args], input=data,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          env=env, check=check, timeout=90)


def publish(repo, source, attempts=3):
    repo, source = Path(repo), Path(source)
    if not 1 <= attempts <= 3:
        raise ValueError('attempts must be between 1 and 3')
    with tempfile.TemporaryDirectory(prefix='canonical-index-') as temp:
        env = os.environ.copy()
        env['GIT_INDEX_FILE'] = str(Path(temp) / 'index')
        env['GIT_TERMINAL_PROMPT'] = '0'
        env.update(GIT_AUTHOR_NAME='Canonical snapshot publisher',
                   GIT_AUTHOR_EMAIL='canonical-publisher@localhost',
                   GIT_COMMITTER_NAME='Canonical snapshot publisher',
                   GIT_COMMITTER_EMAIL='canonical-publisher@localhost')
        for attempt in range(attempts):
            run(repo, 'fetch', '--no-tags', '--no-write-fetch-head', 'origin',
                '+refs/heads/main:refs/canonical-publisher/main', env=env)
            parent = run(repo, 'rev-parse', 'refs/canonical-publisher/main', env=env).stdout.decode().strip()
            snapshots = select_snapshots(repo, source, parent, env)
            run(repo, 'read-tree', parent, env=env)
            for name, raw in snapshots.items():
                blob = run(repo, 'hash-object', '-w', '--stdin', env=env, data=raw).stdout.decode().strip()
                run(repo, 'update-index', '--add', '--cacheinfo', f'100644,{blob},market/data/{name}', env=env)
            tree = run(repo, 'write-tree', env=env).stdout.decode().strip()
            if tree == run(repo, 'rev-parse', f'{parent}^{{tree}}', env=env).stdout.decode().strip():
                print('NO_CHANGE', parent, flush=True)
                return None
            commit = run(repo, 'commit-tree', tree, '-p', parent, '-m',
                         'chore(data): publish validated canonical snapshots', env=env).stdout.decode().strip()
            result = run(repo, 'push', '--porcelain', 'origin', f'{commit}:refs/heads/main', env=env, check=False)
            if result.returncode == 0:
                print('PUBLISHED', commit, flush=True)
                return commit
            output = (result.stdout + result.stderr).decode()
            if not any(marker in output for marker in ('[rejected]', 'non-fast-forward', '(fetch first)')) or attempt + 1 == attempts:
                raise RuntimeError('publication push failed: ' + output)
            print('RETRY_NON_FAST_FORWARD', attempt + 1, flush=True)
    raise RuntimeError('no publication attempts')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=Path('/srv/sorena/market/data'))
    args = parser.parse_args()
    publish(args.repo, args.source)
