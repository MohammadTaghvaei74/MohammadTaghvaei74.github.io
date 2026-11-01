'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const target = require('node:path').join(__dirname, '../market/data-interactions.js');
function api() { assert.ok(fs.existsSync(target), 'additive interactions module exists'); return require(target); }
test('saved filters preserve two conditions, text, operators and display units without evaluating data', () => {
  const filters = {score:{conditions:[{operator:'>=',value:'۳٫۵'},{operator:'<=',value:'5'}]},symbol:{conditions:[{operator:'',value:'وبملت'}]}};
  assert.deepEqual(api().validateFilters(filters), filters);
  assert.throws(() => api().validateFilters({score:{conditions:[{operator:'script',value:'1'}]}}));
  assert.throws(() => api().validateFilters(JSON.parse('{"__proto__":{"conditions":[]}}')));
});

test('preset names are bounded plain text and storage failures are explicit, never successful saves', () => {
  const A = api();
  assert.equal(A.presetName('  <img src=x>  '), '<img src=x>');
  assert.throws(() => A.presetName('  '));
  assert.throws(() => A.presetName('x'.repeat(81)));
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};
  assert.equal(A.loadPresets(denied).ok,false);
  assert.equal(A.savePresets(denied,[]).ok,false);
  const store={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}};
  assert.equal(A.savePresets(store,[{name:'دو شرط',filters:{score:{conditions:[{operator:'>',value:'1'},{operator:'<',value:'5'}]}}}]).ok,true);
  assert.equal(A.loadPresets(store).items[0].filters.score.conditions.length,2);
  store.value='{"broken":true}'; assert.equal(A.loadPresets(store).ok,false);
});

test('only verified SVG series and sortable headers are eligible for additive behavior', () => {
  const A = api();
  assert.deepEqual(A.chartSeriesSelector('marketChart'), ['.chart-leaders','.chart-market']);
  assert.deepEqual(A.chartSeriesSelector('priceDistributionChart'), []);
  assert.equal(A.isSortableHeader({dataset:{sortKey:'score'},getAttribute(){return null;}}), true);
  assert.equal(A.isSortableHeader({dataset:{},getAttribute(){return null;}}), false);
  assert.deepEqual(A.narrowAxisIndices(6), [0,2,4,5]);
});

test('signal cards are derived from accepted table cells and expose no invented metrics', () => {
  const A = api();
  const card = A.signalCardModel(['چرخش امتیاز','وبملت','۱۴۰۵/۰۸/۱۱، ۱۰:۳۰','جزئیات ثبت‌شده']);
  assert.deepEqual(card,{type:'چرخش امتیاز',symbol:'وبملت',time:'۱۴۰۵/۰۸/۱۱، ۱۰:۳۰',explanation:'جزئیات ثبت‌شده'});
  assert.equal(Object.prototype.hasOwnProperty.call(card,'confidence'),false);
  assert.throws(() => A.signalCardModel(['empty']));
});

if (require.main === module) {}