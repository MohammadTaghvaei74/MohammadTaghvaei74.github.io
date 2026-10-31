from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_compact_industry_contract():
    html = (ROOT / 'market/index.html').read_text(encoding='utf-8')
    js = (ROOT / 'market/app-fast-recovery-20261024-axis.js').read_text(encoding='utf-8')
    assert 'مرتب‌سازی بر اساس میانه امتیاز ·' not in html
    assert 'section-index' not in html
    assert 'data-filter-cell="average"' in html
    assert 'data-filter-cell="ratio"' in html
    assert 'colspan="8"' in js
    assert 'rankPercent < 25' in js
    assert 'rankFilter.value = "25"' in js
    assert 'turnover_to_15d_ratio' in js
    for text in (html, js):
        assert not re.search(r'<option value="(?:>=|<=)"', text)
