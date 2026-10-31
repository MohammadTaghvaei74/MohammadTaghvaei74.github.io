import sys
from playwright.sync_api import sync_playwright
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8794/market/'
with sync_playwright() as p:
 b=p.chromium.launch(channel='chrome',headless=True);page=b.new_page()
 page.route('**/data/market.json*',lambda r:r.fulfill(json={'schema_version':1,'source':'stale-test','generated_at':'2026-10-28T12:30:00+03:30','market':{'timestamp':'2026-10-28T12:30:00+03:30'},'stocks':[{'symbol':'fixture','timestamp':'2026-10-28T12:30:00+03:30','industry':'fixture','score':1}],'industry_table':[],'groups':[],'intraday':[],'daily':[],'leveraged':[]}))
 page.goto(base+'industries/',wait_until='networkidle')
 page.wait_for_selector('.observation-clock')
 state=page.locator('.market-state').first
 assert state.get_attribute('data-observation-health')=='stale',state.evaluate('(e)=>e.outerHTML')
 color=state.locator('i').evaluate('(e)=>getComputedStyle(e).backgroundColor')
 assert color=='rgb(190, 140, 34)',color
 print('PASS: stale source indicator amber, not healthy green');b.close()
