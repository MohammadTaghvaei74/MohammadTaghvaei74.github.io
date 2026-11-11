#!/usr/bin/env python3
"""Collect raw, verifiable monthly investment reports from Codal."""
from __future__ import annotations
import json, re, sys, time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin
import requests

DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
MONTHLY = re.compile(r'گزارش\s*فعالیت\s*ماهانه|صورت\s*وضعیت\s*پورتفوی|صورت\s*وضعیت\s*پرتفوی|پرتفوی|پورتفوی', re.I)
DATE_RE = re.compile(r'1[34]\d{2}/\d{2}/\d{2}')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 'Accept': 'application/json, text/plain, */*'}


def clean(value):
    return re.sub(r'[\s\u200c\u200d\ufeff]+', ' ', str(value or '').replace('ي','ی').replace('ك','ک')).strip()


def number(value):
    if value is None or value == '': return None
    try: return float(str(value).translate(DIGITS).replace(',', '').replace('٫','.').replace('٬',''))
    except (TypeError, ValueError): return None


def table(data, code):
    for sheet in data.get('sheets', []):
        for item in sheet.get('tables', []):
            if item.get('code') == code:
                return item
    return None


def rows_by_number(item):
    rows = {}
    for cell in (item or {}).get('cells', []):
        address = cell.get('address') or ''
        match = re.match(r'([A-Z]+)(\d+)$', address)
        if match:
            rows.setdefault(int(match.group(2)), {})[match.group(1)] = cell.get('value')
    return rows


def extract_holdings(data, other=False):
    item = table(data, 1471 if other else 1470)
    out = []
    if not item: return out
    for row_no, row in sorted(rows_by_number(item).items()):
        name = clean(row.get('A'))
        if not name or name.startswith('جمع') or name in {'سهام پذیرفته شده در بورس و فرابورس', 'سهام درج شده در بازارهای پایه فرایورس'}:
            continue
        market_value = number(row.get('L'))
        cost = number(row.get('K'))
        if market_value is None and cost is None:
            continue
        out.append({'name': name, 'market_value': market_value, 'cost': cost,
                    'ownership_pct': number(row.get('J')), 'price': number(row.get('N')),
                    'source_row': row_no, 'source_table': 1471 if other else 1470,
                    'is_unlisted': bool(other)})
    return out


def extract_summary(data):
    item = table(data, 2570)
    if not item: return {}
    rows = rows_by_number(item)
    result = {}
    labels = {10:'listed_equity', 11:'fund_units', 12:'debt_and_derivatives', 13:'other_equity', 14:'bank_deposits', 15:'real_estate', 16:'other_investments', 17:'impairment', 18:'total'}
    for row_no, key in labels.items():
        row = rows.get(row_no, {})
        result[key] = {'cost': number(row.get('B')), 'prior_cost': number(row.get('C'))}
    return result


def datasource(session, url):
    response = session.get(url, headers=UA, timeout=90)
    response.raise_for_status()
    match = re.search(r'var datasource = (\{.*?\});', response.text, re.S)
    if not match: raise ValueError('Codal datasource not found')
    return json.loads(match.group(1))


def search_latest(session, symbol):
    params = {'Symbol': symbol, 'PageNumber': 1, 'PageSize': 100}
    response = session.get('https://search.codal.ir/api/search/v2/q', params=params, headers=UA, timeout=60)
    if response.status_code != 200:
        return None, {'status':'rate_limited' if response.status_code == 429 else 'search_error', 'http_status':response.status_code}
    payload = response.json()
    letters = [x for x in payload.get('Letters', []) if MONTHLY.search(x.get('Title', ''))]
    letters.sort(key=lambda x: (max(DATE_RE.findall(x.get('Title','').translate(DIGITS)) or ['']), x.get('PublishDateTime','')), reverse=True)
    if not letters: return None, {'status':'not_found', 'total':payload.get('Total')}
    return letters[0], {'status':'found', 'total':payload.get('Total')}


def collect(symbol):
    session = requests.Session()
    try:
        letter, meta = search_latest(session, symbol)
        if not letter: return {'symbol':symbol, **meta}
        detail = urljoin('https://codal.ir', letter.get('Url') or '')
        if not detail: return {'symbol':symbol, 'status':'missing_detail'}
        base = detail + '&sheetId='
        sheet4 = datasource(session, base + '4')
        sheet5 = datasource(session, base + '5')
        summary = datasource(session, base + '2565')
        date = max(DATE_RE.findall((letter.get('Title') or '').translate(DIGITS)) or [sheet4.get('periodEndToDate')])
        return {'symbol':symbol, 'status':'verified', 'title':letter.get('Title'), 'publish_date':letter.get('PublishDateTime'),
                'report_date':date, 'detail_url':detail, 'tracing_no':letter.get('TracingNo'),
                'listed_holdings':extract_holdings(sheet4), 'unlisted_holdings':extract_holdings(sheet5, True),
                'investment_summary':extract_summary(summary), 'raw_period':sheet4.get('periodEndToDate')}
    except Exception as exc:
        return {'symbol':symbol, 'status':'error', 'error':f'{type(exc).__name__}: {exc}'}


def main():
    symbols = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['rows']
    output = Path(sys.argv[2])
    try:
        results = json.loads(output.read_text(encoding='utf-8')).get('reports', {})
    except (OSError, ValueError, TypeError):
        results = {}
    for i, row in enumerate(symbols, 1):
        symbol = row['symbol']
        if results.get(symbol, {}).get('status') in {'verified', 'not_found'}:
            continue
        result = collect(symbol)
        results[symbol] = result
        output.write_text(json.dumps({'schema_version': 1, 'generated_at': datetime.utcnow().isoformat()+'Z', 'row_count':len(symbols), 'reports':results}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        print(i, len(symbols), symbol, result.get('status'), result.get('report_date'), len(result.get('listed_holdings', [])), flush=True)
        time.sleep(2 if result.get('status') == 'verified' else 1)
    payload = {'schema_version': 1, 'generated_at': datetime.utcnow().isoformat()+'Z', 'row_count':len(symbols), 'reports':results}
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'rows':len(symbols),'verified':sum(x.get('status')=='verified' for x in results.values())},ensure_ascii=False))

if __name__ == '__main__': main()

# Deliberately not using a fallback source: missing Codal evidence remains missing.
###