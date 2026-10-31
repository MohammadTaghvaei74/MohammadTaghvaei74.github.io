import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('MARKET_URL','https://94-101-184-98.sslip.io/market/')
OUT=Path(__file__).parent
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 reports=[]
 for name,width,height in [('desktop',1440,1000),('mobile',390,844)]:
  context=browser.new_context(viewport={'width':width,'height':height},is_mobile=name=='mobile',has_touch=name=='mobile')
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE,wait_until='domcontentloaded')
  nav=page.locator('.main-nav').first
  assert nav.get_by_text('تاریخچه',exact=True).count()==1, 'Missing persistent history top tab'
  original=nav.locator('a').all_text_contents()
  nav.get_by_text('تاریخچه',exact=True).click()
  assert page.url.endswith('#history')
  frame=page.frame_locator('#median-history-frame')
  frame.locator('.candle-mark').first.wait_for()
  assert frame.locator('.sample-mark').count()>0
  assert not page.locator('main#overview').is_visible()
  assert nav.is_visible()
  if name=='mobile':
   assert not page.locator('.mobile-nav').is_visible(), 'Legacy bottom nav obscures embedded controls'
  frame.locator('.candle-mark').first.click()
  assert 'بسته:' in frame.locator('#candle-tip').inner_text()
  frame.locator('.sample-mark').first.click()
  assert 'امتیاز:' in frame.locator('#line-tip').inner_text()
  day=frame.locator('#day option').last.get_attribute('value')
  frame.locator('#day').select_option(day)
  for series in ['market','leaders','both']:
   frame.locator('#series').select_option(series)
   assert frame.locator('.sample-mark').count()>0
  counts={}
  for interval in ['15','30','60','daily']:
   frame.locator('#frame').select_option(interval)
   counts[interval]=frame.locator('.candle-mark').count()
   assert counts[interval]>0
  frame.locator('#day').select_option('all')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Outer horizontal overflow'
  page.evaluate('window.scrollTo(0,0)')
  page.wait_for_timeout(250)
  assert nav.bounding_box()['y'] < 100
  page.screenshot(path=str(OUT/f'history-tab-{name}.png'),full_page=True)
  page.screenshot(path=str(OUT/f'history-tab-{name}-viewport.png'))
  nav.get_by_text('نمای کلی',exact=True).click()
  expect(page.locator('main#overview')).to_be_visible()
  expect(page.locator('#history-tab-panel')).to_be_hidden()
  for title in ['صندوق‌ها','سهام','آپشن']:
   page.locator('.main-nav').first.get_by_text(title,exact=True).click()
   page.wait_for_load_state('domcontentloaded')
   nav=page.locator('.main-nav').first
   print('route',name,title,page.url,nav.inner_text(),flush=True)
   nav.get_by_text('تاریخچه',exact=True).wait_for(state='visible')
   for required in ['سهام','آپشن','صندوق‌ها']:
    nav.get_by_text(required,exact=True).wait_for(state='visible')
   nav.get_by_text('تاریخچه',exact=True).click()
   page.frame_locator('#median-history-frame').locator('.candle-mark').first.wait_for()
  page.reload(wait_until='domcontentloaded')
  page.frame_locator('#median-history-frame').locator('.sample-mark').first.wait_for()
  assert page.locator('.main-nav a[aria-current="page"]').inner_text()=='تاریخچه'
  assert not errors, errors
  reports.append({'viewport':name,'tabs':original,'candle_counts':counts,'console_errors':errors,'url':page.url})
  context.close()
 browser.close()
 print(json.dumps(reports,ensure_ascii=False,indent=2))
 (OUT/'history-tab-verification.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
