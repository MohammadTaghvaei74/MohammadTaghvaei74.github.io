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
