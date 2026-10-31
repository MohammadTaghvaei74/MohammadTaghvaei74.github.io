"""Live numeric-filter regression; isolated Chrome, no fixtures or attached profile."""
import json
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1517, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(sys.argv[1], wait_until='domcontentloaded')
    page.wait_for_selector('#industriesGrid tr td:nth-child(8)', timeout=60000)
    page.wait_for_selector('#comprehensiveRows tr td:nth-child(13)', timeout=60000)
    operators = '[data-industry-op], #comprehensiveTable .filter-operator'
    def defaults(selector=operators):
        values = page.locator(selector).evaluate_all("els => els.map(e => ({value:e.value, options:[...e.options].map(o=>o.value), width:e.getBoundingClientRect().width}))")
        assert values and all(v['value'] == '<' and v['options'] == ['<', '=', '>'] and v['width'] > 0 for v in values), values
        return len(values)
    result = {'url': page.url, 'defaultControls': defaults()}
    for name, rows, field in [
        ('industry', '#industriesGrid tr:has(td:nth-child(8))', '[data-industry-filter="rank"][data-slot="0"]'),
        ('comprehensive', '#comprehensiveRows tr:has(td:nth-child(13))', 'input.column-filter[data-filter-key="score_position_pct"]')]:
        count = page.locator(rows).count()
        page.locator(field).fill('50')
        page.wait_for_timeout(200)
        filtered = page.locator(rows).count()
        assert 0 < filtered < count, (name, count, filtered)
        page.locator(field).fill('')
        assert page.locator(rows).count() == count
        result[name] = {'empty': count, 'lessThan50': filtered, 'cleared': page.locator(rows).count()}
    host = page.locator('#comprehensiveTable th[data-filter-key="score_position_pct"]')
    host.locator('.add-filter').click()
    defaults('#comprehensiveTable .filter-operator')
    assert page.locator('#comprehensiveRows tr:has(td:nth-child(13))').count() == result['comprehensive']['empty']
    host.locator('.extra-filter-pair input').fill('50')
    assert page.locator('#comprehensiveRows tr:has(td:nth-child(13))').count() == result['comprehensive']['lessThan50']
    page.locator('#clearComprehensiveFilters').click()
    defaults()
    assert page.locator('.extra-filter-pair').count() == 0
    assert page.locator('#comprehensiveRows tr:has(td:nth-child(13))').count() == result['comprehensive']['empty']
    second = page.locator('[data-industry-filter="rank"][data-slot="1"]')
    second.fill('50')
    assert page.locator('#industriesGrid tr:has(td:nth-child(8))').count() == result['industry']['lessThan50']
    second.fill('')
    page.locator('[data-industry-preset="money-where"]').click()
    assert page.locator('[data-industry-op="turnover"][data-slot="0"]').input_value() == '>'
    assert page.locator('[data-industry-op="rank"][data-slot="0"]').input_value() == '<'
    page.locator('[data-industry-preset="money-where"]').click()
    defaults()
    assert page.locator('#industriesGrid tr:has(td:nth-child(8))').count() == result['industry']['empty']
    if '--skip-comprehensive-preset' in sys.argv:
        comprehensive_preset = 'not tested: legacy VPS renderer lacks preset binding'
    else:
        page.locator('[data-comprehensive-preset="headline"]').click()
        assert page.locator('select[data-filter-key="avg_trade_value_toman"]').input_value() == '>'
        page.locator('#clearComprehensiveFilters').click()
        defaults()
        comprehensive_preset = 'explicit direction preserved'
    result.update(secondCondition='passed both tables', reset='passed both tables', industryPreset='explicit directions preserved', comprehensivePreset=comprehensive_preset, errors=errors)
    assert not errors, errors
    print(json.dumps(result, indent=2))
    browser.close()
