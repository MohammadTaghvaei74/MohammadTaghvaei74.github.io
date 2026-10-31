"""Rendered acceptance probe, using a fresh isolated Chromium context."""
import json
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1]
with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={"width": 1517, "height": 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url, wait_until='domcontentloaded')
    page.wait_for_selector('#industriesGrid tr td:nth-child(8)', timeout=60000)
    result = page.evaluate('''() => {
      const table = document.querySelector('.industry-table');
      const wrap = table.closest('.table-scroll');
      return {url: location.href, columns: table.tHead.rows[0].cells.length,
        rows: table.tBodies[0].rows.length,
        width: table.getBoundingClientRect().width, available: wrap.clientWidth,
        overflow: wrap.scrollWidth - wrap.clientWidth,
        headings: document.querySelectorAll('.section-index').length,
        operators: [...new Set([...table.querySelectorAll('select option')].map(o=>o.value))],
        firstRow: [...table.tBodies[0].rows[0].cells].map(c=>c.innerText)};
    }''')
    assert result['columns'] == 8, result
    assert result['overflow'] <= 1, result
    assert result['headings'] == 0, result
    assert set(result['operators']) == {'=', '<', '>'}, result
    result['numericRows'] = page.evaluate('''() => [...document.querySelectorAll('#industriesGrid tr')].map(tr => {
      const cells = [...tr.cells];
      return {industry: cells[0].innerText, today: Number(cells[4].dataset.sortValue),
        mean: cells[5].dataset.sortValue, ratio: cells[6].dataset.sortValue,
        rendered: [cells[5].innerText, cells[6].innerText]};
    }).filter(r=>r.mean !== '')''')
    for row in result['numericRows']:
        assert abs(row['today'] / float(row['mean']) - float(row['ratio'])) < 1e-10
    result['numericCount'] = len(result['numericRows'])
    result['numericSample'] = result['numericRows'][:1]
    del result['numericRows']
    result['allOperators'] = page.locator('select.filter-operator option').evaluate_all('(options) => [...new Set(options.map(o=>o.value))]')
    assert not set(result['allOperators']) - {'=', '<', '>'}
    page.click('[data-industry-preset="money-where"]')
    assert page.locator('[data-industry-filter="rank"][data-slot="0"]').input_value() == '25'
    result['presetRank'] = 25
    result['errors'] = errors
    assert not errors, errors
    print(json.dumps(result, ensure_ascii=True, indent=2))
    browser.close()
