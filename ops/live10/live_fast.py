"""Read-only 10s market projection. No collector/history code is invoked."""
from __future__ import annotations
import copy
import statistics
from collections import defaultdict

def build_snapshot(rows, previous, observed, leaders, leveraged):
    result = copy.deepcopy(previous)
    old = {str(r.get('instrument')): r for r in previous.get('stocks', [])}
    enriched = []
    for row in rows:
        item = dict(old.get(str(row.get('instrument')), {}))
        item.update(row)
        item.update(timestamp=observed, trading_date=observed[:10])
        enriched.append(item)
    stocks = sorted([r for r in enriched if r.get('eligible_market_stock') and float(r.get('trade_volume') or 0)>0], key=lambda r:(-float(r.get('score') or 0),str(r.get('symbol'))))
    if not stocks or (old and len(stocks) < len(old)*0.8):
        raise ValueError('empty/incomplete provider universe')
    for rank,row in enumerate(stocks,1):
        row.update(score_rank=rank,score_rank_total=len(stocks),score_position_pct=round(rank/len(stocks)*100))
    leader_rows=[r for r in stocks if r.get('symbol') in leaders]
    funds=sorted([r for r in enriched if r.get('symbol') in leveraged and float(r.get('trade_volume') or 0)>0],key=lambda r:-float(r.get('score') or 0))
    def metrics(members):
        scores=[float(r.get('score') or 0) for r in members]
        return {'count':len(scores),'average':statistics.mean(scores) if scores else 0,'median':statistics.median(scores) if scores else 0}
    market=dict(previous.get('market') or {})
    market.update(metrics(stocks),timestamp=observed,buy_value_hmt=sum(float(r.get('buy_queue_value_toman') or 0) for r in stocks)/1e12,sell_value_hmt=sum(float(r.get('sell_queue_value_toman') or 0) for r in stocks)/1e12,leader_average=metrics(leader_rows)['average'],leader_median=metrics(leader_rows)['median'])
    industries=defaultdict(list)
    for row in stocks:
        if row.get('industry'): industries[row['industry']].append(row)
    industry_rows=[dict(industry=name,**metrics(members),turnover_toman=sum(float(r.get('trade_value_toman') or 0) for r in members)) for name,members in industries.items()]
    result.update(schema_version=2,source='tsetmc-live-fast-readonly',generated_at=observed,collector_observed_at=observed,market=market,stocks=stocks,top_stocks=stocks[:10],top_buy_queue=sorted(stocks,key=lambda r:-float(r.get('buy_queue_value_toman') or 0))[:10],leveraged=funds,comprehensive_stocks=stocks,groups=[dict(group_name=name,**metrics(members)) for name,members in [('کل بازار',stocks),('لیدرها',leader_rows),('اهرمی‌ها',funds)]])
    if industry_rows: result['industries']=sorted(industry_rows,key=lambda r:-r['median'])
    result['comprehensive_meta']=dict(previous.get('comprehensive_meta') or {},source=result['source'],snapshot_id=observed,expected_rows=len(stocks))
    return result


def deny_persistence(event, args):
    import os
    if event == 'sqlite3.connect' or event.startswith('subprocess.') or event in ('os.system','os.rename','os.remove','os.mkdir','os.rmdir','os.link','os.symlink','os.truncate'):
        raise PermissionError('fast worker cannot persist: '+event)
    if event == 'open':
        mode=args[1] or ''
        flags=args[2] or 0
        if any(c in mode for c in 'wax+') or flags & (os.O_WRONLY|os.O_RDWR|os.O_CREAT|os.O_TRUNC|os.O_APPEND):
            raise PermissionError('fast worker cannot write files')


def should_publish(previous_digest, digest, age, market_open):
    return market_open and -30 <= age <= 90 and digest != previous_digest


def run():
    import sys, os, time, json, hashlib, logging
    from pathlib import Path
    from datetime import datetime
    sys.dont_write_bytecode=True
    sys.addaudithook(deny_persistence)
    sys.path.insert(0,'/root/bourse-alert')
    import main
    from live_redis_publisher import publish_snapshot
    previous_digest=None
    while True:
        started=time.monotonic()
        try:
            now=datetime.now(main.TEHRAN)
            if main.is_market_open(now):
                raw,depth,meta=main.fetch_market_data_with_meta()
                digest=hashlib.sha256(json.dumps([raw,depth],separators=(',',':')).encode()).hexdigest()
                source=datetime.fromisoformat(meta['source_at'])
                now=datetime.now(main.TEHRAN)
                if should_publish(previous_digest,digest,(now-source).total_seconds(),main.is_market_open(now)):
                    baseline=json.loads(Path('/root/bourse-alert/live_market.json').read_text())
                    if (now-datetime.fromisoformat(baseline['collector_observed_at'])).total_seconds()>180:
                        raise ValueError('minute baseline stale; retaining last snapshot')
                    public=json.loads(Path('/srv/sorena/market/data/market.json').read_text())
                    public_rows={str(r.get('instrument')):r for r in public.get('stocks',[])}
                    baseline['stocks']=[dict(public_rows.get(str(r.get('instrument')),{}),**r) for r in baseline.get('stocks',[])]
                    baseline=dict(public,**baseline)
                    rows=main.parse_market_data(raw,depth)
                    payload=build_snapshot(rows,baseline,meta['received_at'],main.LEADERS,main.LEVERAGED_FUNDS)
                    payload.update(provider_source_at=meta['source_at'],provider_timestamp_kind=meta['source_timestamp_kind'],provider_digest=digest)
                    if not publish_snapshot(payload): raise RuntimeError('Redis publish failed')
                    previous_digest=digest
                    logging.info('FAST_PUBLISHED observed=%s stocks=%s duration=%.3f',payload['collector_observed_at'],len(payload['stocks']),time.monotonic()-started)
                else: logging.info('FAST_UNCHANGED_OR_STALE duration=%.3f',time.monotonic()-started)
        except Exception:
            logging.exception('FAST_FAILED retaining previous snapshot')
        time.sleep(max(0.1,10-(time.monotonic()-started)))

if __name__=='__main__': run()
