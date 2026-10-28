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

test('allocation labels match the two slider ends', () => {
  assert.equal(core.allocation(2, 0.9).label, 'تمایل قوی به هم‌وزن');
  assert.equal(core.allocation(0, 1.5).label, 'تمایل قوی به لیدرها');
});

test('snapshot validation requires arrays and uses market source timestamp', () => {
  const valid = { schema_version: 1, source: 'x', generated_at: 'not-used', market: { timestamp: '2026-10-14T12:30:00+03:30' }, groups: [], top_stocks: [], leveraged: [], industries: [], daily: [] };
  assert.equal(core.validateSnapshot(valid), valid);
  const v2 = { ...valid, schema_version: 2, stocks: [], top_buy_queue: [], industry_table: [], intraday: [], queue_intraday: [] };
  assert.equal(core.validateSnapshot(v2), v2);
  assert.equal(core.sourceTimestamp(valid), valid.market.timestamp);
  assert.match(core.formatDate(valid.market.timestamp), /۱۴۰۵/);
  assert.throws(() => core.validateSnapshot({ ...valid, market: { timestamp: 'bad' } }), /timestamp/);
  assert.throws(() => core.validateSnapshot({ ...valid, daily: null }), /daily/);
});

test('chart uses exactly three medians, preserving absent cohorts', () => {
  assert.deepEqual(core.chartSeries({ daily: [{ median_score: 2, average_score: 99, leader_median_score: 4, rest_median_score: 1 }] }), { market: [2], leaders: [4], rest: [1] });
  assert.deepEqual(core.chartSeries({ daily: [{ median_score: 2 }] }), { market: [2], leaders: [null], rest: [null] });
});

test('chart scale expands integer grid to both series extrema', () => {
  assert.deepEqual(core.chartScale([1.2, -4.3, null], [-0.5, 2.1]), { min: -5, max: 3, ticks: [-5, -4, -3, -2, -1, 0, 1, 2, 3] });
  assert.deepEqual(core.chartExtrema([1.2, -4.3, null]), { min: -4.3, max: 1.2 });
  assert.deepEqual(core.chartExtrema([null]), { min: null, max: null });
});

test('score chart keeps semantic plus and minus three thresholds fixed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../market/app-fast-recovery-20261024-axis.js'), 'utf8');
  assert.match(source, /densifyIntraday\(Array\.isArray\(data\.intraday\).*\"09:00\"/);
  assert.match(source, /Math\.min\(-3, \.\.\.actualValues/);
  assert.match(source, /Math\.max\(3, \.\.\.actualValues/);
  assert.match(source, /tick === 3 \? "chart-limit-positive" : tick === -3 \? "chart-limit-negative"/);
  assert.match(source, /y\(3\).*positiveBand/);
  assert.match(source, /y\(-3\).*negativeBand/);
});

const realSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../market/data/market.json'), 'utf8'));
test('current market snapshot validates and has no synthetic leader series', () => {
  assert.equal(core.validateSnapshot(realSnapshot), realSnapshot);
  assert.deepEqual(core.chartSeries(realSnapshot).leaders, [...realSnapshot.daily].reverse().map(row => row.leader_median_score == null || Math.abs(row.leader_median_score) > 20 ? null : row.leader_median_score));
  assert.equal(core.sourceTimestamp(realSnapshot), realSnapshot.market.timestamp);
});

test('schema rejects malformed array rows explicitly', () => {
  for (const key of ['groups', 'top_stocks', 'leveraged', 'industries', 'daily']) {
    assert.throws(() => core.validateSnapshot({ ...realSnapshot, [key]: [null] }), /ردیف|ساختار/);
  }
});
