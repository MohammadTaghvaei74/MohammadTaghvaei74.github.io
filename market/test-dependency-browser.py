"""Exact rendered dependencies; fixtures are explicitly synthetic, never published data."""
import sys,json
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright
base=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8796/market/'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome'); page=browser.new_page()
 now=datetime.now(timezone.utc); ts=now.isoformat(); today=(now+timedelta(hours=3,minutes=30)).date(); old=(today-timedelta(days=3)).isoformat()
 row={'symbol':'fixture','industry':'fixture','timestamp':ts,'score':5,'score_rank':1,'score_rank_total':100,'industry_score_rank':1,'industry_score_rank_total':100,'avg_trade_value_toman':40e9,'queue_value_toman':40e9,'legal_buy_pct':50,'legal_sell_pct':50,'client_type_date':old,'client_type_status':'ok','client_type_observed_at':ts,'avg_trade_value_provenance':{'validated':True,'as_of':today.isoformat(),'window_start':(today-timedelta(days=30)).isoformat(),'window_end_exclusive':today.isoformat(),'expected_sessions':[old],'observed_sessions':[old]}}
 market={'schema_version':1,'source':'fixture','generated_at':ts,'market':{'timestamp':ts},'stocks':[row],'intraday':[],'queue_intraday':[],'queue_count_intraday':[],'groups':[],'leveraged':[],'top_stocks':[],'industries':[],'industry_table':[],'daily':[]}
 page.route('**/data/market.json*',lambda r:r.fulfill(json=market))
 page.route('**/data/comprehensive.json*',lambda r:r.fulfill(json={'rows':[row]}))
 def check(blocked):
  page.goto(base,wait_until='domcontentloaded');page.wait_for_timeout(1800)
  for name in ['headline','tomorrow-match']:
   assert page.locator('[data-comprehensive-preset="'+name+'"]').is_disabled()==blocked,(name,'dependency gate',blocked)
  assert page.locator('#downloadComprehensiveXlsx').is_disabled()==blocked
 check(True)
 print('PASS: old client session / current quote fails closed')
 row['client_type_date']=today.isoformat(); check(False)
 print('PASS: current observed client + validated historical coverage permits presets')
 market['stocks']=[json.loads(json.dumps(row))]
 row.pop('avg_trade_value_provenance');check(True)
 print('PASS: unknown historical coverage fails closed, even with fallback proof')
 row['avg_trade_value_provenance']=market['stocks'][0]['avg_trade_value_provenance']
 row.pop('legal_sell_pct');check(True)
 print('PASS: fallback legal metric cannot borrow row observation')
 candle={'day':old,'time':old+'T09:00','last_timestamp':old+'T09:00:40+03:30','open':1,'high':2,'low':0,'close':1}
 candles={'1m':[candle],'15m':[candle],'1d':[candle]}
 page.route('**/history/data/history.json*',lambda r:r.fulfill(json={'rows':[],'valid_day_count':0,'row_count':0}))
 page.route('**/symbols/data/history-manifest.json*',lambda r:r.fulfill(json={'symbols':{'fixture':{'file':'fixture.json'}}}))
 page.route('**/symbols/data/fixture.json*',lambda r:r.fulfill(json={'candles':candles}))
 page.goto(base+'symbols/?symbol=fixture',wait_until='domcontentloaded');page.wait_for_timeout(1500)
 page.locator('[data-score-timeframe="1m"]').click();page.wait_for_timeout(200)
 assert page.locator('#scoreChart .score-hit-area').count()==0
 clock=page.locator('#scoreChart > .observation-clock').inner_text()
 assert 'مشاهده‌ای در بازه انتخاب‌شده موجود نیست' in clock,clock
 print('PASS: historical 1m exists / today empty: clock explicitly has no observation')
 candle_today={**candle,'day':today.isoformat(),'time':today.isoformat()+'T09:00','last_timestamp':ts}
 candles['1m'].append(candle_today)
 page.reload(wait_until='domcontentloaded');page.wait_for_timeout(1500)
 page.locator('[data-score-timeframe="1m"]').click();page.wait_for_timeout(200)
 assert page.locator('#scoreChart .score-hit-area').count()==1
 assert page.evaluate('document.querySelector("#scoreChart").observedScorePoints.map(r=>r.last_timestamp)')==[ts]
 assert 'مشاهده‌ای در بازه انتخاب‌شده موجود نیست' not in page.locator('#scoreChart > .observation-clock').inner_text()
 print('PASS: current 1m clock uses exactly the single rendered point, excludes historical point')
 browser.close()
print('PASS dependency browser fixtures')