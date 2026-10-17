"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const corePath = path.join(__dirname, '../market/core.js');
const core = fs.existsSync(corePath) ? require(corePath) : {};

test('missing numeric data stays missing, while real zero remains zero', () => {
  assert.equal(typeof core.number, 'function');
  for (const value of [undefined, null, '', ' ', false, true, NaN, Infinity, {}, []]) {
    assert.equal(core.number(value), null);
    assert.equal(core.formatNumber(value), '—');
    assert.equal(core.formatSigned(value), '—');
    assert.equal(core.formatPercent(value), '—');
  }
  assert.equal(core.number(0), 0);
  assert.equal(core.number('1.25'), 1.25);
  assert.equal(core.formatNumber(0), '۰٫۰');
  assert.equal(core.formatSigned(1.25, 2), '+۱٫۲۵');
  assert.equal(core.formatPercent(-2), '−۲٫۰۰٪');
});

test('allocation uses exact server thresholds and never recommends a signal', () => {
  assert.equal(core.allocation(2, 0.9).key, 'strong-broad');
  assert.equal(core.allocation(1.5, 1).key, 'broad');
  assert.equal(core.allocation(1, 0).key, 'broad');
  assert.equal(core.allocation(0, 1).key, 'leaders');
  assert.equal(core.allocation(0, 1.5).key, 'strong-leaders');
  assert.equal(core.allocation(0, 0.5).key, 'leaders');
  assert.equal(core.allocation(0, 0.49).key, 'none');
  for (const result of [core.allocation(2, 0), core.allocation(0, 1.5)]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'recommendation'), false);
  }
});

test('snapshot validation requires arrays and uses market source timestamp', () => {
  const valid = { schema_version: 1, source: 'x', generated_at: 'not-used', market: { timestamp: '2026-10-14T12:30:00+03:30' }, groups: [], top_stocks: [], leveraged: [], industries: [], daily: [] };
  assert.equal(core.validateSnapshot(valid), valid);
  assert.throws(() => core.validateSnapshot({ ...valid, schema_version: 2 }), /schema|نسخه|نامعتبر/);
  assert.equal(core.sourceTimestamp(valid), valid.market.timestamp);
  assert.match(core.formatDate(valid.market.timestamp), /۱۴۰۵/);
  assert.throws(() => core.validateSnapshot({ ...valid, market: { timestamp: 'bad' } }), /timestamp/);
  assert.throws(() => core.validateSnapshot({ ...valid, daily: null }), /daily/);
});

test('chart series contains only actual market fields', () => {
  assert.deepEqual(core.chartSeries({ daily: [{ median_score: 2, average_score: 3 }] }), { market: [2], average: [3], leaders: null });
  assert.deepEqual(core.chartSeries({ daily: [{ median_score: 2 }] }), { market: [2], average: [null], leaders: null });
});

const realSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../market/data/market.json'), 'utf8'));
test('current market snapshot validates and has no synthetic leader series', () => {
  assert.equal(core.validateSnapshot(realSnapshot), realSnapshot);
  assert.equal(core.chartSeries(realSnapshot).leaders, null);
  assert.equal(core.sourceTimestamp(realSnapshot), realSnapshot.market.timestamp);
});

test('schema rejects malformed array rows explicitly', () => {
  for (const key of ['groups', 'top_stocks', 'leveraged', 'industries', 'daily']) {
    assert.throws(() => core.validateSnapshot({ ...realSnapshot, [key]: [null] }), /ردیف|ساختار/);
  }
});
