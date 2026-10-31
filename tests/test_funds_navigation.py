"""Run from repository root: python3 -m unittest discover -s tests -p test_funds_navigation.py"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = ['نمای کلی', 'سیگنال‌ها', 'سهام', 'صنایع و سهام', 'آپشن', 'صندوق‌ها', 'امتیاز پرتفو']

class FundsNavigationTests(unittest.TestCase):
    def test_shared_menu_preserved_and_funds_route_distinct(self):
        pages = list((ROOT / 'market').rglob('index.html'))
        self.assertTrue((ROOT / 'market/funds/index.html') in pages)
        for page in pages:
            with self.subTest(page=page):
                text = page.read_text(encoding='utf-8')
                nav = re.search(r'<nav class="main-nav"[^>]*>(.*?)</nav>', text, re.S)
                self.assertIsNotNone(nav)
                links = re.findall(r'<a\b([^>]*)>(.*?)</a>', nav[1], re.S)
                labels = [label.strip() for _, label in links]
                if labels[3] == 'صنایع': labels[3] = 'صنایع و سهام'
                self.assertEqual(labels, LABELS)
                attrs = links[5][0]
                self.assertNotIn('#funds', attrs)
                href = re.search(r'href="([^"]+)"', attrs)[1]
                self.assertIn(href, ['/market/funds/', './', '../funds/', 'funds/'])
                if page.parent.name == 'funds':
                    self.assertIn('aria-current="page"', attrs)
    def test_legacy_anchor_redirect_is_exact_and_history_safe(self):
        text = (ROOT / 'market/index.html').read_text(encoding='utf-8')
        self.assertIn("location.hash === '#funds'", text)
        self.assertIn("location.replace('funds/' + location.search)", text)

if __name__ == '__main__':
    unittest.main()
