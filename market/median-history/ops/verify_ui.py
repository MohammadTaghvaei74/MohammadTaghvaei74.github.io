import json
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE='https://94-101-184-98.sslip.io/market/'
out=Path(__file__).parent
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome')
 page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'median-history/',wait_until='networkidle')
 page.wait_for_selector('.candle-mark')
 print('status',page.locator('#status').inner_text())
 print('desktop',page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('select')].map(e=>({id:e.id,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),candles:document.querySelectorAll('.candle-mark').length,points:document.querySelectorAll('.sample-mark').length,rtl:getComputedStyle(document.documentElement).direction})"))
 page.locator('.candle-mark').first.hover();print('OHLC',page.locator('#candle-tip').inner_text());assert 'بیشینه:' in page.locator('#candle-tip').inner_text()
 page.screenshot(path=str(out/'history-desktop.png'),full_page=True)
 page.select_option('#day','2026-10-28');page.select_option('#frame','30')
 print('intraday candles',page.locator('.candle-mark').count());assert page.locator('.candle-mark').count()>6
 page.locator('.sample-mark').last.hover();print('sample',page.locator('#line-tip').inner_text());assert 'امتیاز:' in page.locator('#line-tip').inner_text()
 page.select_option('#series','market');assert page.locator('#line circle').count()>0
 page.select_option('#series','leaders');assert page.locator('#line circle').count()>0
 page.select_option('#series','both')
 for frame,expected in [('15',28),('30',14),('60',8)]:
  page.select_option('#frame',frame);assert page.locator('.candle-mark').count()==expected
  print('frame',frame,'candles',expected)
 page.select_option('#day','all');assert page.locator('.sample-mark').count()>40
 page.select_option('#day','2026-10-28');page.select_option('#frame','daily')
 page.set_viewport_size({'width':390,'height':844})
 print('mobile',page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('select')].map(e=>({id:e.id,width:e.getBoundingClientRect().width})),shellWidth:document.querySelector('.chart-shell').clientWidth,chartWidth:document.querySelector('svg').getBoundingClientRect().width})"))
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(out/'history-mobile.png'),full_page=True)
 page.locator('.candle-mark').first.click();assert 'بسته:' in page.locator('#candle-tip').inner_text()
 page.locator('.chart-shell').first.evaluate('(e)=>e.scrollLeft=200')
 assert page.locator('.chart-shell').first.evaluate('(e)=>e.scrollLeft')>0
 print('mobile horizontal chart scroll verified')
 mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 touch=mobile.new_page();touch.goto(BASE+'median-history/',wait_until='networkidle');touch.wait_for_selector('.candle-mark')
 touch.locator('.candle-mark').first.tap();assert 'بسته:' in touch.locator('#candle-tip').inner_text()
 assert touch.locator('#candles g[visibility="visible"]').count()==1
 print('mobile touch OHLC and both crosshair axes verified')
 mobile.close()
 page.goto(BASE,wait_until='domcontentloaded');page.wait_for_selector('.median-history-entry')
 print('dashboard link',page.locator('.median-history-entry').count(),page.locator('.median-history-entry').is_visible())
 assert page.locator('.median-history-entry').count()==1
 page.locator('.median-history-entry').click();page.wait_for_url('**/median-history/');page.wait_for_selector('.candle-mark')
 print('ERRORS',errors);assert not errors
 browser.close()
