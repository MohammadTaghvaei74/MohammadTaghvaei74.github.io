'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../market/portfolio/portfolio-core.js');

const stocks = [
  {symbol: 'الف', industry: 'سیمان', score: 8, trade_volume: 100},
  {symbol: 'ب', industry: 'سیمان', score: 4, trade_volume: 100},
  {symbol: 'ج', industry: 'سیمان', score: 2, trade_volume: 0},
  {symbol: 'د', industry: 'بانک', score: 7, trade_volume: 100},
];

test('weighted portfolio score includes cash at zero and uses purchase values', () => {
  const result = P.calculatePortfolio({
    holdings: [{symbol: 'الف', value: 300}, {symbol: 'ب', value: 100}],
    cash: 100,
    marketMedian: 5,
    stocks,
  });
  assert.equal(result.totalValue, 500);
  assert.equal(result.totalScore, 5.6);
  assert.equal(result.investedScore, 7);
  assert.equal(Math.round(result.gap * 10) / 10, 0.6);
  assert.equal(result.cashWeight, 0.2);
});

test('untraded symbols receive score zero and rank is based on valid traded peers', () => {
  const result = P.calculatePortfolio({holdings: [{symbol: 'ج', value: 100}], cash: 0, marketMedian: 1, stocks});
  assert.equal(result.totalScore, 0);
  assert.equal(result.holdings[0].status, 'untraded_zero');
  assert.deepEqual(result.holdings[0].rank, {rank: 3, total: 3, industry: 'سیمان'});
});

test('unmatched symbols are visible as missing and do not become zero silently', () => {
  const result = P.calculatePortfolio({holdings: [{symbol: 'ناشناخته', value: 100}], cash: 0, marketMedian: 1, stocks});
  assert.equal(result.totalScore, null);
  assert.equal(result.missing, 1);
  assert.equal(result.holdings[0].status, 'not_found');
});

test('catalog symbols without a current snapshot are distinguishable from unknown symbols', () => {
  const result = P.calculatePortfolio({
    holdings: [{symbol: 'طلا', value: 100}, {symbol: 'ناشناخته', value: 100}],
    cash: 0,
    marketMedian: 1,
    stocks,
    catalog: [{symbol: 'طلا'}],
  });
  assert.equal(result.holdings[0].status, 'snapshot_missing');
  assert.equal(result.holdings[1].status, 'not_found');
  assert.equal(result.totalScore, null);
});

test('industry rank puts higher score first and excludes non-equity industries', () => {
  const ranking = P.industryRanking([...stocks, {symbol: 'اوراق ۱', industry: 'اوراق بدهی', score: 99, trade_volume: 100}]);
  assert.deepEqual(ranking.get('الف'), {rank: 1, total: 3, industry: 'سیمان'});
  assert.equal(ranking.has('اوراق ۱'), false);
});
