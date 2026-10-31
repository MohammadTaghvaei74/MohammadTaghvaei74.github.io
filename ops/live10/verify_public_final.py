import json,hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('C:/Users/tabdeal/live10-audit')
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chrome',headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];samples=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script("window.__events=[];window.addEventListener('market:snapshot',e=>window.__events.push({at:Date.now(),source:e.detail.source,stamp:e.detail.market?.timestamp,topStockSymbol:e.detail.stocks?.[0]?.symbol,topStockScore:e.detail.stocks?.[0]?.score,marketMedian:e.detail.market?.median}));")
 page.goto('https://94-101-184-98.sslip.io/market/?remediation=final',wait_until='domcontentloaded',timeout=60000)
 for i in range(18):
  page.wait_for_timeout(5000)
  r=page.evaluate("({at:Date.now(),stamp:window.__marketLive10?.timestamp,update:document.querySelector('#lastUpdate')?.innerText,nav:performance.getEntriesByType('navigation').length,rows:document.querySelectorAll('#comprehensiveRows tr').length,table:document.querySelector('#comprehensiveRows')?.innerText,firstRow:document.querySelector('#comprehensiveRows tr')?.innerText})")
  r['table_sha256']=hashlib.sha256((r.pop('table') or '').encode()).hexdigest();samples.append(r)
 events=page.evaluate('window.__events');fastSources=sorted({e['source'] for e in events if 'fast' in e.get('source','')})
 result={'samples':samples,'events':events,'errors':errors,'fast_sources':fastSources,'assertions':{'no_js_errors':not errors,'single_fast_source':fastSources==['tsetmc-fast-live-collector'],'no_reload':all(s['nav']==1 for s in samples),'timestamps_change':len({s.get('stamp') for s in samples if s.get('stamp')})>=3,'rows_populated':all(s['rows']>700 for s in samples),'rendered_table_changed':len({s['table_sha256'] for s in samples})>1}}
 (out/'public-final.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');page.screenshot(path=str(out/'public-final.png'),full_page=True)
 print(json.dumps(result['assertions']));print('fast sources',fastSources);browser.close()
 assert all(result['assertions'].values()),result['assertions']
