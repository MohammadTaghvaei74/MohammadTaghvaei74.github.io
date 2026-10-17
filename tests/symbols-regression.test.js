const test=require('node:test'), assert=require('node:assert/strict'), C=require('../market/symbols/core.js');
test('partial universe and historical symbol inventory remain available',()=>{const u=C.buildUniverse({top_stocks:[{symbol:'A',score:0}]},{symbols:['B'],rows:[]});assert.equal(u.bySymbol.size,2);assert.equal(u.partial,true);});
test('chart gaps are moves not connected lines',()=>{assert.equal(C.path([1,null,2],i=>i,v=>v),'M0,1 M2,2');});
test('threshold uses score reaching stock or leveraged boundary',()=>{assert.deepEqual(C.thresholds([3,-2],false),[3]);assert.deepEqual(C.thresholds([3,-4],true),[-4]);});
test('csv escapes formula strings but retains negative numeric values',()=>{assert.equal(C.csv([[-3,'=bad']]),'"-3","\'=bad"');});
