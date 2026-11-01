"""Local real-Chrome gate. Only inject owned assets if not integrated; no HTML edits.
Artifacts default to OS temp, not unowned repository paths. All market numbers
come from checked-in accepted public feeds. Adversarial names are test fixtures.
"""
import argparse
import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:8765')
parser.add_argument('--output', default=str(Path(tempfile.gettempdir()) / 'sorena-design-extras'))
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
market = json.loads((ROOT / 'market/data/market.json').read_text(encoding='utf-8'))
funds = json.loads((ROOT / 'market/data/funds.json').read_text(encoding='utf-8'))
report = {'base': args.base, 'checks': [], 'errors': []}

def record(name):
    report['checks'].append(name)
    print('PASS', name)

def inject(page):
    if not page.evaluate('!!window.SorenaExtras'):
        page.add_script_tag(path=str(ROOT / 'market/design-extras.js'))
    if not page.locator('link[href*="design-extras.css"]').count():
        page.add_style_tag(path=str(ROOT / 'market/design-extras.css'))
    page.evaluate('m => window.SorenaExtras.mount({snapshot:m})', market)
    page.evaluate('m => window.dispatchEvent(new CustomEvent("market:snapshot",{detail:m}))', market)

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    try:
        for width in (1440, 390):
            context = browser.new_context(viewport={'width': width, 'height': 1000})
            # Exercise real local fallback, not a synthetic API or production host.
            context.route('https://94-101-184-98.sslip.io/**', lambda route: route.abort())
            page = context.new_page()
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.goto(args.base + '/market/', wait_until='networkidle')
            nav_before = page.locator('.main-nav').inner_html()
            inject(page)
            toolbar = page.locator('[data-sorena-extras="toolbar"]')
            expect(toolbar).to_have_count(1)
            page.evaluate('SorenaExtras.mount()')
            expect(toolbar).to_have_count(1)
            assert page.locator('.main-nav').inner_html() == nav_before
            toolbar.get_by_role('button', name='مقایسه ابزارها', exact=True).click()
            select = toolbar.locator('.sorena-extras-select')
            expect(select).to_have_accessible_name('افزودن ابزار هم‌نوع')
            expect(toolbar.locator('.sorena-extras-message')).not_to_contain_text('در حال دریافت', timeout=15000)
            options = select.locator('option').evaluate_all('xs=>xs.map(x=>x.value)')
            symbols = [x for x in options if x.startswith('symbol:')]
            fund_ids = [x for x in options if x.startswith('fund:')]
            assert len(symbols) >= 5 and len(fund_ids) >= 4
            for value in symbols[:4]:
                select.select_option(value)
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(4)
            assert 'تومان' in toolbar.inner_text()
            assert 'پیشنهاد خرید یا فروش' in toolbar.inner_text()
            # Reset must be a real control, not manual removal of four chips.
            toolbar.get_by_role('button', name='پاک‌کردن مقایسه', exact=True).click()
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(0)
            expect(select.locator('option[value^="fund:"]').first).to_be_attached()
            fund_ids = select.locator('option[value^="fund:"]').evaluate_all('xs=>xs.slice(0,4).map(x=>x.value)')
            for value in fund_ids:
                select.select_option(value)
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(4)
            assert 'گزارش آرشیوی' in toolbar.inner_text()
            assert 'زمان مشاهده' in toolbar.inner_text() or 'مشاهده' in toolbar.inner_text()
            assert 'میلیارد تومان' in toolbar.inner_text()
            expect(toolbar.locator('.sorena-extras-provenance-legend')).to_be_visible()
            # The host observation observer may add its own status badge; the module's
            # source legend remains the authoritative per-metric provenance explanation.
            toolbar.locator('.sorena-extras-selected button').first.click()
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(3)
            select.select_option(fund_ids[0])
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(4)
            toolbar.screenshot(path=str(out / f'comparison-{width}.png'))
            record(f'{width}: mount, real symbol/fund selection, reset, units/provenance, navigation')

            toolbar.get_by_role('button', name='تنظیم بخش‌ها', exact=True).click()
            rows = toolbar.locator('.sorena-extras-section-row')
            assert rows.count() >= 4
            ids = page.locator('[data-extras-section]').evaluate_all('xs=>xs.map(x=>x.dataset.extrasSection)')
            assert ids
            original_count = page.locator('#overview svg').count()
            first_id = ids[0]
            rows.nth(0).get_by_role('checkbox').uncheck()
            expect(page.locator(f'[data-extras-section="{first_id}"]')).to_be_hidden()
            rows.nth(0).get_by_role('button', name='انتقال', exact=False).last.click()
            # DOM order, not only visual CSS order: keyboard and reading order agree.
            reordered = page.locator('[data-extras-section]').evaluate_all('xs=>xs.map(x=>x.dataset.extrasSection)')
            assert reordered.index(first_id) == 1
            assert page.locator('#overview svg').count() == original_count
            page.reload(wait_until='networkidle')
            inject(page)
            toolbar = page.locator('[data-sorena-extras="toolbar"]')
            expect(page.locator(f'[data-extras-section="{first_id}"]')).to_be_hidden()
            toolbar.get_by_role('button', name='مقایسه ابزارها', exact=True).click()
            expect(toolbar.locator('.sorena-extras-chip')).to_have_count(4)
            toolbar.get_by_role('button', name='تنظیم بخش‌ها', exact=True).click()
            toolbar.get_by_role('button', name='بازنشانی ترتیب و نمایش', exact=True).click()
            expect(page.locator(f'[data-extras-section="{first_id}"]')).to_be_visible()
            assert page.locator('[data-extras-section]').evaluate_all('xs=>xs.map(x=>x.dataset.extrasSection)') == ids
            toolbar.screenshot(path=str(out / f'personalize-{width}.png'))
            assert toolbar.evaluate('e=>e.getBoundingClientRect().width') <= width
            assert toolbar.locator('.sorena-extras-comparison').evaluate('e=>e.clientWidth') <= width
            record(f'{width}: visibility/order, unchanged charts, reload persistence, reset, mobile bounds')
            context.close()

        # Isolated hostile-data, unavailable storage and non-overview scope gate.
        context = browser.new_context(viewport={'width': 390, 'height': 900})
        context.route('https://94-101-184-98.sslip.io/**', lambda route: route.abort())
        context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        page = context.new_page()
        page.goto(args.base + '/market/funds/', wait_until='networkidle')
        inject(page)
        toolbar = page.locator('[data-sorena-extras="toolbar"]')
        assert not page.locator('[data-extras-section]').count(), 'only overview sections are personalizable'
        toolbar.get_by_role('button', name='مقایسه ابزارها', exact=True).click()
        hostile = {'stocks': [{'symbol': '<img src=x onerror=alert(1)>', 'score': None, 'last_pct': 0}], 'leveraged': []}
        page.evaluate('data=>SorenaExtras.accept(data)', hostile)
        select = toolbar.locator('.sorena-extras-select')
        toolbar.get_by_role('button', name='پاک‌کردن مقایسه', exact=True).click()
        select.select_option('symbol:<img src=x onerror=alert(1)>')
        expect(toolbar.locator('img')).to_have_count(0)
        assert '<img src=x onerror=alert(1)>' in toolbar.inner_text()
        assert 'در دسترس نیست' in toolbar.inner_text()
        assert 'قابل تأیید نیست' in toolbar.inner_text()
        record('blocked storage, non-overview isolation, missing/zero values, hostile text safety')
        context.close()
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        browser.close()
        (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print('ARTIFACT_DIR', out)
