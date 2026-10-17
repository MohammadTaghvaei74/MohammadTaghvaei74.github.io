const test=require('node:test');const assert=require('node:assert/strict');const R=require('../market/ranking.js');
test('missing types never become numeric zero',()=>{for(const v of [' ',[],{},false,null,undefined])assert.equal(R.num(v),null);assert.equal(R.num(0),0);});
