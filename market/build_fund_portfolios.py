#!/usr/bin/env python3
"""Reproducible Codal XLSX equity extraction (stdlib only).

python3 market/build_fund_portfolios.py --help
Raw XLSX + manifest live outside git. Percentages are total-asset weights, never
renormalized. Unknown/ambiguous company names retain null symbol/industry.
Only visible merged-cell anchors count (Excel stores stale values under merges).
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import posixpath
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك', '01234567890123456789یک')


def norm(value):
    return re.sub(r'[\s\u200c\u200d\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00ad]+', '', str(value or '').translate(DIGITS))


def col_index(ref):
    n = 0
    for c in re.match(r'[A-Z]+', ref)[0]:
        n = n * 26 + ord(c) - 64
    return n


def workbook(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(t.text or '' for t in x.findall('.//s:t', NS)) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        styles = ET.fromstring(z.read('xl/styles.xml'))
        formats = {9: '0%', 10: '0.00%'}
        formats.update({int(x.get('numFmtId')): x.get('formatCode') for x in styles.findall('s:numFmts/s:numFmt', NS)})
        style_formats = [formats.get(int(x.get('numFmtId', '0')), '') for x in styles.findall('s:cellXfs/s:xf', NS)]
        rel = {x.get('Id'): x.get('Target') for x in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = rel[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            target = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            root = ET.fromstring(z.read(target))
            merges = []
            for merge in root.findall('s:mergeCells/s:mergeCell', NS):
                a, b = (merge.get('ref') + ':' + merge.get('ref')).split(':')[:2]
                merges.append((col_index(a), int(re.search(r'\d+', a)[0]), col_index(b), int(re.search(r'\d+', b)[0])))
            rows = {}
            for row in root.findall('s:sheetData/s:row', NS):
                rn = int(row.get('r')); cells = {}
                for c in row.findall('s:c', NS):
                    cn = col_index(c.get('r'))
                    if any(x1 <= cn <= x2 and y1 <= rn <= y2 and (cn, rn) != (x1, y1) for x1,y1,x2,y2 in merges):
                        continue
                    value = c.find('s:v', NS)
                    value = value.text if value is not None else ''
                    if c.get('t') == 's' and value:
                        value = strings[int(value)]
                    elif c.get('t') == 'inlineStr':
                        value = ''.join(x.text or '' for x in c.findall('.//s:t', NS))
                    fmt = style_formats[int(c.get('s', '0'))]
                    cells[cn] = (value or '', fmt)
                rows[rn] = cells
            yield sheet.get('name'), rows


def percentage(value, fmt):
    text = str(value).translate(DIGITS).strip().replace(',', '').replace('٫', '.')
    literal = '%' in text or '٪' in text
    text = text.replace('%', '').replace('٪', '')
    try:
        n = float(text)
    except ValueError:
        return None
    # Quoted/escaped percent characters in an Excel format are literals.
    fmt = re.sub(r'"[^"]*"|\\.', '', fmt)
    if not literal and '%' in fmt:
        n *= 100
    if not math.isfinite(n) or n < 0 or n > 100:
        raise ValueError('invalid asset percentage: ' + str(n))
    return n


def company_key(value):
    # Typographic equivalence only: preserve every letter, no fuzzy/substring,
    # legal-name stripping, abbreviation expansion or symbol inference.
    return re.sub(r'[.,،؛:()\[\]{}ـ\-–—]', '', norm(value))


def company_index(metadata):
    index = {}
    for row in metadata.values():
        info = row.get('info') or {}
        symbol = row.get('symbol') or info.get('lVal18AFC')
        industry = (info.get('sector') or {}).get('lSecVal')
        for name in [info.get('lVal30'), row.get('company')]:
            if name and symbol:
                index.setdefault(company_key(name), set()).add((symbol, industry))
                # Some Codal tables append an explicit ticker. Require BOTH the
                # complete company name and its authoritative symbol to agree.
                index.setdefault(company_key(name + '(' + symbol + ')'), set()).add((symbol, industry))
    return index


def extract(path, symbol, expected_date, index, identity_alias=None):
    holdings = []; evidence = []
    for sheet, rows in workbook(path):
        if any(k in norm(sheet) for k in ('درآمد','سپرده','کالایی','اختیار','اوراق','مشتقه')):
            continue
        top = [(r, c, v[0]) for r, cells in rows.items() if r <= 6 for c,v in cells.items() if v[0]]
        table_text = ' '.join(v for _,_,v in top)
        if 'درآمد' in norm(table_text) or not ('سرمایهگذاریدرسهام' in norm(table_text) or norm(sheet) == 'سهام'):
            continue
        header = None
        names = []
        for rn, cells in rows.items():
            if rn > 20: break
            names = [c for c,v in cells.items() if norm(v[0]) in {'نامشرکت','شرکت','نامسهام'}] or names
            weights = [c for c,v in cells.items() if 'درصد' in norm(v[0]) and 'کل' in norm(v[0]) and 'دارایی' in norm(v[0])]
            if names and weights:
                if len(names) != 1 or len(weights) != 1: raise ValueError('ambiguous header')
                header = rn, names[0], weights[0]; break
        if not header: continue
        identities = [v for r,c,v in top if r <= 3]
        identity = next((v for v in identities if norm(identity_alias or symbol) in norm(v)), None)
        if not identity: raise ValueError('workbook fund identity not verified: ' + repr(identities))
        dates = {m for _,_,v in top if 'منتهی' in v for m in re.findall(r'1[34]\d{2}/\d{2}/\d{2}', v.translate(DIGITS))}
        if len(dates) != 1:
            raise ValueError('workbook report period mismatch: ' + repr(dates))
        evidence.append({'sheet':sheet,'identity':identity,'report_date':next(iter(dates)),'header_row':header[0]})
        rn, nc, wc = header
        included_before = len(holdings)
        excluded_weight = 0.0
        for rownum,cells in rows.items():
            if rownum <= rn: continue
            name = cells.get(nc, ('',''))[0].strip(); key = norm(name)
            if not name: continue
            if key in {'جمع','جمعکل','مجموع','کل'}:
                disclosed = percentage(*cells.get(wc, ('','')))
                actual = sum(h['weight_pct'] for h in holdings[included_before:]) + excluded_weight
                evidence[-1].update(disclosed_table_total_pct=disclosed, extracted_table_total_pct=actual, excluded_non_equity_pct=excluded_weight)
                if disclosed is not None and abs(disclosed-actual) > 0.1:
                    raise ValueError('worksheet total mismatch: %s vs %s' % (disclosed, actual))
                break  # Next section can be commodities, not equities.
            if key.startswith(('سایر','توضیح','یادداشت','نقل')): continue
            if wc not in cells: continue
            weight = percentage(*cells[wc])
            if weight is None or weight == 0: continue
            if key.startswith(('ح.','صندوق')) or any(k in key for k in ('درآمد','سپرده','اختیار','اوراق','حقتقدم')):
                excluded_weight += weight
                continue
            matches = index.get(company_key(name), set())
            match = next(iter(matches)) if len(matches) == 1 else (None,None)
            holdings.append({'name':name,'symbol':match[0],'industry':match[1], 'weight_pct':weight,'source_sheet':sheet,'source_row':rownum})
    if not holdings: raise ValueError('no verified equity holdings table')
    total = sum(h['weight_pct'] for h in holdings)
    if total > 100.5: raise ValueError('equity total exceeds total assets: ' + str(total))
    return holdings, evidence


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--funds', default='/root/bourse-site/market/data/funds.json')
    ap.add_argument('--sources', default=str(Path(__file__).parent/'fund-portfolio-sources.json'))
    ap.add_argument('--metadata', default='/root/bourse-alert/metadata.json')
    ap.add_argument('--evidence', default='/root/bourse-alert/fund-portfolio-evidence')
    ap.add_argument('--output', default=str(Path(__file__).parent/'data/fund-portfolios.json'))
    args = ap.parse_args()
    base=Path(args.evidence); base.mkdir(parents=True,exist_ok=True)
    funds=json.loads(Path(args.funds).read_text())['rows']
    sources=json.loads(Path(args.sources).read_text())['rows']
    index=company_index(json.loads(Path(args.metadata).read_text()))
    discovered=json.loads((base/'discovered.json').read_text()) if (base/'discovered.json').exists() else {}
    # Explicit fund-name aliases, supported by mapped attachment + market description.
    # Never used for company/holding matching.
    aliases={'رشدی کیان':'آوای سهام کیان','آذرین':'بخشی فلزات کیمیا','فارمانی':'بخشی آرمان آتی','دارا یکم':'واسطه گری مالی یکم','هم تراز':'شاخصی هم وزن تراز','دوایکس':'سهامی اهرمی شاخصی کیان','نارنج اهرم':'سهامی اهرمی نارنج','اهرم':'اهرمی کاریزما'}
    results=[]; manifest=[]
    for fund in funds:
        symbol=fund['symbol']; source=sources.get(symbol,{})
        url=source.get('codal_portfolio_attachment_url') or source.get('portfolio_source_url')
        date=source.get('portfolio_last_update') or fund.get('report_date')
        discovery=discovered.get(symbol,{})
        if not url and len(discovery.get('excel_urls',[]))==1:
            url=discovery['excel_urls'][0]
            ds=re.findall(r'1[34]\d{2}/\d{2}/\d{2}',discovery['letter']['Title'].translate(DIGITS))
            if ds: date=ds[-1]
        out={'symbol':symbol,'name':fund.get('description') or symbol,'report_date':date.translate(DIGITS) if date else None,'source_url':url if url and '/Reports/DownloadFile.aspx?id=' in url else None,'source_label':'کدال — فایل Excel اصلی','status':'unavailable','holdings':[],'note':''}
        audit={'symbol':symbol,'url':out['source_url']}
        try:
            if not out['source_url']: raise ValueError('no exact Excel attachment: '+discovery.get('error','source unavailable'))
            path=base/(hashlib.sha256(url.encode()).hexdigest()+'.xlsx')
            if not path.exists():
                payload=urllib.request.urlopen(url,timeout=90).read()
                if not payload.startswith(b'PK'): raise ValueError('attachment is not XLSX')
                path.write_bytes(payload)
            audit.update(path=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            holdings,proof=extract(path,symbol,out['report_date'],index,aliases.get(symbol))
            out['report_date'] = proof[0]['report_date']
            out.update(status='verified',holdings=holdings,note='وزن‌ها درصد کل دارایی صندوق هستند و بازتوزیع نشده‌اند؛ صنعت و نماد نامشخص بدون حدس حفظ شده‌اند. فقط سهام؛ حق تقدم و سایر دارایی‌ها در این جدول نیستند. تاریخ از خود فایل خوانده شده؛ آخرین‌بودن گزارش تأیید نشده است.')
            audit.update(identity_date_evidence=proof,equity_weight_pct=sum(h['weight_pct'] for h in holdings),matched_count=sum(h['symbol'] is not None for h in holdings))
        except Exception as exc:
            out['note']=str(exc);audit['error']=str(exc)
        results.append(out);manifest.append(audit)
        print(symbol,out['status'],len(out['holdings']),out['note'] if out['status']!='verified' else audit['equity_weight_pct'],flush=True)
    generated=dt.datetime.now(dt.timezone.utc).isoformat()
    Path(args.output).write_text(json.dumps({'generated_at':generated,'funds':results},ensure_ascii=False,indent=2)+'\n')
    (base/'manifest.json').write_text(json.dumps({'generated_at':generated,'funds':manifest},ensure_ascii=False,indent=2)+'\n')
    print('COVERAGE',sum(f['status']=='verified' for f in results),'/',len(results))

if __name__=='__main__': main()
