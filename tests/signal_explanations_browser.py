"""Launch a new isolated browser; never attach the user's Chrome profile."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright

url=sys.argv[1]
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='chrome')
    page=browser.new_page(viewport={'width':1440,'height':1000})
    if len(sys.argv)>3:
        assert url.startswith('http://127.0.0.1:'), 'fixtures are local QA only'
        page.route('**/data/signals.json?*',lambda route:route.fulfill(path=sys.argv[3],content_type='application/json'))
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    response=page.goto(url,wait_until='domcontentloaded',timeout=60000)
    page.wait_for_function("document.querySelector('#feedState').textContent.length>0",timeout=60000)
    assert response.status==200
    headers=page.locator('.signals-table th').all_text_contents()
    assert headers==['نوع سیگنال','نماد','ساعت تریگر','توضیحات'],headers
    rows=page.locator('#feed tr:has(.explanation-cell)')
    count=rows.count()
    assert count>0, page.locator('#feedState').inner_text()
    texts=page.locator('.explanation-cell').all_text_contents()
    assert all(t.strip() for t in texts)
    assert page.locator('.main-nav a').count()==7
    assert page.evaluate("getComputedStyle(document.querySelector('.explanation-cell')).whiteSpace")=='pre-line'
    first=rows.first.inner_text()
    page.screenshot(path=str(out/'desktop.png'),full_page=False)
    page.locator('#query').fill('NO_MATCH_EXPLANATION_QA')
    assert page.locator('#feed .empty-state').get_attribute('colspan')=='4'
    page.locator('#query').fill('')
    assert rows.count()==count
    page.locator('#category').select_option('leader')
    assert page.locator('#feed td[data-category]:not([data-category=leader])').count()==0
    page.locator('#category').select_option('all')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate("Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().width>innerWidth).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]).slice(0,25)")
    assert page.evaluate("document.querySelector('.table-wrap').scrollWidth>document.querySelector('.table-wrap').clientWidth")
    page.screenshot(path=str(out/'mobile.png'),full_page=False)
    # Real UI date fence: do not mutate source rows or publish historical data.
    assert page.evaluate("ObservationSafety.todayEvents([{timestamp:'2000-01-01T10:00:00+03:30'}]).length") == 0
    assert not errors,errors
    report=dict(url=page.url,status=response.status,headers=headers,rows=count,first_row=first,errors=errors,mobile_page_overflow=False,wrapped=True)
    (out/'browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
    browser.close()
