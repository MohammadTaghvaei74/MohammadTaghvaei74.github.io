"""Rendered route and old-day fixture regression; run against local or public base."""
import json, sys
from playwright.sync_api import sync_playwright
base = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8794/market/'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, channel='chrome')
 page=browser.new_page()
 results=[]
 for route in ['', 'industries/', 'symbols/?symbol=وبملت', '#funds', 'options/', 'portfolio/', 'signals/', 'history/']:
  page.goto(base+route,wait_until='domcontentloaded');page.wait_for_timeout(4500)
  badges=page.locator('.observation-clock').count()
  assert badges>0, (route,'missing section clocks')
  missing=page.evaluate("""() => [...document.querySelectorAll('main table, main svg[role=img], .metric-group, .score-card')].filter(e=> !e.closest('[data-observation-status]')).map(e=>e.id||e.tagName)""")
  assert not missing,(route,missing)
  results.append({'route':route,'clocks':badges,'missing':missing})
 page.route('**/data/market.json*', lambda r:r.fulfill(json={'schema_version':1,'source':'fixture','generated_at':'2099-01-01T00:00:00Z','market':{'timestamp':'2026-10-28T12:30:00+03:30'},'stocks':[],'industry_table':[{'industry':'fixture','median_score':100,'stock_count':1,'trade_value_toman':999999999999}], 'intraday':[], 'queue_intraday':[], 'queue_count_intraday':[], 'groups':[], 'leveraged':[], 'top_stocks':[], 'industries':[], 'daily':[]}))
 page.goto(base,wait_until='domcontentloaded');page.wait_for_timeout(3000)
 assert page.locator('[data-industry-preset="money-where"]').is_disabled()
 assert 'ناموجود' in page.locator('#industries').inner_text()
 assert 'به‌روز' not in page.locator('#marketState').inner_text()
 # A newer malformed response must not relabel retained DOM as fresh.
 old_clock=page.locator('#industries .observation-clock').inner_text()
 page.unroute('**/data/market.json*')
 page.route('**/data/market.json*',lambda r:r.fulfill(json={'market':{'timestamp':'2099-01-01T00:00:00Z'},'stocks':[{'timestamp':'2099-01-01T00:00:00Z'}]}))
 page.locator('#refreshButton').click();page.wait_for_timeout(1500)
 assert page.locator('#industries .observation-clock').inner_text()==old_clock
 # Intraday stale fixture, then fresh fixture and clock expiry without reload.
 page.unroute('**/data/market.json*')
 from datetime import datetime, timezone, timedelta
 def fixture(age):
  ts=(datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat()
  return {'schema_version':1,'source':'fixture','generated_at':ts,'market':{'timestamp':ts},'stocks':[{'symbol':'fixture','timestamp':ts,'score':1,'industry':'fixture'}],'industry_table':[], 'intraday':[], 'queue_intraday':[], 'queue_count_intraday':[], 'groups':[], 'leveraged':[], 'top_stocks':[], 'industries':[], 'daily':[]}
 page.route('**/data/market.json*',lambda r:r.fulfill(json=fixture(600)))
 page.goto(base,wait_until='domcontentloaded');page.wait_for_timeout(1500)
 assert page.locator('[data-industry-preset]').is_disabled()
 page.unroute('**/data/market.json*');page.route('**/data/market.json*',lambda r:r.fulfill(json=fixture(5)))
 page.goto(base,wait_until='domcontentloaded');page.wait_for_timeout(1500)
 assert page.locator('[data-industry-preset]').is_enabled()
 page.evaluate('Date.now = (()=>{const now=Date.now();return ()=>now+180000;})()')
 page.wait_for_timeout(15500)
 assert page.locator('[data-industry-preset]').is_disabled()
 assert not page.locator('#industriesGrid').is_visible()
 print(json.dumps(results,ensure_ascii=False,indent=2));print('PASS: old day, intraday stall, fresh recovery, expiry, rejected-payload provenance')
 browser.close()
