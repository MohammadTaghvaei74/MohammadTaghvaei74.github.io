const test=require('node:test');const assert=require('node:assert/strict');const E=require('../market/industries/industries.js');
test('missing full stocks is not a healthy empty snapshot and null is never zero',()=>{
 assert.throws(()=>E.readStocks({industries:[{industry:'legacy'}]}),/stocks/);
 assert.equal(E.finite('   '),false);assert.equal(E.finite([]),false);assert.equal(E.finite({}),false);
 assert.equal(E.finite(null),false);assert.equal(E.finite(false),false);assert.equal(E.finite(Infinity),false);
 assert.equal(E.formatNumber(null), '—');assert.equal(E.formatToman(null),'—');assert.equal(E.formatNumber(0),'۰');
 assert.equal(typeof E.percentMarkup, 'function');
 assert.match(E.percentMarkup(1.25, 0), /٪/);
 const g=E.buildIndustries({stocks:[{symbol:'الف',industry:'بانک',score:null},{symbol:'ب',industry:'بانک',score:0},{symbol:'ج',industry:'بانک',score:2}]});
 assert.equal(g[0].stocks.length,3);assert.equal(g[0].score,1);assert.equal(g[0].stocks[2].score,null);
});
