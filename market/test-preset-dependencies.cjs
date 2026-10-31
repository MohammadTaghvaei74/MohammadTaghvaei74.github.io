const test=require('node:test'), assert=require('node:assert/strict'), F=require('./observation-safety.js');
const now=Date.parse('2026-10-31T10:00:00+03:30');
const fixture=()=>({timestamp:'2026-10-31T09:59:30+03:30',legal_buy_pct:50,legal_sell_pct:50,client_type_date:'2026-10-31',client_type_status:'ok',client_type_observed_at:'2026-10-31T09:59:30+03:30',avg_trade_value_toman:4e10,avg_trade_value_provenance:{validated:true,as_of:'2026-10-31',window_start:'2026-10-01',window_end_exclusive:'2026-10-31',expected_sessions:['2026-10-27','2026-10-28'],observed_sessions:['2026-10-27','2026-10-28']}});
const safe=r=>F.comprehensiveSafe([r],['legal_sell_pct','avg_trade_value_toman'],now);
test('old/null client session never borrows current quote or fetch time',()=>{
 for(const date of ['2026-10-28',null,'2026-11-01']) assert.equal(safe({...fixture(),client_type_date:date}),false);
 for(const ts of [null,'2026-10-31T09:50:00+03:30','2026-10-31T10:01:00+03:30','2026-10-31']) assert.equal(safe({...fixture(),client_type_observed_at:ts,client_type_fetched_at:fixture().timestamp}),false);
 assert.equal(safe({...fixture(),client_type_status:'ok_stale'}),false);
});
test('complete validated current dependencies pass; only actual preset keys checked',()=>{
 assert.equal(safe(fixture()),true);
 assert.equal(F.comprehensiveSafe([{...fixture(),legal_buy_pct:null}],['legal_sell_pct','avg_trade_value_toman'],now),true);
 assert.equal(F.comprehensiveSafe([{...fixture(),legal_buy_pct:null}],['legal_buy_pct','avg_trade_value_toman'],now),false);
});
test('history absent/partial/duplicate/future/wrong window fails closed',()=>{
 for(const change of [null,{validated:false},{as_of:'2026-10-28'},{window_start:'2026-10-02'},{window_end_exclusive:'2026-11-01'},{expected_sessions:[]},{observed_sessions:['2026-10-28']},{observed_sessions:['2026-10-28','2026-10-28']},{expected_sessions:['2026-11-01'],observed_sessions:['2026-11-01']}]) {
  const row=fixture();row.avg_trade_value_provenance=change===null?null:{...row.avg_trade_value_provenance,...change};assert.equal(safe(row),false,JSON.stringify(change));
 }
});
test('empty universe, invalid metric and one unsafe member block recommendation',()=>{
 assert.equal(F.comprehensiveSafe([],['legal_sell_pct'],now),false);
 assert.equal(safe({...fixture(),legal_sell_pct:null}),false);
 assert.equal(F.comprehensiveSafe([fixture(),{...fixture(),client_type_date:'2026-10-28'}],['legal_sell_pct'],now),false);
});
