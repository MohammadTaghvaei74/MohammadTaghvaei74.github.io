'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../market/symbols/core.js');
test('symbol core exists and rejects non-scalar numeric and text data; Persian search is normalized', () => {
  assert.ok(fs.existsSync(modulePath), 'extracted symbol core must exist');
  const C = require(modulePath);
  for (const value of [null, undefined, false, true, {}, [], '', ' ', NaN, Infinity]) assert.equal(C.number(value), null);
  assert.equal(C.number('0'), 0);
  for (const value of [null, undefined, false, {}, []]) assert.equal(C.text(value), '');
  assert.equal(C.normalize(' كِيـان‌ ۱۲٣ '), C.normalize('کیان123'));
});
const C = require(modulePath);
test('universe indexes history once, preserves archive-only symbols and ranks valid current scores', () => {
  const data=C.buildUniverse({stocks:[{symbol:'الف',score:0},{symbol:'ب',score:2},{symbol:'ج',score:2},{symbol:'د',score:false},null]}, {rows:[{symbol:'قدیم',day:'2026-01-02'},{symbol:'قدیم',day:'2026-01-01'}]});
  assert.equal(data.bySymbol.get('قدیم').history.length,2);
  assert.equal(data.bySymbol.get('قدیم').history[0].day,'2026-01-01');
  assert.equal(data.bySymbol.get('الف').rank,3);
  assert.equal(data.bySymbol.get('ب').rank,1);
  assert.equal(data.bySymbol.get('ج').rank,1);
  assert.equal(data.bySymbol.get('د').rank,null);
  assert.equal(data.rankedCount,3);
});
