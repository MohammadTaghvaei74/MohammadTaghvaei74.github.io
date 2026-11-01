"""Live layout/navigation regression gate; does not mock market data.
Run: python tests/design_system_browser.py --base http://127.0.0.1:8765 --output PATH
"""
import argparse, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROUTES = ['', 'signals/', 'symbols/', 'industries/', 'options/', 'funds/', 'portfolio/', 'history/', 'median-history/']
p = argparse.ArgumentParser()
p.add_argument('--base', default='https://mohammadtaghvaei74.github.io')
p.add_argument('--output', required=True)
p.add_argument('--quick', action='store_true')
p.add_argument('--baseline', action='store_true')
args = p.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report = {'base': args.base, 'checks': [], 'failures': []}
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for width in ([390] if args.quick else [1440, 768, 390]):
        context = browser.new_context(viewport={'width': width, 'height': 1000}, device_scale_factor=1)
        for route in (['', 'history/', 'portfolio/', 'options/'] if args.quick else ROUTES):
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(args.base.rstrip('/') + '/market/' + route + '?design_qa=' + str(time.time_ns()), wait_until='domcontentloaded', timeout=90000)
            page.wait_for_timeout(4500)
            state = page.evaluate('''() => {
              const header=document.querySelector('.topbar');
              const nav=document.querySelector('.main-nav');
              const rect=el=>el?({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}):null;
              return {width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
                bodyFont:getComputedStyle(document.body).fontSize,overflow:getComputedStyle(document.body).overflowX,
                header:rect(header),links:nav?[...nav.querySelectorAll('a')].map(a=>({text:a.textContent,href:new URL(a.href).pathname+new URL(a.href).hash,current:a.getAttribute('aria-current')})):[],
                headings:[...document.querySelectorAll('h1')].map(h=>parseFloat(getComputedStyle(h).fontSize)),
                tables:document.querySelectorAll('main table').length,charts:document.querySelectorAll('main svg[role="img"]').length,
                mainText:(document.querySelector('main')?.innerText||'').length,
                observation:[...document.querySelectorAll('.observation-clock')].map(e=>({text:e.textContent,status:e.dataset.status,source:e.dataset.sourceAt})),
                marker:document.documentElement.dataset.designSystem||null};
            }''')
            failures=[]
            if state['scrollWidth'] > state['width'] + 1: failures.append('horizontal overflow')
            if not state['header'] or not state['header']['height']: failures.append('missing header')
            if len(state['links']) != 8 or len({x['href'] for x in state['links']}) != 8: failures.append('navigation must contain eight destinations')
            if sum(x['current']=='page' for x in state['links']) != 1: failures.append('exactly one current nav link')
            if any(size > 40 for size in state['headings']): failures.append('page title above 40px')
            if state['bodyFont'] != '16px': failures.append('body is not 16px')
            if state['mainText'] < 50: failures.append('blank main')
            if not args.baseline and not state['marker']: failures.append('design marker missing')
            if width <= 1100:
                nav=page.locator('.main-nav')
                if not nav.is_visible(): failures.append('mobile fixed navigation missing')
                sizes=nav.locator('a').evaluate_all('(links)=>links.map(a=>a.getBoundingClientRect().height)')
                if len(sizes) != 8: failures.append('mobile nav does not expose all eight destinations')
                if any(size<44 for size in sizes): failures.append('nav touch target below 44px')
            if errors: failures.append('page errors: '+str(errors))
            state.update(route=route or 'overview',viewport=width,errors=errors,failures=failures)
            report['checks'].append(state)
            report['failures'].extend([f'{width} {route or "overview"}: {f}' for f in failures])
            if width in (1440,390): page.screenshot(path=str(out/f'{width}-{route.strip("/") or "overview"}.png'),full_page=True)
            (out/'qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({'route':state['route'],'width':width,'scrollWidth':state['scrollWidth'],'header':state['header'],'failures':failures},ensure_ascii=False),flush=True)
            page.close()
        context.close()
    browser.close()
print(json.dumps({'checks':len(report['checks']),'failures':report['failures']},ensure_ascii=False))
raise SystemExit(1 if report['failures'] else 0)
