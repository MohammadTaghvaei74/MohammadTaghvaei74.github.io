const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('market/comprehensive-table.js', 'utf8');
const start = source.indexOf('  function scoreHistoryCell(row)');
const end = source.indexOf('  function captureViewState()', start);
const context = { num: (value) => value == null || value === '' ? null : Number(value) };
vm.createContext(context);
vm.runInContext(`
  const metricCell = (value, type, sortValue, title) => '<td>' + String(value) + '</td>';
  const digits = (value) => String(value);
  ${source.slice(start, end)}
  this.scoreHistoryCell = scoreHistoryCell;
`, context);

const render = (days) => context.scoreHistoryCell({
  score_10d_total: 123.4,
  score_10d_days: days,
  score_10d_expected_count: 10,
  score_10d_coverage: [],
});

for (const days of [10, 9]) {
  const html = render(days);
  assert(!html.includes('score-history-coverage'), `${days}/10 must not render coverage text`);
  assert(!html.includes('score-history-warning'), `${days}/10 must not render warning icon`);
  assert(!html.includes('پوشش ناقص'), `${days}/10 must not render warning label`);
}

const incomplete = render(8);
assert(incomplete.includes('class="score-history-warning"'), '<9/10 must render warning icon');
assert(incomplete.includes('aria-label="پوشش ناقص"'), 'warning icon must remain accessible');
assert(!incomplete.includes('score-history-coverage'), '<9/10 must not render coverage text');
assert(!incomplete.includes('داده برای'), '<9/10 must not render explanatory coverage text');

const fullSource = fs.readFileSync('market/comprehensive-table.js', 'utf8');
assert(fullSource.includes('captureViewState'), 'scroll capture behavior must remain');
assert(fullSource.includes('restoreViewState'), 'scroll restore behavior must remain');
console.log('score_10d coverage regression passed: 10/10, 9/10, and <9/10');
