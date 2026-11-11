import argparse, asyncio, json, time
from pathlib import Path
from playwright.async_api import async_playwright

async def run():
    ap=argparse.ArgumentParser(); ap.add_argument('--url',default='https://mohammadtaghvaei74.github.io/market/'); ap.add_argument('--assets'); ap.add_argument('--out',default='mobile-gate-results.json'); ap.add_argument('--browser'); ap.add_argument('--scenarios',default='blocked,hung,cdn-hung,all-failed,storage-denied,normal'); a=ap.parse_args()
    results=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True, **({'executable_path':a.browser} if a.browser else {}))
        for scenario in a.scenarios.split(','):
            context=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
            page=await context.new_page(); errors=[]; requests=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            if scenario=='storage-denied': await context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})")
            async def route(r):
                u=r.request.url; requests.append(u)
                if 'sslip.io' in u and scenario in ('blocked','hung','all-failed','storage-denied'):
                    if scenario=='hung': await asyncio.sleep(25)
                    await r.abort(); return
                if scenario=='all-failed' and '/data/' in u: await r.abort(); return
                if 'cdn.sheetjs.com' in u:
                    if scenario=='cdn-hung': await asyncio.sleep(25)
                    await r.abort(); return
                if a.assets:
                    name=u.split('?')[0].rstrip('/').split('/')[-1]
                    if u.split('?')[0].rstrip('/')==a.url.rstrip('/'): name='index.html'
                    f=Path(a.assets)/name
                    if f.exists() and f.suffix in ('.js','.html'): await r.fulfill(path=str(f)); return
                await r.continue_()
            await context.route('**/*',route)
            start=time.monotonic()
            await page.goto(a.url+'?mobile-gate='+str(time.time()),wait_until='commit')
            ok=True; failure=''
            try:
                if scenario=='all-failed': await page.locator('#dataTransportStatus[data-state="error"]').wait_for(state='visible',timeout=15000)
                else: await page.wait_for_function("document.querySelectorAll('#leaderStocks tr').length > 0 && document.querySelectorAll('#comprehensiveRows tr').length > 10",timeout=15000)
            except Exception as e: ok=False; failure=str(e)
            if scenario=='normal':
                await page.wait_for_timeout(12000)
                refreshes=sum('/data/market.json' in u and 'sslip.io' not in u for u in requests)
                if refreshes<2: ok=False; failure='No ten-second market refresh: '+str(refreshes)
            state=await page.evaluate("({leaders:document.querySelectorAll('#leaderStocks tr').length,comprehensive:document.querySelectorAll('#comprehensiveRows tr').length,status:document.querySelector('#dataTransportStatus')?.textContent,body:document.body.innerText.slice(0,1000)})")
            if scenario in ('blocked','hung','storage-denied') and ('اتصال زنده برقرار است' not in (state['status'] or '') or sum('/data/market.json' in u and 'sslip.io' not in u for u in requests)<1):
                ok=False; failure='Missing same-origin live source'
            state.update(scenario=scenario,ok=ok,seconds=round(time.monotonic()-start,2),errors=errors,failure=failure,live_requests=sum('sslip.io' in u for u in requests),same_requests=sum('/data/' in u and 'sslip.io' not in u for u in requests))
            await page.screenshot(path=str(Path(a.out).with_suffix(''))+'-'+scenario+'.png',full_page=False)
            results.append(state); print(json.dumps(state,ensure_ascii=True),flush=True)
            await context.close()
        # Cold subroutes exercise the same global wrapper, not an isolated fetch helper.
        for sub, condition in [
            ('industries/', "document.querySelectorAll('#industrySummaryRows tr').length>1"),
            ('signals/', "document.querySelector('#feedState')?.textContent.length>0 && !document.querySelector('#feedState').textContent.includes('خطا') && !document.querySelector('#feed').textContent.includes('انتظار')"),
            ('portfolio/', "['live','fallback'].includes(document.querySelector('#dataTransportStatus')?.dataset.state) && !document.body.innerText.includes('منبع: در حال')"),
            ('history/', "document.querySelectorAll('tbody tr').length>1"),
            ('options/', "document.querySelector('#options-title')?.getBoundingClientRect().width>0")]:
            context=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
            await context.route('**/*sslip.io/**',lambda r:r.abort())
            await context.route('**/cdn.sheetjs.com/**',lambda r:r.abort())
            page=await context.new_page(); errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            ok=True; failure=''
            try:
                await page.goto(a.url+sub,wait_until='domcontentloaded')
                await page.wait_for_function(condition,timeout=15000)
            except Exception as e: ok=False; failure=str(e)
            state=await page.evaluate("({rows:document.querySelectorAll('tbody tr').length,text:document.body.innerText.slice(0,1500)})")
            state.update(scenario=sub,ok=ok,errors=errors,failure=failure)
            results.append(state);print(json.dumps(state,ensure_ascii=True),flush=True)
            await context.close()
        await browser.close()
    Path(a.out).write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    raise SystemExit(0 if all(r['ok'] and not r['errors'] for r in results) else 1)
asyncio.run(run())
