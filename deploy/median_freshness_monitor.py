#!/usr/bin/env python3
import argparse, json, subprocess, sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

MAX_AGE = timedelta(minutes=15)
def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))
def load(raw):
    doc=json.loads(raw)
    if not isinstance(doc, dict) or not isinstance(doc.get('generated_at'), str): raise ValueError('missing generated_at')
    if not isinstance(doc.get('coverage'), list) or not doc['coverage']: raise ValueError('missing coverage')
    if not isinstance(doc.get('points'), list) or not doc['points']: raise ValueError('missing points')
    if not any(isinstance(p, dict) and p.get('market') is not None for p in doc['points']): raise ValueError('no usable points')
    return doc

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--source', type=Path, required=True)
    ap.add_argument('--repo', type=Path, required=True)
    ap.add_argument('--ref', default='refs/canonical-publisher/main')
    args=ap.parse_args()
    now=datetime.now(timezone.utc)
    try:
        source=load((args.source/'median-history.json').read_bytes())
        source_at=stamp(source['generated_at'])
        raw=subprocess.check_output(['git','-C',str(args.repo),'show',f'{args.ref}:market/data/market-score-history.json'])
        public=load(raw)
        public_at=stamp(public['generated_at'])
        if source_at < now-MAX_AGE:
            raise ValueError(f'ALERT_MEDIAN_HISTORY_SOURCE_STALE age_seconds={int((now-source_at).total_seconds())}')
        if public_at < source_at:
            raise ValueError(f'ALERT_MEDIAN_HISTORY_PUBLIC_LAG public={public_at.isoformat()} source={source_at.isoformat()}')
    except (OSError, ValueError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f'BOURSE_CANONICAL_MEDIAN_ALERT {exc}', flush=True)
        return 1
    print(f'BOURSE_CANONICAL_MEDIAN_OK source={source_at.isoformat()} public={public_at.isoformat()} points={len(source["points"])} coverage={len(source["coverage"])}', flush=True)
    return 0
if __name__ == '__main__': sys.exit(main())
