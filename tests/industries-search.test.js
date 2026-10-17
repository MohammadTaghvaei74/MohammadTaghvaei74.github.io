const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../market/industries/industries.js');
test('symbol search selects its industry, while returning every member and preserving rank', () => {
 const groups=E.buildIndustries({stocks:[{symbol:'الف',industry:'فلزات',score:10},{symbol:'بانك',industry:'بانک‌ها',score:2},{symbol:'بي',industry:'بانک ها',score:0}]});
 assert.equal(typeof E.searchSelection,'function');
 const found=E.searchSelection(groups,'بَانک',groups[0]);
 assert.equal(found.selected.rank,2);
 assert.equal(found.visible.length,1);
 assert.equal(found.selected.stocks.length,2);
 assert.equal(E.normalizeFa('عربي كالا'),E.normalizeFa('عربی‌کالا'));
 assert.equal(E.searchSelection(groups,'هیچ',groups[0]).selected,null);
});
