import json,sys
from playwright.sync_api import sync_playwright
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8931/market/'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,service_workers='block')
 context.route('**/*94-101-184-98.sslip.io/**',lambda r:r.abort())
 results=[]
 for route in ['funds/','industries/','options/','portfolio/','signals/','symbols/','history/']:
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base+route,wait_until='domcontentloaded');page.wait_for_timeout(6000)
  badges=page.locator('.observation-clock').evaluate_all('(els)=>els.map(e=>({status:e.dataset.status,text:e.textContent}))')
  result={'route':route,'badges':badges,'errors':list(errors)};results.append(result)
  print(json.dumps(result,ensure_ascii=False))
  assert badges,route+' missing shared freshness'
  assert not any('تحلیل امروز ناموجود' in b['text'] for b in badges)
  if route=='funds/':assert any(b['status']=='archive' for b in badges)
  if route in ['history/','signals/']:assert all(b['status']!='fresh' for b in badges)
  page.close()
 browser.close()
