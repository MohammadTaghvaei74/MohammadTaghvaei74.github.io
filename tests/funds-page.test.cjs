const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = require('../market/funds/funds.js');
test('page provides accessible RTL sections and retained seven-tab menu',()=>{
 const html=fs.readFileSync(path.join(root,'market/funds/index.html'),'utf8');
 assert.match(html,/dir="rtl"/);
 for(const id of ['fundSelect','fundReportRows','holdingsRows','industryRows','stockChart','industryChart','sourceLink','reportDate']) assert.ok(html.includes(`id="${id}"`),id);
 const nav=html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)[0];
 assert.equal((nav.match(/<a /g)||[]).length,7);
 assert.match(nav,/aria-current="page"[^>]*>صندوق‌ها/);
});
test('browser loader independently fetches summary and portfolios and renders selection',async()=>{
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id)) nodes.set(id,{innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,addEventListener(){},setAttribute(){},removeAttribute(){},querySelectorAll(){return []}});return nodes.get(id)};
 const doc={getElementById:node,querySelector:()=>({classList:{toggle(){}}})};
 const calls=[];
 await ui.boot(doc,async url=>{calls.push(url);return {ok:true,json:async()=>url.includes('fund-portfolios')?{funds:[{symbol:'A',name:'Test',status:'partial',source_url:'https://example.com/a.xlsx',holdings:[{name:'Stock',weight_pct:25}]}]}:{rows:[{symbol:'A',liquidity:12}]}}});
 assert.equal(calls.length,2); assert.match(node('holdingsRows').innerHTML,/Stock/);
 assert.match(node('fundReportRows').innerHTML,/A/); assert.equal(node('sourceLink').href,'https://example.com/a.xlsx');
});
test('failed portfolio fetch keeps summary usable and presents honest empty states',async()=>{
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',addEventListener(){},removeAttribute(){},querySelectorAll(){return []}});return nodes.get(id)};
 await ui.boot({getElementById:node},async url=>({ok:!url.includes('fund-portfolios'),json:async()=>({rows:[{symbol:'A',avg_daily_value_billion_toman:42}]})}));
 assert.match(node('fundReportRows').innerHTML,/۴۲/);
 assert.equal(node('sourceLink').hidden,true);
 assert.match(node('portfolioStatus').textContent,/در دسترس نیست/);
 assert.doesNotMatch(node('stockChart').innerHTML,/<svg/);
 assert.equal(node('retryLoad').hidden,false);
});
test('selection uses deep links then available holdings and Persian display helpers',()=>{
 const funds=[{symbol:'A',holdings:[]},{symbol:'B',holdings:[{name:'x'}]}];
 assert.equal(ui.initialSymbol(funds,'',''), 'B');
 assert.equal(ui.initialSymbol(funds,'A',''), 'A');
 assert.equal(ui.initialSymbol(funds,'missing','A'), 'A');
 assert.equal(ui.faText('1405/06/31'), '۱۴۰۵/۰۶/۳۱');
 assert.equal(ui.publicNote('HTTP error secret diagnostic'), 'جزئیات گزارش کامل نیست؛ فایل اصلی را بررسی کنید.');
});
test('portfolio preserves absolute asset weights and unknowns regardless of status', () => {
  const m = ui.portfolioModel({status:'partial', holdings:[{name:'A',weight_pct:25,industry:'X'},{symbol:'B',weight_pct:null},{name:'C',weight_pct:15,industry:'X'}]});
  assert.equal(m.available,true); assert.equal(m.holdings.length,3);
  assert.equal(m.total,40); assert.equal(m.unknown,1); assert.equal(m.remainder,60);
  assert.equal(m.industries.find(x=>x.name==='X').weight_pct,40);
  assert.equal(m.industries.find(x=>x.name==='نامشخص').weight_pct,null);
});
test('source protocol allowlist and HTML escaping', () => {
  assert.equal(ui.safeSource('javascript:alert(1)'),'');
  assert.equal(ui.safeSource('//evil.test/x'),'');
  assert.equal(ui.safeSource('https://codal.ir/a?x=1&y=2'),'https://codal.ir/a?x=1&y=2');
  assert.equal(ui.safeSource('http://example.com/report.xlsx'),'http://example.com/report.xlsx');
  assert.equal(ui.escapeHtml('<img src=x onerror="x">'),'&lt;img src=x onerror=&quot;x&quot;&gt;');
});
test('invalid, zero, missing and overflow weights remain distinct', () => {
  const m=ui.portfolioModel({holdings:[{name:'A',weight_pct:101},{name:'B',weight_pct:0},{name:'C',weight_pct:-1},{name:'D',weight_pct:'9'}]});
  assert.equal(m.overflow,true); assert.equal(m.unknown,2); assert.equal(m.holdings[1].weight_pct,0);
  assert.equal(ui.portfolioModel({holdings:[]}).available,false);
  assert.match(ui.chartMarkup(m.holdings,m,'test'),/بیش از ۱۰۰/);
  assert.doesNotMatch(ui.chartMarkup(m.holdings,m,'test'),/<svg/);
});
test('chart uses total assets and accessible unknown/non-equity legend', () => {
  const m=ui.portfolioModel({holdings:[{name:'<A>',weight_pct:25},{name:'B',weight_pct:null}]});
  const html=ui.chartMarkup(m.holdings,m,'stocks');
  assert.match(html,/stroke-dasharray="25 75"/);
  assert.match(html,/غیرسهامی/); assert.match(html,/&lt;A&gt;/); assert.match(html,/نامشخص/);
  assert.doesNotMatch(html,/<A>/);
});
test('source-only funds supplement selector but preserve summary order',()=>{
  const funds=ui.selectionFunds([{symbol:'A'},{symbol:'B'}],[{symbol:'B',holdings:[{name:'x'}]},{symbol:'C'}]);
  assert.deepEqual(funds.map(x=>x.symbol),['A','B','C']); assert.equal(funds[1].holdings.length,1);
});
