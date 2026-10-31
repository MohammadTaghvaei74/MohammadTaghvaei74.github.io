"""Run: python tests/daily_turnover_browser.py URL [URL ...]. Requires Playwright Chrome."""
import sys, json, math
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    for url in [arg for arg in sys.argv[1:] if not arg.startswith('--')] or ['https://mohammadtaghvaei74.github.io/market/']:
        for mobile in (False, True):
            context = browser.new_context(viewport={'width':390 if mobile else 1440,'height':900}, has_touch=mobile, is_mobile=mobile, ignore_https_errors=True)
            page = context.new_page()
            if '--local' in sys.argv:
                from pathlib import Path
                root=Path(__file__).resolve().parents[1]/'market'
                for asset in ['app-fast-recovery-20261024-axis.js','daily-turnover.css']:
                    asset_path = root / asset
                    page.route('**/'+asset+'*', lambda route, request, asset_path=asset_path: route.fulfill(path=str(asset_path)))
            page.goto(url, wait_until='domcontentloaded', timeout=60000)
            bars = page.locator('#turnoverChart .turnover-bar')
            bars.first.wait_for(timeout=60000)
            tip = page.locator('#daily-turnover-tooltip')
            for i in range(bars.count()):
                bar = bars.nth(i)
                if mobile: bar.tap()
                else: bar.hover()
                tip.wait_for(state='visible', timeout=2000)
                assert tip.inner_text() == bar.get_attribute('aria-label')
                assert 'همت' in tip.inner_text() and 'میانگین ۵ روزه' in tip.inner_text() and 'میانگین ۲۰ روزه' in tip.inner_text()
                assert '—' in tip.inner_text() if i < 4 else True
                box=tip.bounding_box()
                assert box['x'] >= 0 and box['x']+box['width'] <= page.viewport_size['width']+1
            if not mobile:
                bars.first.focus()
                tip.wait_for(state='visible', timeout=2000)
                page.keyboard.press('Escape')
                tip.wait_for(state='hidden', timeout=2000)
            ticks=page.locator('#turnoverChart .turnover-tick').evaluate_all('(els)=>els.map(e=>({v:+e.dataset.value,text:e.textContent,y:+e.getAttribute("y")}))')
            assert len(ticks)>=3, ticks
            vals=[t['v'] for t in ticks]; step=vals[1]-vals[0]
            assert len(set(t['text'] for t in ticks))==len(ticks)
            assert all(math.isclose(vals[i]-vals[i-1],step) for i in range(1,len(vals)))
            norm=step/10**math.floor(math.log10(step))
            assert any(math.isclose(norm,n) for n in [1,2,5,10]), (step,norm)
            assert vals[-1]>=max(float(bars.nth(i).get_attribute('data-value-hmt')) for i in range(bars.count()))
            if not mobile:
                wraps=page.locator('.daily-overview-pair > section > .panel > .chart-wrap')
                assert wraps.count()==2
                a,b=[wraps.nth(i).bounding_box() for i in range(2)]
                assert abs(a['y']-b['y'])<=2 and abs(a['height']-b['height'])<2,(a,b)
            print(json.dumps({'url':url,'mobile':mobile,'bars_verified':bars.count(),'ticks':vals,'result':'PASS'},ensure_ascii=False))
            context.close()
    browser.close()
