"""Finalized ordinary-share turnover, in toman (not rial or HMT).

Read only v2_days' explicit completion fence and known finalization provenance.
Historical enrichment never changes the live observation/freshness timestamps.
"""
import math
from datetime import date, datetime

SOURCES = (
    'post-close MarketWatch ordinary shares; overview date verified; ',
    'persisted 12:30 MarketWatch final snapshot; ',
)


def load_completed_daily(conn, now):
    result = []
    for day, turnover, source in conn.execute(
        'SELECT day,turnover,source FROM v2_days WHERE complete=1 ORDER BY day DESC'
    ):
        try:
            trading_day = date.fromisoformat(day)
            prefix = next((p for p in SOURCES if str(source).startswith(p)), None)
            if prefix is None:
                continue
            stamp = datetime.fromisoformat(source[len(prefix):])
            value = float(turnover)
            if (stamp.tzinfo is None or stamp.date() != trading_day
                    or stamp > now or trading_day > now.date()
                    or (stamp.hour, stamp.minute) < (12, 30)
                    or not math.isfinite(value) or value < 0):
                continue
        except (TypeError, ValueError):
            continue
        result.append({'trading_date': day, 'final_turnover_toman': value,
                       'complete': True, 'source': source})
    return result


def attach_completed_daily(payload, daily):
    if not daily:
        raise ValueError('no validated completed daily turnover; preserving public artifact')
    return {**payload, 'daily': daily, 'daily_meta': {
        'source': 'scores_history.db/v2_days', 'unit': 'toman',
        'completion': 'complete=1 and recognized dated finalization source',
        'count': len(daily), 'latest_trading_date': daily[0]['trading_date'],
    }}
