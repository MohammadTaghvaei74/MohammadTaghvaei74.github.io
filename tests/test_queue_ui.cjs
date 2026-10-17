const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('market/app.js', 'utf8');
const start = source.indexOf('  function renderTopBuyQueue(data)');
const end = source.indexOf('  function renderTables(data)', start);
const el = {innerHTML:''};
const ctx = {numeric:v=>v==null?null:Number(v), escapeHtml:String, scoreClass:()=>'', signed:String,
  core:{faDigits:String, formatNumber:(n,d)=>Number(n).toFixed(d)}, $:()=>el};
vm.createContext(ctx);
vm.runInContext(source.slice(start,end)+';this.render=renderTopBuyQueue;',ctx);
ctx.render({top_buy_queue:[{symbol:'AAA',score:1,avg_trade_value_toman:200e9,buy_queue_value_toman:133e9,
 queue_to_avg:0.7,legal_buy_pct:0,legal_sell_pct:12,buy_per_capita_toman:25e6,buyer_power:2}]});
assert.match(el.innerHTML,/>200\.0</);
assert.match(el.innerHTML,/>133\.0</);
assert.match(el.innerHTML,/0\.7/);
assert.match(el.innerHTML,/>0%/);
assert.match(el.innerHTML,/>12%/);
assert.match(el.innerHTML,/>25</);
ctx.render({top_buy_queue:[{symbol:'AAA',legal_buy_pct:null}]});
assert(!el.innerHTML.includes('0%'));
const html=fs.readFileSync('market/index.html','utf8');
assert(html.includes('<th>میانگین ارزش</th>'));
assert(!html.includes('میانگین ارزش ۱۵روز'));
assert(html.includes('<th>سرانه M</th><th>قدرت</th><th>خ حقوقی</th>'));
assert(fs.readFileSync('market/styles.css','utf8').includes('.queue-leaders-table th:nth-child(5),.queue-leaders-table td:nth-child(5){color:var(--ink)}'));
console.log('Queue UI units, ratios, legal zero/missing, headers passed');
