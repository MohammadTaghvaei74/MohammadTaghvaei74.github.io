"""Real DOM journey gate. No financial fixture or current-date substitution."""
import os, unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.getenv('JOURNEYS_BASE','http://127.0.0.1:8765/market/')
class Journeys(unittest.TestCase):
 def setUp(self):
  self.pw=sync_playwright().start();self.b=self.pw.chromium.launch(channel='chrome',headless=True)
  self.p=self.b.new_page(viewport={'width':390,'height':900});self.p.set_default_timeout(12000)
 def tearDown(self): self.b.close();self.pw.stop()
 def load(self,route):
  self.p.goto(BASE+route,wait_until='domcontentloaded');self.p.wait_for_timeout(500)
  if ROOT.joinpath('market/page-journeys.js').exists() and not self.p.locator('script[src*="page-journeys"]').count():
   self.p.add_script_tag(path=str(ROOT/'market/page-journeys.js'))
   self.p.add_style_tag(path=str(ROOT/'market/page-journeys.css'))
 def test_portfolio_order(self):
  self.load('portfolio/')
  self.assertTrue(self.p.evaluate('!!(document.querySelector("#addHolding").compareDocumentPosition(document.querySelector("#calculatePortfolio")) & Node.DOCUMENT_POSITION_FOLLOWING)'), 'Calculate belongs after assets, not before')
 def test_history_journey(self):
  self.load('history/')
  self.assertEqual(self.p.locator('.history-hero h1').inner_text(),'تاریخچه بازار')
  self.assertEqual(self.p.locator('.pj-history-steps li').count(),4)
  for control in ['downloadXlsx','downloadCsv','copyJson']:
   self.assertEqual(self.p.locator('.download-actions #'+control).count(),1)
  self.p.locator('#symbolInput').fill('فولاد')
  self.p.locator('#symbolInput').dispatch_event('change')
  self.assertEqual(self.p.locator('#symbolInput').input_value(),'فولاد')
  self.assertLessEqual(self.p.evaluate('document.documentElement.scrollWidth'),390)
if __name__=='__main__':unittest.main(verbosity=2)
