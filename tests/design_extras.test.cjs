const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const extras = require('../market/design-extras.js');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'market/data', name), 'utf8'));

test('catalog reads only accepted market snapshot contracts and preserves source metadata', () => {
  const snapshot = {
    schema_version: 2,
    generated_at: '2026-11-01T12:30:00+03:30',
    market: { timestamp: '2026-11-01T12:29:01+03:30' },
    stocks: [{ symbol: 'الف', instrument_type: 'P1', score: 2.5, last_pct: -1.25, trade_value_toman: 5000000000, timestamp: '2026-11-01T12:29:01+03:30' }],
    leveraged: [],
    fund_report: {
      report_date: '۱۴۰۵/۰۶/۳۱', generated_at: '2026-10-25T09:49:04+03:30',
      rows: [{ symbol: 'صندوق الف', description: 'صندوق سهامی', bubble_pct: -2, liquidity: 42, portfolio_score: 1.2, report_date: '۱۴۰۵/۰۶/۳۱' }]
    }
  };
  const catalog = extras.buildInstrumentCatalog(snapshot);
  assert.equal(catalog.find(x => x.symbol === 'الف').type, 'symbol');
  assert.equal(catalog.find(x => x.symbol === 'صندوق الف').type, 'fund');
  const fund = catalog.find(x => x.symbol === 'صندوق الف');
  assert.equal(fund.metrics.bubble_pct.value, -2);
  assert.equal(fund.metrics.bubble_pct.reportDate, '۱۴۰۵/۰۶/۳۱');
  assert.equal(fund.metrics.portfolio_score.unit, 'امتیاز خام');
});

test('catalog preserves real symbol values, units, and per-row observation provenance', () => {
  const market = read('market.json');
  const before = JSON.stringify(market);
  const rows = extras.catalog(market);
  const item = rows.find(x => x.type === 'symbol');
  assert.ok(item);
  const source = market.stocks.find(x => x.symbol === item.symbol);
  assert.equal(item.metrics.score.value, source.score);
  assert.equal(item.metrics.last_pct.value, source.last_pct);
  assert.equal(item.metrics.trade_value_toman.value, source.trade_value_toman);
  assert.equal(item.metrics.trade_value_toman.unit, 'تومان');
  assert.equal(item.metrics.score.observedAt, source.observed_at || source.source_at || source.timestamp || market.market.timestamp);
  assert.equal(JSON.stringify(market), before, 'source must not be mutated');
});

test('same-type selection is capped at four and mixed types are rejected', () => {
  const rows = [
    { id: 'symbol:A', symbol: 'A', type: 'symbol' }, { id: 'symbol:B', symbol: 'B', type: 'symbol' },
    { id: 'symbol:C', symbol: 'C', type: 'symbol' }, { id: 'symbol:D', symbol: 'D', type: 'symbol' },
    { id: 'symbol:E', symbol: 'E', type: 'symbol' }, { id: 'fund:F', symbol: 'F', type: 'fund' }
  ];
  assert.deepEqual(extras.selectComparable(rows, ['symbol:A', 'symbol:B', 'symbol:C', 'symbol:D', 'symbol:E']).map(x => x.symbol), ['A', 'B', 'C', 'D']);
  assert.deepEqual(extras.selectComparable(rows, ['symbol:A', 'fund:F']).map(x => x.symbol), ['A']);
});

test('fund board metrics come only from a matched live accepted board row', () => {
  const snapshot = {
    generated_at: '2026-11-01T12:30:00+03:30', market: { timestamp: '2026-11-01T12:30:00+03:30' },
    stocks: [{ symbol: 'صندوق الف', score: 3, last_pct: 1.5, timestamp: '2026-11-01T12:30:00+03:30' }], leveraged: [],
    fund_report: { report_date: '۱۴۰۵/۰۶/۳۱', generated_at: '2026-10-25T09:00:00+03:30', rows: [{ symbol: 'صندوق الف', board_score: -9, bubble_pct: 1, liquidity: 4, portfolio_score: 2, report_date: '۱۴۰۵/۰۶/۳۱' }] }
  };
  const fund = extras.buildInstrumentCatalog(snapshot).find(x => x.symbol === 'صندوق الف');
  assert.equal(fund.metrics.board_score.value, 3);
  assert.equal(fund.metrics.board_score.provenance, 'live-board');
  assert.equal(fund.metrics.board_score.observedAt, '2026-11-01T12:30:00+03:30');
});

test('missing values remain unavailable and are never coerced to zero', () => {
  const catalog = extras.buildInstrumentCatalog({
    generated_at: '2026-11-01T12:30:00+03:30', market: { timestamp: '2026-11-01T12:30:00+03:30' },
    stocks: [{ symbol: 'نامشخص', score: null, last_pct: '', trade_value_toman: null }], leveraged: []
  });
  assert.equal(catalog[0].metrics.score.value, null);
  assert.equal(catalog[0].metrics.last_pct.value, null);
  assert.match(extras.displayValue(null), /در دسترس نیست/);
});

test('preferences fail safe and keep all sections visible by default', () => {
  const storage = { data: null, getItem() { return this.data; }, setItem(_, v) { this.data = v; }, removeItem() { this.data = null; } };
  const ids = ['one', 'two', 'three'];
  assert.deepEqual(extras.readPreferences(storage, ids), { hidden: [], order: ids });
  extras.writePreferences(storage, { hidden: ['two'], order: ['three', 'one', 'two'] });
  assert.deepEqual(extras.readPreferences(storage, ids), { hidden: ['two'], order: ['three', 'one', 'two'] });
  storage.data = '{bad';
  assert.deepEqual(extras.readPreferences(storage, ids), { hidden: [], order: ids });
});

test('unsafe instrument strings are values, not markup', () => assert.equal(extras.safeText('<img onerror=x>'), '<img onerror=x>'));

test('real fund report payload exposes archival report date separately from live board metric', () => {
  const market = read('market.json');
  const fund = extras.catalog(market).find(x => x.type === 'fund');
  assert.ok(fund, 'market snapshot should expose fund report rows');
  assert.ok(fund.reportDate || fund.metrics.portfolio_score.reportDate);
  assert.equal(fund.metrics.portfolio_score.provenance, 'archive-report');
  assert.equal(fund.metrics.board_score.provenance, 'live-board');
  assert.ok(fund.metrics.board_score.observedAt === null || typeof fund.metrics.board_score.observedAt === 'string');
});

test('never borrow market/publication timestamps or conflate liquidity windows with holdings dates', () => {
  const market = {generated_at:'2026-11-01T12:30:00+03:30', market:{timestamp:'2026-11-01T12:30:00+03:30'}, stocks:[{symbol:'A',score:0,last_pct:' ',avg_trade_value_toman:99}], leveraged:[]};
  const item = extras.catalog(market)[0];
  assert.equal(item.metrics.score.observedAt, null);
  assert.equal(item.metrics.last_pct.value, null);
  assert.equal(item.metrics.trade_value_toman.value, null);
  const fund = extras.catalog({...market,fund_report:{rows:[{symbol:'F',liquidity:42,report_date:'1405/06/31',board_score:5,bubble_pct:2}]}}).find(x=>x.type==='fund');
  assert.equal(fund.metrics.liquidity.observedAt, null);
  assert.equal(fund.metrics.liquidity.reportDate, null);
  assert.equal(fund.metrics.bubble_pct.observedAt, null);
  assert.equal(fund.metrics.report_board_score.value, 5);
});

test('fund board identity uses instrument IDs and includes leveraged rows without same-name collisions', () => {
  const stamp='2026-11-01T12:30:00+03:30';
  const data={stocks:[{symbol:'F',instrument:'wrong',score:900,timestamp:stamp}],leveraged:[{symbol:'F',instrument:'right',score:7,last_pct:0,timestamp:stamp}],fund_report:{rows:[{symbol:'F',instrument:'right',report_date:'1405/06/31'}]}};
  const fund=extras.catalog(data).find(x=>x.type==='fund');
  assert.equal(fund.metrics.board_score.value,7);
  assert.equal(fund.metrics.price_change_pct.value,0);
});

test('freshness delegates to the existing session policy, never a newly invented threshold', () => {
  const policy=require('../market/observation-safety.js');
  const stamp='2026-11-01T10:00:00+03:30';
  assert.equal(extras.stateFor(stamp,Date.parse('2026-11-01T10:01:01+03:30'),policy),'stale');
  assert.equal(extras.stateFor(stamp,Date.parse('2026-11-01T10:00:30+03:30'),policy),'fresh');
  assert.equal(extras.stateFor(stamp,Date.parse(stamp),null),'unknown');
  assert.equal(extras.stateFor('2026-11-01T12:30:00+03:30',Date.parse('2026-11-01T18:00:00+03:30'),policy),'fresh');
});

test('selection and saved preferences reject corrupt/unknown entries and preserve defaults', () => {
  assert.deepEqual(extras.normalizeSelection(['symbol:A','symbol:A',null,'fund:F','symbol:B','symbol:C','symbol:D','symbol:E']),['symbol:A','symbol:B','symbol:C','symbol:D']);
  assert.deepEqual(extras.normalizePreferences({hidden:['ghost','a','a'],order:['ghost','b','b']},['a','b','c']),{hidden:['a'],order:['b','a','c']});
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  assert.deepEqual(extras.readPreferences(blocked,['a']),{hidden:[],order:['a']});
  assert.equal(extras.writePreferences(blocked,{hidden:[],order:['a']}),false);
});

test('numeric invalids remain unavailable while zero is real data', () => {
  for (const score of [null,undefined,'', '  ',false,true,{},[],Infinity,NaN,'not a number']) {
    assert.equal(extras.catalog({stocks:[{symbol:'A',score}]})[0].metrics.score.value,null);
  }
  assert.equal(extras.catalog({stocks:[{symbol:'A',score:0}]})[0].metrics.score.value,0);
});

test('source-report board scores and liquidity never inherit holdings observation dates', () => {
  const summary=read('funds.json');
  const result=extras.catalog({},summary);
  assert.equal(result.length,new Set(summary.rows.map(r=>r.symbol)).size);
  for (const item of result) {
    const raw=summary.rows.find(r=>r.symbol===item.symbol);
    assert.equal(item.metrics.liquidity.value,raw.liquidity ?? raw.avg_daily_value_billion_toman ?? null);
    assert.equal(item.metrics.report_board_score.value,raw.board_score ?? null);
    assert.equal(item.metrics.board_score.value,null);
    assert.equal(item.metrics.report_board_score.observedAt,null);
    assert.equal(item.metrics.liquidity.reportDate,null);
  }
});

test('mismatched instrument IDs cannot join even when display symbols match', () => {
  const item=extras.catalog({stocks:[{symbol:'F',instrument:'not-F',score:123}],fund_report:{rows:[{symbol:'F',instrument:'F'}]}}).find(x=>x.type==='fund');
  assert.equal(item.metrics.board_score.value,null);
});

console.log('design extras model tests loaded');
// Browser companion: tests/design_extras_browser.py exercises the real DOM.
