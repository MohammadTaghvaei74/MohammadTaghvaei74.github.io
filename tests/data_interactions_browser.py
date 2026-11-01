"""Local Chrome gate. Injects owned assets, never changes HTML or financial data.
Run: python tests/data_interactions_browser.py
Server must serve the repository on http://127.0.0.1:8765.
"""
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8765'

class DataInteractions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(channel='chrome', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()

    def open(self, route=''):
        self.page.goto(BASE + '/market/' + route, wait_until='domcontentloaded', timeout=90000)
        self.page.wait_for_timeout(1500)
        self.page.add_style_tag(path=str(ROOT / 'market/data-interactions.css'))
        self.page.add_script_tag(path=str(ROOT / 'market/data-interactions.js'))
        self.page.wait_for_timeout(350)

    def test_filter_toolbar(self):
        self.open()
        page = self.page
        expect(page.locator('.di-filter-toolbar')).to_have_count(1)
        sortable = page.locator('#comprehensiveTable thead tr:first-child th[data-sort-key="score"]')
        expect(sortable).to_have_attribute('aria-sort','none')
        self.assertIn(sortable.get_attribute('role'), ['button','columnheader'])
        sortable.focus(); page.keyboard.press('Enter')
        expect(sortable).to_have_attribute('aria-sort','descending')
        page.keyboard.press('Enter')
        expect(sortable).to_have_attribute('aria-sort','ascending')
        self.assertIsNone(page.locator('.industry-table thead tr:first-child th').first.get_attribute('data-sort-key'))
        page.add_script_tag(path=str(ROOT / 'market/data-interactions.js'))
        expect(page.locator('.di-filter-toolbar')).to_have_count(1)
        page.locator('.di-filter-toggle').click()
        expect(page.locator('.di-filter-toggle')).to_have_attribute('aria-expanded','true')
        score = page.locator('.di-filter-field[data-key="score"]')
        score.locator('select').first.select_option('>=')
        score.locator('input').first.fill('3.5')
        score.locator('.di-add-condition').click()
        expect(score.locator('input')).to_have_count(2)
        score.locator('select').nth(1).select_option('<=')
        score.locator('input').nth(1).fill('5')
        expect(page.locator('#comprehensiveTable th[data-filter-key="score"] input').nth(1)).to_have_value('5')
        expect(page.locator('.di-filter-chip')).to_have_count(2)
        page.locator('.di-preset-name').fill('<img src=x> دو شرط')
        page.locator('.di-preset-save').click()
        expect(page.locator('.di-preset-select option')).to_have_count(2)
        self.assertEqual(page.locator('.di-filter-toolbar img').count(),0)
        page.locator('.di-filter-reset').click()
        expect(page.locator('.di-filter-chip')).to_have_count(0)
        page.locator('.di-preset-select').select_option(index=1)
        page.locator('.di-preset-apply').click()
        expect(score.locator('input')).to_have_count(2)
        expect(score.locator('input').first).to_have_value('3.5')
        expect(score.locator('input').nth(1)).to_have_value('5')
        page.locator('.di-filter-chip').first.click()
        expect(page.locator('.di-filter-chip')).to_have_count(1)
        page.locator('.di-filter-reset').click()
        page.locator('.di-filter-field[data-key="symbol"] input').fill('NO_SUCH_SYMBOL_987654321')
        expect(page.locator('#comprehensiveRows')).to_contain_text('با این فیلتر داده‌ای پیدا نشد')
        page.locator('.di-filter-reset').click()
        page.locator('[data-comprehensive-preset="headline"]').click()
        expect(score.locator('input')).to_have_count(2)
        expect(score.locator('input').first).to_have_value('4')
        expect(score.locator('input').nth(1)).to_have_value('7')
        page.locator('.di-filter-reset').click()
        for width in (390, 768):
            page.set_viewport_size({'width':width,'height':900})
            self.assertLessEqual(page.locator('.di-filter-toolbar').bounding_box()['width'],width)
            self.assertGreaterEqual(float(page.locator('.di-filter-toolbar').evaluate('e => getComputedStyle(e).fontSize').replace('px','')),12)
        self.assertEqual(self.errors,[])

    def test_chart_legend_and_keyboard_contract(self):
        self.open()
        page = self.page
        # The chart adapter is intentionally selective: only charts with stable series selectors get controls.
        page.wait_for_timeout(800)
        legend = page.locator('#marketChart').locator('xpath=..').locator('xpath=..').locator('.di-chart-legend-control')
        if legend.count():
            self.assertGreaterEqual(legend.count(), 2)
            chart = page.locator('#marketChart')
            series = chart.locator('.chart-market')
            before = series.get_attribute('style') or ''
            legend.nth(1).click()
            expect(legend.nth(1)).to_have_attribute('aria-pressed','false')
            self.assertIn('display: none', series.get_attribute('style') or '')
            area = chart.locator('.chart-area')
            if area.count():
                self.assertIn('display: none', area.get_attribute('style') or '')
            page.set_viewport_size({'width':390,'height':900})
            page.wait_for_timeout(150)
            labels=chart.locator('.chart-label[text-anchor="middle"]')
            if labels.count()>3:
                self.assertGreater(chart.locator('.di-axis-hidden').count(),0)
                self.assertNotIn('di-axis-hidden',labels.first.get_attribute('class'))
                self.assertNotIn('di-axis-hidden',labels.last.get_attribute('class'))
            page.set_viewport_size({'width':1280,'height':900})
            page.evaluate("document.querySelector('#marketChart').insertAdjacentHTML('beforeend','<title>redraw</title>')")
            page.wait_for_timeout(100)
            self.assertIn('display: none', series.get_attribute('style') or '')
            hit = page.locator('#marketChart .chart-hit-area')
            if hit.count():
                expect(hit).to_have_attribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End Escape')
                hit.focus()
                tip=chart.locator('xpath=..').locator('.chart-tooltip-html')
                expect(tip).to_have_attribute('role','tooltip')
                expect(tip).to_contain_text('امتیاز')
                self.assertEqual(hit.get_attribute('aria-describedby'),tip.get_attribute('id'))
                text_before=tip.inner_text()
                hit.press('End')
                self.assertNotEqual(text_before,tip.inner_text())
                expect(tip).to_contain_text('ساعت')
                hit.press('Escape')
                expect(tip).to_be_hidden()
                # Replace hit node and SVG children as a renderer does; no values changed.
                chart.evaluate('(svg) => { const copy=svg.innerHTML; svg.innerHTML=copy; }')
                expect(page.locator('#marketChart .chart-hit-area')).to_have_attribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End Escape')
            page.reload(wait_until='domcontentloaded')
            page.wait_for_timeout(1200)
            page.add_style_tag(path=str(ROOT / 'market/data-interactions.css'))
            page.add_script_tag(path=str(ROOT / 'market/data-interactions.js'))
            page.wait_for_timeout(250)
            self.assertEqual(page.locator('#priceDistributionChart .di-chart-legend-control').count(),0)
        else:
            self.assertEqual(page.locator('#marketChart').get_attribute('aria-label'), 'روند درون‌روزی امتیاز لیدرها و کل بازار')
        self.assertEqual(self.errors,[])

    def test_signal_cards_and_accessible_headers(self):
        self.open('signals/')
        page = self.page
        toggle = page.locator('.di-signal-view[data-view="cards"]')
        expect(toggle).to_have_count(1)
        headers = page.locator('.signals-table thead th')
        self.assertTrue(all(headers.nth(i).get_attribute('aria-sort') is None for i in range(headers.count())))
        source_rows=page.locator('#feed tr').evaluate_all('(rows) => rows.map(r => [...r.cells].map(c => c.textContent.trim()))')
        toggle.click()
        expect(page.locator('.signals-table')).to_be_hidden()
        expect(page.locator('.di-signal-cards')).to_be_visible()
        # Unavailable/no-results remains an honest message, not a synthetic card metric.
        cards_text = page.locator('.di-signal-cards').inner_text()
        self.assertNotIn('confidence', cards_text.lower())
        for row in source_rows:
            for cell in row: self.assertIn(cell,cards_text)
        page.locator('#query').fill('NO_SUCH_SYMBOL_987654321')
        expect(page.locator('.di-signal-card')).to_have_count(0)
        expect(page.locator('.di-signal-cards')).to_contain_text('امروز هنوز سیگنالی')
        page.locator('#query').fill('')
        toggle = page.locator('.di-signal-view[data-view="table"]')
        toggle.click()
        expect(page.locator('.signals-table')).to_be_visible()
        self.assertEqual(self.errors,[])

if __name__ == '__main__':
    unittest.main(verbosity=2)

