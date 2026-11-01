import json,sys,requests
from playwright.sync_api import sync_playwright
url=sys.argv[1]
assert requests.get(url,timeout=30).status_code==200
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge')
 for mode in ['abort','pending']:
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='block')
  context.route('**/*sslip.io/**',lambda route:route.abort() if mode=='abort' else None)
  context.route('**/cdn.sheetjs.com/**',lambda route:None)
  page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url,wait_until='domcontentloaded',timeout=60000)
  page.wait_for_function("document.querySelectorAll('#turnoverChart .turnover-bar').length===20",timeout=45000)
  data=page.evaluate('''() => ({title:document.querySelector('#turnoverTitle').textContent,status:document.querySelector('#turnoverStatus').textContent,rows:document.querySelectorAll('#comprehensiveRows tr').length,bars:[...document.querySelectorAll('#turnoverChart .turnover-bar')].map(x=>({date:x.dataset.date,value:x.dataset.valueHmt,label:x.getAttribute('aria-label')})),ma:document.querySelector('#turnoverChart g').dataset})''')
  assert data['title']=='ارزش معاملات سهام و صندوق‌های اهرمی'
  assert float(data['bars'][-1]['value'])==29.8124866005911
  assert data['ma']['ma20Count']=='1'
  assert data['rows']>0
  assert not errors,errors
  print(json.dumps({'url':url,'mode':mode,'title':data['title'],'status':data['status'],'rows':data['rows'],'bar_count':len(data['bars']),'latest':data['bars'][-1],'ma':data['ma'],'errors':errors},ensure_ascii=False))
  context.close()
 browser.close()
