"""Integrated-theme, embedded-history and blocked-live release gate."""
import argparse,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8765');p.add_argument('--output',required=True);args=p.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
report={'base':args.base,'checks':[],'errors':[],'blocked':[]}
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True)
 for width in [1440,768,390]:
  ctx=b.new_context(viewport={'width':width,'height':1000},color_scheme='light')
  def block(route):
   report['blocked'].append(route.request.url);route.abort()
  ctx.route('**/*.sslip.io/**',block)
  ctx.route('**/94.101.184.98/**',block)
  ctx.route('**/api.tsetmc.com/**',block)
  page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
  page.goto(args.base+'/market/?design_release='+str(time.time_ns()),wait_until='domcontentloaded',timeout=90000)
  page.wait_for_timeout(6500)
  assert page.locator('#comprehensiveRows tr').count()>20
  assert page.locator('#leaderStocks tr').count()>1
  assert page.locator('#dataTransportStatus').get_attribute('data-state')=='fallback'
  assert 'ذخیره' in page.locator('#dataTransportStatus').inner_text()
  assert page.locator('.observation-clock[data-status="stale"],.observation-clock[data-status="unknown"],.observation-clock[data-status="archive"]').count()>0
  assert page.locator('.di-filter-toolbar').count()==1
  assert page.locator('[data-sorena-extras="toolbar"]').count()==1
  assert page.locator('.theme-preference').count()==1
  page.locator('.ds-appearance summary').click()
  page.locator('.theme-preference__option').filter(has=page.locator('input[value="dark"]')).click()
  expect(page.locator('html')).to_have_attribute('data-theme','dark')
  assert page.evaluate("localStorage.getItem('sorena-theme')")=='dark'
  page.reload(wait_until='domcontentloaded');page.wait_for_timeout(500)
  expect(page.locator('html')).to_have_attribute('data-theme','dark')
  page.locator('.ds-appearance summary').click()
  page.locator('.theme-preference__option').filter(has=page.locator('input[value="light"]')).click()
  page.locator('.main-nav a[data-history-tab]').click()
  frame=page.frame_locator('#median-history-frame')
  expect(frame.locator('#candles')).to_be_visible(timeout=15000)
  expect(frame.locator('.topbar')).to_be_hidden()
  dims=frame.locator('html').evaluate('(e)=>({width:e.clientWidth,scroll:e.scrollWidth})')
  assert dims['scroll']<=dims['width']+1,dims
  assert page.locator('.main-nav a[aria-current="page"]').count()==1
  assert page.locator('.main-nav a[data-history-tab]').get_attribute('aria-current')=='page'
  page.screenshot(path=str(out/f'embedded-{width}.png'),full_page=True)
  report['checks'].append({'width':width,'fallbackRows':True,'themePersisted':True,'embedded':dims})
  (out/'release.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  ctx.close()
 b.close()
assert not report['errors'],report['errors']
print(json.dumps(report,ensure_ascii=False,indent=2))
