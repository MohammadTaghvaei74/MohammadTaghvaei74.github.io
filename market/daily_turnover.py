"""Finalized ordinary shares + ALL leveraged funds, in toman.

The v2 completion fence proves the date; its legacy aggregate is NOT the value.
Recompute from the full final MarketWatch archive, not score-filtered tables.
Unknown/missing history stays unavailable and is never counted as zero.
"""
import gzip
import json
import math
import re
from decimal import Decimal
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

RAW_DIR = Path('/root/bourse-alert/raw_tse')
SCOPE = 'common_stocks_plus_leveraged_funds'
SOURCES = (
    'post-close MarketWatch ordinary shares; overview date verified; ',
    'persisted 12:30 MarketWatch final snapshot; ',
)


def raw_components(rows):
    totals = {'stocks': Decimal(0), 'leveraged': Decimal(0)}
    counts = {'stocks': 0, 'leveraged': 0}
    leveraged = []
    seen = set()
    for text in rows:
        parts = text.split(',')
        if len(parts) < 26:
            raise ValueError('incomplete MarketWatch row')
        instrument, isin, symbol, family = parts[0], parts[1], parts[2], parts[25]
        # Security-code prefix distinguishes equity from rights, energy,
        # bonds, options and funds; numeric suffixes are separate block boards.
        ordinary = isin[:4] in {'IRO1', 'IRO3', 'IRO5', 'IRO7'} and not re.search(r'[0-9۰-۹]', symbol)
        lever = isin[:4] in {'IRT1', 'IRT3'} and family in {'5A', 'TA'}
        if not (ordinary or lever):
            continue
        if instrument in seen:
            raise ValueError('duplicate eligible instrument')
        seen.add(instrument)
        amount = Decimal(parts[10]) / 10  # provider rial -> toman, exactly once
        if not amount.is_finite() or amount < 0:
            raise ValueError('invalid eligible turnover')
        group = 'stocks' if ordinary else 'leveraged'
        totals[group] += amount
        counts[group] += 1
        if lever:
            leveraged.append({'instrument': instrument, 'symbol': symbol, 'instrument_type': family, 'turnover_toman': float(amount)})
    if not all(counts.values()):
        raise ValueError('missing common-stock or leveraged universe')
    return {'final_turnover_toman': float(sum(totals.values())),
            'stocks_turnover_toman': float(totals['stocks']),
            'leveraged_turnover_toman': float(totals['leveraged']),
            'stocks_count': counts['stocks'], 'leveraged_count': counts['leveraged'],
            'leveraged_components': leveraged}


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
            if (stamp.tzinfo is None or stamp.date() != trading_day
                    or stamp > now or trading_day > now.date()
                    or (stamp.hour, stamp.minute) < (12, 30)):
                continue
        except (TypeError, ValueError):
            continue
        row = {'trading_date': day, 'final_turnover_toman': None,
               'complete': False, 'source': source, 'turnover_scope': SCOPE,
               'status': 'unavailable_final_raw_snapshot'}
        # The final 12:30 capture is fenced by the independently dated
        # finalization record. Never use 12:29 or an arbitrary latest quote.
        path = RAW_DIR / (day.replace('-', '') + 'T123000_stocks.json.gz')
        try:
            with gzip.open(path, 'rt', encoding='utf-8') as handle:
                components = raw_components(json.load(handle))
            row.update(components)
            row.update(complete=True, status='verified', raw_source=path.name,
                       source_timestamp=day+'T12:30:00+03:30')
        except (OSError, ValueError, TypeError, ArithmeticError):
            pass
        result.append(row)
    return result


def attach_completed_daily(payload, daily):
    if not daily:
        raise ValueError('no validated completed daily turnover; preserving public artifact')
    # Retain already verified components when raw retention later expires.
    previous = {r['trading_date']: r for r in payload.get('daily', [])
                if r.get('turnover_scope') == SCOPE and r.get('status') == 'verified' and r.get('complete') is True}
    daily = [previous.get(r['trading_date'], r) if not r.get('complete') else r for r in daily]
    available = [r for r in daily if r.get('complete')]
    return {**payload, 'daily': daily, 'daily_meta': {
        'source': 'scores_history.db/v2_days completion fence + raw_tse final MarketWatch',
        'unit': 'toman', 'turnover_scope': SCOPE,
        'completion': 'dated completion fence plus same-day 12:30 raw snapshot',
        'count': len(daily), 'verified_count': len(available),
        'unavailable_count': len(daily)-len(available),
        'latest_trading_date': available[0]['trading_date'] if available else None,
    }}
