"""Overview-only geometry/timestamp gate, using actual consumed market data.

Run a local server from the repo, then:
  python tests/overview_compact_browser.py --base http://127.0.0.1:8772
Use --require-link after integration; otherwise inject the owned CSS in memory.
Optional --output PATH saves viewport screenshots and measured JSON.
No feed fixtures, timestamp rewrites, or external writes are used.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MEASURE = """() => {
  const compactSheets = [...document.styleSheets].filter(s =>
    (s.href || '').includes('/overview-compact.css') || s.ownerNode?.id === 'compact-qa');
  if (!compactSheets.length) throw Error('compact stylesheet missing');
  const rect = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect(), c = getComputedStyle(el);
    return {top:b.top + scrollY, bottom:b.bottom + scrollY, left:b.left, right:b.right,
      height:b.height, width:b.width, display:c.display, direction:c.direction, status:el.dataset.status,
      marginBottom:parseFloat(c.marginBottom), overflow:c.overflowX,
      background:c.backgroundColor, color:c.color, border:c.borderInlineStartColor};
  };
  const pair = document.querySelector('#overview > .daily-overview-pair');
  const stamp = document.querySelector('#lastUpdate');
  const clocks = [...pair.querySelectorAll('.observation-clock')];
  const signature = () => JSON.stringify({time:stamp.outerHTML,
    clocks:clocks.map(e => e.outerHTML),
    charts:[...pair.querySelectorAll('svg')].map(e => e.outerHTML)});
  const state = () => ({
    width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
    rootOverflow:getComputedStyle(document.documentElement).overflowX,
    bodyOverflow:getComputedStyle(document.body).overflowX,
    freshness:rect(document.querySelector('.shell > .data-freshness')),
    transport:rect(document.querySelector('#overview > #dataTransportStatus')),
    pair:rect(pair),
    headings:[...pair.querySelectorAll('.section-heading')].map(rect),
    panels:[...pair.querySelectorAll('section > .panel')].map(rect),
    clocks:clocks.map(rect),
    svg:[...pair.querySelectorAll('svg')].map(rect),
    unaffected:[...document.querySelectorAll('.top-charts .chart-wrap')].map(rect)
  });
  const immutableBefore=signature();
  compactSheets.forEach(s => s.disabled=true);
  const before=state();
  compactSheets.forEach(s => s.disabled=false);
  const after=state();
  // Measurements and both signatures run in ONE JS task, so a periodic data
  // refresh cannot race the timestamp-preservation assertion.
  return {before,after,unchanged:immutableBefore===signature(),
    timestamps:{market:stamp.getAttribute('datetime'),marketText:stamp.textContent,
      clocks:clocks.map(e=>({sourceAt:e.dataset.sourceAt,status:e.dataset.status,text:e.textContent}))},
    transportState:document.querySelector('#dataTransportStatus')?.dataset.state};
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:8772')
    parser.add_argument('--require-link', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
    report = {'checks': [], 'failures': []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome', headless=True)
        for width in (390, 768, 1440):
            page = browser.new_page(viewport={'width': width, 'height': 1000})
            page.goto(args.base.rstrip('/') + '/market/?overview_compact_qa=1',
                      wait_until='domcontentloaded', timeout=90000)
            # Wait for actual data acceptance, not just loading placeholder text.
            page.wait_for_function("""() => document.querySelector('#dataTransportStatus') &&
              document.querySelector('#lastUpdate')?.getAttribute('datetime') &&
              [...document.querySelectorAll('.daily-overview-pair .observation-clock')]
                .some(e => e.dataset.sourceAt) &&
              document.querySelector('#turnoverChart')?.children.length""", timeout=45000)
            page.evaluate('document.fonts.ready')
            linked = page.locator('link[href*="overview-compact.css"]')
            if args.require_link:
                assert linked.count() == 1, 'Expected exactly one overview-compact.css link'
            elif not linked.count():
                style = page.add_style_tag(path=str(ROOT / 'market' / 'overview-compact.css'))
                style.evaluate("e => e.id='compact-qa'")
            state = page.evaluate(MEASURE)
            before, after = state['before'], state['after']
            errors = []
            if after['scrollWidth'] > width + 1:
                errors.append('horizontal document overflow')
            if (after['rootOverflow'], after['bodyOverflow']) != (before['rootOverflow'], before['bodyOverflow']):
                errors.append('compact CSS changed global overflow behavior')
            if not state['unchanged']:
                errors.append('timestamp, freshness, or SVG content changed')
            if len(after['panels']) != 2 or len(after['clocks']) != 2:
                errors.append('expected two charts and their two section freshness clocks')
            else:
                for index, (a, b) in enumerate(zip(after['panels'], before['panels'])):
                    if a['top'] > b['top'] - 16:
                        errors.append(f'chart {index} moved upward less than 16px')
                    if after['clocks'][index]['display'] == 'none' or after['clocks'][index]['height'] == 0:
                        errors.append(f'chart {index} freshness hidden')
                    if after['headings'][index]['direction'] != 'rtl':
                        errors.append(f'chart {index} heading lost RTL')
                    if after['headings'][index]['marginBottom'] > 8.1:
                        errors.append(f'chart {index} heading gap exceeds 8px')
                    if abs(after['svg'][index]['width'] - before['svg'][index]['width']) > 1 or abs(after['svg'][index]['height'] - before['svg'][index]['height']) > 1:
                        errors.append(f'chart {index} drawing geometry changed')
                    if after['clocks'][index]['status'] == 'fresh' and after['clocks'][index]['background'] not in ('rgba(0, 0, 0, 0)', 'transparent'):
                        errors.append(f'chart {index} healthy freshness remains a filled notice')
                if after['panels'][0]['top'] >= 440:
                    errors.append('first chart panel below initial viewport budget')
                if width == 1440 and abs(after['panels'][0]['top'] - after['panels'][1]['top']) > 1:
                    errors.append('desktop chart tops no longer aligned')
            for a, b in zip(after['unaffected'], before['unaffected']):
                if abs(a['height'] - b['height']) > 1 or abs(a['width'] - b['width']) > 1:
                    errors.append('unrelated intraday chart geometry changed')
            if abs(after['freshness']['bottom'] - after['transport']['top']) > 1:
                errors.append('timestamp and transport status band not joined')
            state.update(width=width, failures=errors)
            report['checks'].append(state)
            report['failures'].extend(f'{width}: {e}' for e in errors)
            if args.output:
                page.screenshot(path=str(args.output / f'{width}-overview-compact.png'))
            print(json.dumps({'width':width,
                'panelTopBefore':[round(e['top'],1) for e in before['panels']],
                'panelTopAfter':[round(e['top'],1) for e in after['panels']],
                'timestampsUnchanged':state['unchanged'], 'failures':errors}, ensure_ascii=False))
            page.close()
        browser.close()
    if args.output:
        (args.output / 'overview-compact.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'checks':len(report['checks']), 'failures':report['failures']}))
    return 1 if report['failures'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
