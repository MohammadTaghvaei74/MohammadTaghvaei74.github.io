'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const market = path.join(__dirname, '../market');
function browserSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return browserSources(file);
    if (entry.name.endsWith('.js')) return [{ file, source: fs.readFileSync(file, 'utf8') }];
    if (!entry.name.endsWith('.html')) return [];
    const html = fs.readFileSync(file, 'utf8');
    return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
      (match, index) => ({ file: `${file}:inline-${index}`, source: match[1] }));
  });
}

test('all market browser scripts reject syntax unavailable to WebView 74', () => {
  // Conservative source guard: even comments must avoid these tokens. No build
  // step transpiles this static site, so Node parsing alone cannot protect it.
  const forbidden = [
    ['optional chaining', /\?\./],
    ['nullish coalescing', /\?\?/],
    ['numeric separators', /\b\d[\d.]*_\d/],
    ['optional catch binding (post-ES2018)', /\bcatch\s*\{/],
    ['String.replaceAll (unavailable on WebView 74)', /\.replaceAll\s*\(/],
  ];
  const sources = browserSources(market);
  assert.ok(sources.some(({ file }) => file.endsWith('app.js')));
  const failures = [];
  for (const { file, source } of sources) {
    for (const [label, pattern] of forbidden) {
      const match = pattern.exec(source);
      if (match) failures.push(`${path.relative(market, file)}:${source.slice(0, match.index).split('\n').length}: ${label}`);
    }
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('nullable core inputs preserve missing values, zero scores and timestamp precedence', () => {
  const core = require('../market/core.js');
  for (const missing of [undefined, null, {}]) {
    assert.equal(core.sourceTimestamp(missing), null);
    assert.equal(core.findLeaders(missing), null);
    assert.deepEqual(core.chartSeries(missing), { market: [], leaders: [], rest: [] });
  }
  assert.equal(core.sourceTimestamp({ market: null, generated_at: 'fallback' }), 'fallback');
  assert.equal(core.sourceTimestamp({ market: { timestamp: 'source' }, generated_at: 'fallback' }), 'source');
  assert.equal(core.sourceTimestamp({ market: { timestamp: '' }, generated_at: 'fallback' }), 'fallback');
  assert.equal(core.findLeaders({ groups: [{ group_name: 'لیدر', median: 0 }] }).median, 0);
  assert.deepEqual(core.chartSeries({ daily: [{ median_score: 0, average_score: null }] }), { market: [0], leaders: [null], rest: [null] });
});

test('dashboard renders missing leaders/options and preserves falsy text rather than using a fallback', async () => {
  const elements = new Map();
  for (const selector of ['#marketState', '#sourceStatus', '#signalLeaders', '#topStocks', '#optionsMessage']) {
    elements.set(selector, { textContent: '', innerHTML: '', dataset: {}, closest: () => null });
  }
  const errors = [];
  const snapshot = { schema_version: 1, source: 'test', generated_at: '2026-10-17T09:00:00+03:30', market: {}, groups: [], top_stocks: [0, false, '', null, undefined].map(symbol => ({ symbol })), leveraged: [], industries: [], daily: [] };
  const context = vm.createContext({
    window: { setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, addEventListener() {} },
    document: { querySelector: selector => elements.get(selector) || null, querySelectorAll: () => [], addEventListener() {} },
    navigator: { userAgent: '' },
    AbortController,
    fetch: async () => ({ ok: true, json: async () => snapshot }),
    console: { error: error => errors.push(String(error)) },
  });
  vm.runInContext(fs.readFileSync(path.join(market, 'core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(market, 'app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, []);
  assert.equal(elements.get('#signalLeaders').textContent, '—');
  assert.ok(elements.get('#optionsMessage').textContent.length > 0);
  const symbols = Array.from(elements.get('#topStocks').innerHTML.matchAll(/<tr><td>(.*?)<\/td><td><span[\s\S]*?<\/span>/g), match => match[1]);
  assert.deepEqual(symbols, ['0', 'false', '', '—', '—']);
});

// Exercise CSV escaping without relying on a newer host's String.replaceAll.
test('archive CSV retains null/zero/false and quote escaping without replaceAll', () => {
  const context = vm.createContext({
    document: { querySelector: () => ({ addEventListener() {} }) },
    fetch: () => new Promise(() => {}),
  });
  vm.runInContext('String.prototype.replaceAll = undefined;', context);
  vm.runInContext(fs.readFileSync(path.join(market, 'history/history.js'), 'utf8'), context);
  assert.equal(vm.runInContext('csvCell(null)', context), '""');
  assert.equal(vm.runInContext('csvCell(0)', context), '"0"');
  assert.equal(vm.runInContext('csvCell(false)', context), '"false"');
  assert.equal(vm.runInContext('csvCell(\'a"b"c\')', context), '"a""b""c"');
  assert.equal(vm.runInContext('symbolRows("missing").length', context), 0);
});
