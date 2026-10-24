const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../market/industries/industries.js');

const snapshot = {
  stocks: [
    {symbol: 'الف', industry: 'بانک', score: 10, trade_value_toman: 2e9},
    {symbol: 'ب', industry: 'بانک', score: 2, trade_value_toman: 8e9},
    {symbol: 'ج', industry: 'خودرو', score: 5, trade_value_toman: 4e9}
  ],
  industry_table: [
    {industry: 'بانک', stock_count: 2, median_score: 6, trade_value_toman: 10e9},
    {industry: 'خودرو', stock_count: 1, median_score: 5, trade_value_toman: 4e9}
  ]
};

test('summary comparison filters use displayed billion units and numeric operators', () => {
  const groups = E.buildIndustries(snapshot);
  assert.deepEqual(E.filterSummary(groups, {
    trade_value_toman: {operator: 'gt', value: '۵'},
    industry: {operator: '', value: ''}
  }), [groups[0]]);
  assert.equal(E.parseComparison('<', '۱۰').value, 10);
});

test('financing papers are not treated as industries', () => {
  const groups = E.buildIndustries({stocks: [
    {symbol: 'سهم', industry: 'بانک', score: 1},
    {symbol: 'اوراق', industry: 'اوراق تامین مالی', score: 9},
    {symbol: 'تملی', industry: 'اوراق حق تقدم استفاده از تسهیلات مسکن', score: 8}
  ], industry_table: [
    {industry: 'بانک', stock_count: 1, median_score: 1},
    {industry: 'اوراق تامین مالی', stock_count: 1, median_score: 9}
  ]});
  assert.deepEqual(groups.map((group) => group.name), ['بانک']);
});

test('industry text filter supports contains and equality', () => {
  const groups = E.buildIndustries(snapshot);
  assert.equal(E.filterSummary(groups, {industry: {operator: 'contains', value: 'خود'}})[0].name, 'خودرو');
  assert.equal(E.filterSummary(groups, {industry: {operator: 'eq', value: 'بانک'}})[0].name, 'بانک');
});

test('industry presentation follows the stock-table precision contract', () => {
  assert.equal(E.formatNumber(6.404, 1), '۶٫۴');
  assert.equal(E.formatMillion(142373875), '۱۴۲');
  assert.equal(E.signedPct1(-0.08014), '−۰٫۱٪');
  assert.equal(E.formatBillion(259681746688.3), '۲۶۰');
});

test('every summary column has a numeric operator and value filter contract', () => {
  assert.equal(E.summaryColumns.length, 15);
  assert.ok(E.summaryColumns.every((column) => column.key));
  assert.deepEqual(E.operatorOptions.map((option) => option.label), ['—', '=', '>', '>=', '<', '<=']);
  assert.deepEqual(E.textOperatorOptions.map((option) => option.label), ['—', 'شامل', '=']);
});
