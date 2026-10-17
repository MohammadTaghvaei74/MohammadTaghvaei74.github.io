const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../market/core.js');
const source = fs.readFileSync(require.resolve('../market/app.js'), 'utf8');
async function run(options, optionOk = true) {
  const elements = {};
  ['marketMedian','optionsStatus','optionsMessage','optionsSource','optionsUpdatedAt','optionsEligibleCount','optionsPairCount','optionsPairs','optionsDiagnostics','optionsContracts','optionsRejected'].forEach(id => {elements['#'+id]={textContent:'',innerHTML:''};});
  const market = {schema_version:1,source:'test',generated_at:'2026-10-17T12:30:00+03:30',market:{},groups:[],top_stocks:[],leveraged:[],industries:[],daily:[]};
  const ctx = {console, AbortController, navigator:{userAgent:''}, document:{querySelector:s=>elements[s]||null,querySelectorAll:()=>[],addEventListener:()=>{},visibilityState:'visible'},window:{MarketCore:core,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,addEventListener:()=>{}},fetch: async url => ({ok:url.includes('options.json')?optionOk:true,json:async()=>url.includes('options.json')?options:market})};
  vm.runInNewContext(source,ctx);
  await new Promise(resolve=>setImmediate(resolve));
  return elements;
}
test('loads independent options feed and missing file cannot break market', async()=>{
  const e=await run({schema_version:1,status:'insufficient_data',message:'سابقه کافی نیست',source_at:new Date().toISOString(),counts:{eligible_pairs:0},pairs:[],diagnostics:[]});
  assert.equal(e['#optionsMessage'].textContent,'سابقه کافی نیست');
  const missing=await run(null,false);
  assert.match(missing['#optionsStatus'].textContent,/دسترس/);
});
test('rejected pairs never appear in eligible table; raw contracts still visible', async()=>{
  const e=await run({schema_version:1,status:'insufficient_data',source_at:new Date().toISOString(),counts:{contracts:1,pairs:1,eligible_pairs:0},pairs:[{underlying:'TEST_REJECTED',eligible:false,reasons:['نقدشوندگی ناکافی']}],contracts:[{symbol:'TEST_CONTRACT',underlying:'پایه',ask_toman:12.5,bid_toman:11.2,history_days:0,reasons:['سابقه ناقص']}],diagnostics:[]});
  assert.doesNotMatch(e['#optionsPairs'].innerHTML,/TEST_REJECTED/);
  assert.match(e['#optionsRejected'].innerHTML,/TEST_REJECTED/);
  assert.match(e['#optionsContracts'].innerHTML,/TEST_CONTRACT/);
  assert.match(e['#optionsRejected'].innerHTML,/نقدشوندگی ناکافی/);
});
test('stale snapshot cannot display ready eligibility and uses source timestamp', async()=>{
  const e=await run({schema_version:1,status:'ready',generated_at:new Date().toISOString(),source_at:'2026-01-01T09:00:00+03:30',counts:{eligible_pairs:1},pairs:[{underlying:'STALE_PAIR',eligible:true}],contracts:[],diagnostics:[]});
  assert.match(e['#optionsStatus'].textContent,/قدیمی/);
  assert.doesNotMatch(e['#optionsPairs'].innerHTML,/STALE_PAIR/);
  assert.equal(e['#optionsUpdatedAt'].textContent,core.formatDate('2026-01-01T09:00:00+03:30'));
});

