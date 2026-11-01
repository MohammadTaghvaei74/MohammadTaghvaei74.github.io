"""Synthetic expiry fixtures, never live-data claims.
Default: full isolated candidate. --public-fixture: canonical public assets,
only market JSON/time injected. No server data is written by this test.
"""
import argparse
import copy
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from qa_money_where import launch, controls

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://mohammadtaghvaei74.github.io/market/#industries'
PRESET = '[data-industry-preset="money-where"]'
RANK = '[data-industry-filter="rank"][data-slot="0"]'
TURNOVER = '[data-industry-filter="turnover"][data-slot="0"]'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--public-fixture', action='store_true')
    ap.add_argument('--out', default=str(ROOT/'qa-expiry-evidence'))
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    market = json.loads((ROOT/'market/data/market.json').read_text(encoding='utf8'))
    results = []
    with sync_playwright() as p:
        browser = launch(p)
        for mobile in [False, True]:
            context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 900},
                                          is_mobile=mobile, has_touch=mobile, service_workers='block')
            page = context.new_page(); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            phase = {'stamp': '2026-11-01T09:59:30+03:30'}

            def route(r):
                path = urlparse(r.request.url).path
                if path.endswith('/data/market.json'):
                    data = copy.deepcopy(market); stamp = phase['stamp']
                    data['market']['timestamp'] = stamp
                    for row in data['stocks']:
                        row['timestamp'] = stamp; row.pop('source_at', None); row.pop('observed_at', None)
                    r.fulfill(json=data); return
                if args.public_fixture:
                    r.continue_(); return
                file = ROOT/path.lstrip('/')
                if path.endswith('/'): file = file/'index.html'
                if file.is_file():
                    r.fulfill(path=str(file), content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')
                else: r.abort()

            page.clock.install(time='2026-11-01T10:00:00+03:30')
            page.clock.pause_at('2026-11-01T10:00:01+03:30')
            page.route('**/*', route)
            page.goto(URL, wait_until='domcontentloaded', timeout=60000)
            page.clock.run_for(1000)
            page.wait_for_selector('#industriesGrid a', timeout=30000)
            page.clock.run_for(1000)
            page.evaluate("""() => { const e=document.createElement('p');
                e.textContent='QA SYNTHETIC FIXTURE — injected source time, not live market data';
                e.id='qaFixtureLabel';document.querySelector('#industries').prepend(e); }""")
            button = page.locator(PRESET); total = page.locator('#industriesGrid a').count()
            button.click(); expect(button).to_have_attribute('aria-pressed', 'true')
            filtered = page.locator('#industriesGrid a').count()
            assert 0 < filtered < total, (total, filtered)
            # Advance real application timers: no manual invocation of paint or expiry handler.
            page.clock.fast_forward(45000)
            page.clock.run_for(100)
            expect(button).to_be_disabled(); expect(button).to_have_attribute('aria-pressed', 'false')
            expect(page.locator('#industriesGrid a')).to_have_count(total)
            expect(page.locator('#industriesGrid')).to_have_attribute('data-observation-status', 'stale')
            expect(page.locator(RANK)).to_have_value('')
            expect(page.locator(TURNOVER)).to_have_value('')
            expect(page.locator('[data-industry-preset-status]')).to_be_visible()
            page.locator('#industries').scroll_into_view_if_needed()
            label = 'mobile' if mobile else 'desktop'
            page.screenshot(path=str(out/(label+'-stale-fixture.png')))
            # Accepted fresh source recovers the gate, but must not silently reselect.
            phase['stamp'] = '2026-11-01T10:00:45+03:30'
            page.evaluate("""async () => {
                const response = await fetch('/market/data/market.json?expiry-fixture=fresh');
                window.ObservationSafety.accept(await response.json());
            }""")
            page.clock.run_for(100)
            expect(button).to_be_enabled(); expect(button).to_have_attribute('aria-pressed', 'false')
            expect(page.locator('[data-industry-preset-status]')).to_be_hidden()
            recovery = controls(page)
            # A user text filter survives expiry of the preset; clearing it restores all rows.
            button.click()
            page.locator('[data-industry-filter="industry"]').fill('QA-NO-MATCH')
            page.clock.fast_forward(90000); page.clock.run_for(100)
            expect(button).to_be_disabled(); expect(button).to_have_attribute('aria-pressed', 'false')
            expect(page.locator('[data-industry-filter="industry"]')).to_have_value('QA-NO-MATCH')
            expect(page.locator('#industriesGrid a')).to_have_count(0)
            page.locator('[data-industry-filter="industry"]').fill('')
            expect(page.locator('#industriesGrid a')).to_have_count(total)
            assert not errors, errors
            record = {'case': label, 'fixture': True, 'public_assets': args.public_fixture,
                      'total': total, 'selected': filtered, 'expired': total, 'recovery_reset': recovery,
                      'text_filter_preserved': True, 'errors': errors,
                      'scripts': page.locator('script[src]').evaluate_all('(xs)=>xs.map(x=>x.src)')}
            results.append(record)
            (out/'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf8')
            print(json.dumps(record, ensure_ascii=True))
            context.close()
        browser.close()
    assert len(results) == 2
    print(f'PASS 2 expiry fixtures; evidence: {out}')


if __name__ == '__main__': main()
