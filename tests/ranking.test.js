'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const R=require('../market/ranking.js');
test('chooses full feed and preserves top fallback',()=>{assert.equal(R.choose({stocks:[{symbol:'الف'}],top_stocks:[{symbol:'ب'}]}).partial,false);assert.equal(R.choose({top_stocks:[{symbol:'ب'}]}).partial,true)});
test('normalizes Persian search and sorts scores',()=>{const rows=[{symbol:'كيان',score:2},{symbol:'فولاد',score:5},{symbol:'شستا',score:null}];assert.deepEqual(R.filterSort(rows,'کیان','desc').map(x=>x.symbol),['كيان']);assert.deepEqual(R.filterSort(rows,'','asc').map(x=>[x.symbol,x._rank]),[['كيان',1],['فولاد',2],['شستا',3]])});
test('rejects booleans as numeric values',()=>assert.equal(R.num(false),null));
