const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('theme menu closes after a selection and is positioned below wrapped navigation', () => {
  const js = read('market/theme-init.js');
  const css = read('market/design-system.css');
  assert.match(js, /closest\(['"]\.ds-appearance['"]\)/);
  assert.match(js, /removeAttribute\(['"]open['"]\)/);
  assert.match(css, /\.ds-appearance-menu\s*\{[^}]*top:calc\(100% \+ 56px\)/s);
});

test('mobile content reserves the fixed navigation safe area', () => {
  const css = read('market/mobile.css');
  assert.match(css, /body\s*\{[^}]*padding-bottom:\s*calc\(80px \+ env\(safe-area-inset-bottom\)\)/s);
  assert.match(css, /\.mobile-nav\s*\{[^}]*bottom:\s*max\(8px, env\(safe-area-inset-bottom\)\)/s);
});

test('overview charts expose honest pending states before data is accepted', () => {
  const html = read('market/index.html');
  const renderer = read('market/app-fast-recovery-20261024-axis.js');
  for (const id of ['turnoverChart', 'priceDistributionChart', 'queueChart', 'marketChart', 'queueCountChart']) {
    assert.match(html, new RegExp(`<svg[^>]*id="${id}"[^>]*>[\\s\\S]*?chart-state`));
  }
  assert.match(renderer, /function setChartState\(/);
  assert.match(renderer, /data-chart-state/);
  assert.match(renderer, /status === ['"]fresh['"]/);
});

test('non-decorative helper text uses the shared 12px minimum and AA-safe muted color', () => {
  const css = read('market/design-system.css');
  assert.match(css, /--ds-font-helper:12px/);
  assert.match(css, /--ds-muted:#536b68/);
  assert.match(css, /font-size:max\(12px, \.75rem\)!important/);
});

test('healthy overview status does not duplicate the section freshness notice', () => {
  const renderer = read('market/app-fast-recovery-20261024-axis.js');
  assert.match(renderer, /text\("#turnoverStatus", quality\.join/);
});
