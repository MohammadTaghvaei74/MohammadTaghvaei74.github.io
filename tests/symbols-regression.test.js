const test=require('node:test'), assert=require('node:assert/strict'), C=require('../market/symbols/core.js');
test('partial universe and historical symbol inventory remain available',()=>{const u=C.buildUniverse({top_stocks:[{symbol:'A',score:0}]},{symbols:['B'],rows:[]});assert.equal(u.bySymbol.size,2);assert.equal(u.partial,true);});
test('chart gaps are moves not connected lines',()=>{assert.equal(C.path([1,null,2],i=>i,v=>v),'M0,1 M2,2');});
test('threshold uses score reaching stock or leveraged boundary',()=>{assert.deepEqual(C.thresholds([3,-2],false),[3]);assert.deepEqual(C.thresholds([3,-4],true),[-4]);});
test('csv escapes formula strings but retains negative numeric values',()=>{assert.equal(C.csv([[-3,'=bad']]),'"-3","\'=bad"');});
test('symbol dossier uses one score chart with candle/line modes and no raw minute table',()=>{
  const source=require('fs').readFileSync(require('path').join(__dirname,'../market/symbols/symbols.js'),'utf8');
  assert.match(source,/data-score-mode/);
  assert.match(source, /\['1m', '15m', '30m', '1d'\]/);
  assert.match(source,/data-open=/);
  assert.match(source,/data-high=/);
  assert.match(source,/data-low=/);
  assert.match(source,/data-close=/);
  assert.match(source,/score-grid-line/);
  assert.doesNotMatch(source,/minuteTable\(/);
  assert.doesNotMatch(source,/priceCandles\(/);
  assert.doesNotMatch(source,/id="minuteData"/);
});
