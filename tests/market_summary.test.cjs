const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('summary preserves source numbers, real zero and observation; never publication time',()=>{
 assert.ok(fs.existsSync('market/market-summary.js'),'summary module missing');
 const {model}=require('../market/market-summary.js');
 assert.deepEqual(model({market:{median:0,buy_value_hmt:2.4,sell_value_hmt:null},observed_at:'2026-11-01T12:29:00+03:30'}),{median:0,buy:2.4,sell:null,observation:'2026-11-01T12:29:00+03:30'});
 assert.deepEqual(model({market:{median:'',buy_value_hmt:true},published_at:'2026-11-01T18:00:00+03:30'}),{median:null,buy:null,sell:null,observation:null});
 assert.equal(model({generated_at:'2026-11-01T18:00:00+03:30'}).observation,null);
});
