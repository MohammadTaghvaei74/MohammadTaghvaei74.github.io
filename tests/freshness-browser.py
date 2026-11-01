import json,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8931/market/'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1,service_workers='block')
 context.route('**/*94-101-184-98.sslip.io/**',lambda route:route.abort())
 page=context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url,wait_until='domcontentloaded');page.wait_for_selector('#turnoverChart .turnover-bar');page.wait_for_timeout(12000)
 results=page.evaluate('''() => ({badges:[...document.querySelectorAll('.observation-clock')].map(e=>({text:e.textContent,status:e.dataset.status,source:e.dataset.sourceAt,color:getComputedStyle(e).color,host:e.parentElement.id,svg:e.parentElement.querySelector('svg')?.id})),rows:document.querySelectorAll('tbody tr').length,transport:document.querySelector('#dataTransportStatus')?.textContent,summary:document.querySelector('#sourceStatus')?.textContent})''')
 print(json.dumps({'url':url,'errors':errors,**results},ensure_ascii=False,indent=2))
 Path('freshness-browser-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 for id,status in [('turnoverChart','fresh'),('queueChart','fresh'),('queueCountChart','fresh'),('marketChart','stale')]:
  badge=next(b for b in results['badges'] if b['svg']==id)
  assert badge['status']==status,(id,badge)
 assert results['rows']>100
 assert not errors,errors
 assert any(b['status']=='stale' and 'جدول جامع' in b['text'] for b in results['badges'])
 assert 'snapshot' not in results['transport']
 browser.close()
