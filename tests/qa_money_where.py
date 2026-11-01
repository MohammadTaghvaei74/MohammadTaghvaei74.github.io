"""Isolated Chromium QA. Fixtures are explicitly synthetic; live mode never rewrites assets/data.
python tests/qa_money_where.py --mode fixtures
python tests/qa_money_where.py --mode live --out C:/Users/tabdeal/money-qa-evidence
"""
import argparse, copy, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
URL = 'https://mohammadtaghvaei74.github.io/market/#industries'
PRESET = '[data-industry-preset="money-where"]'

def launch(p):
    chrome = os.environ.get('QA_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
    return p.chromium.launch(headless=True, **({'executable_path': chrome} if Path(chrome).exists() else {}))

def controls(page):
    button = page.locator(PRESET)
    before = page.locator('#industriesGrid a').count()
    button.click()
    expect(button).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('[data-industry-filter="rank"][data-slot="0"]')).to_have_value('25')
    expect(page.locator('[data-industry-filter="turnover"][data-slot="0"]')).to_have_value('500')
    rows = page.locator('#industriesGrid tr').evaluate_all('(rows)=>rows.filter(r=>r.querySelector("a")).map(r=>({name:r.cells[0].innerText,rank:Number(r.cells[1].innerText.replace(/[۰-۹]/g,x=>"۰۱۲۳۴۵۶۷۸۹".indexOf(x)).replace(/[^0-9.]/g,"")),turnover:Number(r.cells[4].dataset.sortValue)}))')
    assert all(r['rank'] < 25 and r['turnover'] > 500e9 for r in rows), rows
    page.locator('[data-industry-filter="industry"]').fill('QA-NO-MATCH')
    expect(page.locator('#industriesGrid a')).to_have_count(0)
    page.locator('[data-industry-filter="industry"]').fill('')
    button.click()  # the preset is a toggle; second click resets its filters
    expect(button).to_have_attribute('aria-pressed', 'false')
    expect(page.locator('[data-industry-filter="rank"][data-slot="0"]')).to_have_value('')
    expect(page.locator('[data-industry-filter="turnover"][data-slot="0"]')).to_have_value('')
    expect(page.locator('#industriesGrid a')).to_have_count(before)
    return {'total': before, 'matches': rows, 'click_filter_reset': True}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--mode',choices=['fixtures','live'],default='fixtures'); ap.add_argument('--out',default=str(ROOT / 'qa-evidence')); args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True); results=[]
    with sync_playwright() as p:
        browser=launch(p)
        cases = [('session-close','2026-11-01T19:00:00+03:30','2026-11-01T12:29:01+03:30',True),('fresh','2026-11-01T10:00:00+03:30','2026-11-01T09:59:30+03:30',True),('old','2026-11-01T10:00:00+03:30','2026-10-28T12:30:00+03:30',False),('expired','2026-11-01T10:00:00+03:30','2026-11-01T09:57:00+03:30',False),('future','2026-11-01T10:00:00+03:30','2026-11-01T10:05:00+03:30',False),('unknown','2026-11-01T10:00:00+03:30',None,False),('weekend','2026-11-06T19:00:00+03:30','2026-11-04T12:29:30+03:30',True),('missed-close','2026-11-01T19:00:00+03:30','2026-11-01T12:28:00+03:30',False)] if args.mode=='fixtures' else [('normal',None,None,True),('external-blocked',None,None,True)]
        for mobile in [False,True]:
            for name,now,stamp,enabled in cases:
                label=('mobile-' if mobile else 'desktop-')+name
                context=browser.new_context(viewport={'width':390 if mobile else 1440,'height':844 if mobile else 1000},is_mobile=mobile,has_touch=mobile,service_workers='block')
                page=context.new_page(); errors=[]; console=[]
                page.on('pageerror',lambda e: errors.append(str(e)))
                page.on('console',lambda m: console.append({'type':m.type,'text':m.text}) if m.type in ['error','warning'] else None)
                if args.mode=='fixtures':
                    data=json.loads((ROOT/'market/data/market.json').read_text(encoding='utf8'))
                    data['market']['timestamp']=stamp
                    for row in data['stocks']: row['timestamp']=stamp; row.pop('source_at',None); row.pop('observed_at',None)
                    page.clock.set_fixed_time(now)
                    def route(r):
                        path=urlparse(r.request.url).path
                        if path.endswith('/data/market.json'): r.fulfill(json=data); return
                        file=ROOT/path.lstrip('/')
                        if path.endswith('/'): file=file/'index.html'
                        if file.is_file(): r.fulfill(path=str(file),content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
                        else: r.abort()
                    page.route('**/*',route)
                elif name=='external-blocked':
                    page.route('**/*',lambda r: r.abort() if urlparse(r.request.url).netloc!='mohammadtaghvaei74.github.io' else r.continue_())
                page.goto(URL,wait_until='domcontentloaded',timeout=60000)
                page.wait_for_selector('#industriesGrid',state='attached',timeout=30000)
                page.wait_for_function('document.querySelector("#industries .observation-clock")?.dataset.sourceAt !== undefined')
                if args.mode == 'live' or stamp:
                    page.wait_for_selector('#industriesGrid a', timeout=20000)
                    page.wait_for_function('Boolean(document.querySelector("#industries .observation-clock")?.dataset.sourceAt)')
                page.wait_for_timeout(500)
                button=page.locator(PRESET)
                state=page.locator('#industries .observation-clock').evaluate('(e)=>({status:e.dataset.status,source:e.dataset.sourceAt,text:e.innerText})')
                record={'case':label,'fixture':args.mode=='fixtures','badge':state,'disabled':button.is_disabled(),'errors':errors,'console':console,'scripts':page.locator('script[src]').evaluate_all('(s)=>s.map(x=>x.src)')}
                try:
                    if args.mode == 'live':
                        # Live freshness is authoritative; record current gate state and exercise controls only when enabled.
                        record['expected_enabled']=state['status']=='fresh'
                        assert button.is_enabled()==record['expected_enabled'], record
                        if button.is_enabled(): record.update(controls(page))
                        else: record['blocked_by_freshness']=True
                        if button.is_enabled(): assert record['total'] > 0, record
                        else: expect(button).to_have_attribute('aria-pressed','false')
                    else:
                        assert button.is_enabled()==enabled, record
                        if enabled: record.update(controls(page))
                        else: expect(button).to_have_attribute('aria-pressed','false')
                    assert not errors, errors
                    page.locator('#industries').scroll_into_view_if_needed()
                    page.screenshot(path=str(out/(label+'.png')))
                    record['pass']=True
                except Exception:
                    record['pass']=False; page.screenshot(path=str(out/(label+'-FAIL.png')))
                    results.append(record); (out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8'); raise
                results.append(record); print(json.dumps(record,ensure_ascii=True))
                context.close()
        browser.close()
    (out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
    print(f'PASS {len(results)} cases; evidence: {out}')
if __name__=='__main__': main()
