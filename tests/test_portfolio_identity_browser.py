"""Real-browser regressions; run: python tests/test_portfolio_identity_browser.py"""
import functools
import http.server
import json
import threading
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
KEY = 'sorena-watch-portfolio-v2'
LEGACY = 'sorena-watch-portfolio-v1'
STAMP = '2026-11-01T12:29:01.009634+03:30'
MARKET = {'timestamp': STAMP, 'market': {'median': 0}, 'stocks': [
    {'symbol': 'اروند', 'industry': 'شیمیایی', 'score': .84, 'trade_volume': 100, 'timestamp': STAMP},
    {'symbol': 'شرانل', 'industry': 'نفتی', 'score': -2.38, 'trade_volume': 100, 'timestamp': STAMP},
    {'symbol': 'سیتا', 'industry': 'سیمان', 'score': .6, 'trade_volume': 100, 'timestamp': STAMP}], 'leveraged': []}

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

class PortfolioBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/market/portfolio/'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, executable_path=r'C:/Program Files/Google/Chrome/Application/chrome.exe')

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown()

    def setUp(self):
        self.ctx = self.browser.new_context(service_workers='block')
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        def route(r):
            url = r.request.url.split('?')[0]
            payload = None
            if url.endswith('/data/market.json'): payload = MARKET
            elif url.endswith('history-manifest.json'): payload = {'symbols': {'صندوق': {'file': 'history/delayed.json'}}}
            elif url.endswith('history/delayed.json'): payload = {'rows': [[STAMP, -1.9]]}
            elif url.endswith('/data/funds.json'): payload = {'rows': []}
            elif url.endswith('/data/portfolio-special.json'): payload = {'symbols': {}}
            if payload is not None: r.fulfill(json=payload)
            elif not url.startswith('http://127.0.0.1:'): r.abort()
            else: r.continue_()
        self.ctx.route('**/*', route)

    def tearDown(self):
        self.ctx.close()
        self.assertEqual(self.errors, [])

    def load(self, holdings=None, legacy=None):
        draft = {'cash': '', 'holdings': holdings or []}
        self.ctx.add_init_script(f"localStorage.setItem({json.dumps(KEY)}, {json.dumps(json.dumps(draft))});" if legacy is None else f"localStorage.setItem({json.dumps(LEGACY)}, {json.dumps(json.dumps(legacy))});")
        self.page.goto(self.url, wait_until='domcontentloaded')
        self.page.wait_for_function("!document.querySelector('#calculatePortfolio').disabled")

    def test_restored_ids_cannot_collide_with_added_rows(self):
        self.load([{'rowId': '2', 'symbol': 'اروند', 'value': 10}, {'rowId': '3', 'symbol': 'شرانل', 'value': 20}])
        self.page.click('#addHolding')
        ids = self.page.locator('.holding-row').evaluate_all('(rows)=>rows.map(r=>r.dataset.rowId)')
        self.assertEqual(len(ids), len(set(ids)), ids)
        self.page.locator('.holding-symbol').nth(2).fill('سیتا')
        self.page.locator('.holding-value').nth(2).fill('30')
        self.page.click('#calculatePortfolio')
        self.page.wait_for_selector('.table-symbol-edit')
        self.page.locator('.table-symbol-edit').nth(2).fill('اروند')
        self.assertEqual(self.page.locator('.holding-symbol').nth(1).input_value(), 'شرانل')
        self.assertEqual(self.page.locator('.holding-symbol').nth(2).input_value(), 'اروند')

    def test_late_score_request_cannot_overwrite_newer_calculation(self):
        self.ctx.add_init_script("""
          const realFetch = window.fetch;
          window.fetch = (...args) => {
            const url = String(args[0]);
            if (url.includes('history/delayed.json')) return new Promise(resolve => setTimeout(() => resolve(realFetch(...args)), 350));
            return realFetch(...args);
          };
        """)
        self.load([{'rowId': '8', 'symbol': 'صندوق', 'value': 10}])
        self.page.click('#calculatePortfolio')
        self.page.locator('.holding-symbol').fill('اروند')
        self.page.click('#calculatePortfolio')
        self.page.wait_for_function("document.querySelector('.table-symbol-edit')?.value === 'اروند'")
        self.page.wait_for_timeout(450)
        self.assertEqual(self.page.locator('.table-symbol-edit').first.input_value(), 'اروند')

if __name__ == '__main__': unittest.main(verbosity=2)
