const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = process.env.CHART_TEST_ROOT || path.resolve(__dirname, '..');
const core = require(path.join(root, 'market/core.js'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
function element() { return {children:[],attrs:{},textContent:'',style:{},setAttribute(k,v){this.attrs[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},getBoundingClientRect(){return {left:0,width:1000};}}; }
function median(rows) {
 const svg=element(), tip=element();
 const document={querySelector:s=>s==='#candles'?svg:tip,createElementNS:()=>element()};
 const context=vm.createContext({document,window:{MarketCore:core},Intl,Date});
 const source=read('market/median-history/history.js');
 vm.runInContext(source.slice(source.indexOf('  const $ ='),source.indexOf('  let data;'))+'\nthis.render=render;',context);
 context.render(rows); return {svg,tip};
}
function ascii(s){return String(s).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٬\u200e\u200f]/g,'').replace(/−/g,'-');}
function assertTicks(values){assert.ok(values.length>=2);assert.ok(values.every(Number.isInteger),JSON.stringify(values));assert.equal(new Set(values).size,values.length);const step=values[1]-values[0];assert.ok(step>0);for(let i=1;i<values.length;i++)assert.equal(values[i]-values[i-1],step);}
test('nice integer scales cover fractional, narrow, negative, flat and large ranges',()=>{
 assert.equal(typeof core.integerNiceTicks,'function');
 for(const [lo,hi] of [[-3.59,2.69],[.14,1.43],[.1,.2],[-.9,-.8],[0,0],[3,3],[300,40000]]){const ticks=core.integerNiceTicks(lo,hi);assertTicks(ticks);assert.ok(ticks[0]<=lo);assert.ok(ticks.at(-1)>=hi);}
});
test('median rendered tick labels are distinct uniformly spaced integers',()=>{
 const {svg}=median([row]);const labels=svg.children.filter(n=>n.attrs.x===65);assertTicks(labels.map(n=>Number(ascii(n.textContent))));
 const ys=labels.map(n=>n.attrs.y);for(let i=2;i<ys.length;i++)assert.ok(Math.abs((ys[i]-ys[i-1])-(ys[1]-ys[0]))<.001);
});
for(const file of ['market/app.js','market/app-fast-recovery-20261024-axis.js'])test(file+' queue scale uses integer ticks at true positions',()=>{
 const source=read(file),start=source.indexOf('  function renderQueueChart('),end=source.indexOf('\n  function ',start+5);
 const svg={innerHTML:''};const c=vm.createContext({$:()=>svg,core,numeric:core.number,escapeHtml:String,pathFor:(values,x,y)=>values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')});
 vm.runInContext(source.slice(start,end)+';this.render=renderQueueChart;',c);
 c.render({queue_intraday:[{time:'09:00',buy_value_hmt:2.1,sell_value_hmt:8.9},{time:'09:30',buy_value_hmt:2.3,sell_value_hmt:8.1}]});
 const texts=[...svg.innerHTML.matchAll(/<text[^>]*text-anchor="end">([^<]+)<\/text>/g)].map(m=>Number(ascii(m[1]).replace(' همت','')));assertTicks(texts);
 assert.equal(texts[0],2);assert.equal(texts.at(-1),10);
});
test('symbol candle and line renderers use integer scales without rounding raw points',()=>{
 const source=read('market/symbols/symbols.js');
 const c=vm.createContext({window:{SymbolCore:require(path.join(root,'market/symbols/core.js')),MarketCore:core},document:{},URLSearchParams});
 vm.runInContext(source.slice(source.indexOf('  const $ ='),source.indexOf('  function bindScoreInteractions'))+';this.render=scoreCandles;',c);
 for(const mode of ['candle','line']){
 const html=c.render({'1d':[{day:'2026-10-28',open:1.23,high:2.69,low:-3.59,close:1.78},{day:'2026-10-29',open:1.78,high:2.1,low:.7,close:1.95}]},'1d',null,mode);
 const labels=[...html.matchAll(/class="score-axis-label">([^<]+)<\/text>/g)].map(m=>Number(ascii(m[1])));assertTicks(labels);assert.ok(html.includes('data-open="1.23"'));assert.ok(html.includes('data-close="1.78"'));
 }
});
test('all affected pages load the versioned shared scale before their renderer',()=>{
 for(const [page,renderer] of [['market/index.html','app-fast-recovery-20261024-axis.js'],['market/median-history/index.html','history.js'],['market/symbols/index.html','symbols.js'],['market/history/index.html','candles.js']]){
 const html=read(page);const corePos=html.indexOf('core.js?v=integer-axis-20261101');assert.ok(corePos>=0,page);assert.ok(corePos<html.indexOf(renderer),page);
 }
});
test('archive candle axis uses round integers, retains precise OHLC details',()=>{
 const source=read('market/history/candles.js');const els={};const doc={querySelector:s=>els[s]||(els[s]={innerHTML:'',textContent:'',querySelectorAll:()=>[]})};
 const c=vm.createContext({document:doc,window:{MarketCore:core}});
 vm.runInContext(source.slice(0,source.indexOf('window.renderScoreCandles='))+`;scoreCandles={rows:[{symbol:'X',day:'2026-10-28',open:1.23,high:2.69,low:-3.59,close:1.78,count:5,first_timestamp:'2026-10-28T09:00:00+03:30'}]};renderScoreCandles('X');`,c);
 const labels=[...els['#scoreCandleChart'].innerHTML.matchAll(/<text[^>]*text-anchor="end">([^<]+)<\/text>/g)].map(m=>Number(ascii(m[1])));assertTicks(labels);assert.ok(els['#candleDetails'].innerHTML.includes('۱.۲۳'));
});
const row={key:'2026-10-28/540',date:'2026-10-28',first:'2026-10-28T09:00:00+03:30',last:'2026-10-28T09:04:00+03:30',o:1.23,h:2.69,l:-3.59,c:1.78,n:5,expected:5};
test('median candle pointer and touch/click show exact OHLC and observed times',()=>{
 const {svg,tip}=median([row]);
 assert.doesNotThrow(()=>svg.onpointermove({clientX:515}));
 const fa=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2});
 for(const key of ['o','h','l','c'])assert.ok(tip.textContent.includes(fa.format(row[key])));
 assert.ok(tip.textContent.includes('۰۹:۰۰'));
 assert.ok(tip.textContent.includes('۰۹:۰۴'));
 assert.doesNotThrow(()=>svg.onclick({clientX:515}));
 assert.equal(svg.children.at(-1).attrs.visibility,'visible');
 svg.onpointerleave(); assert.equal(svg.children.at(-1).attrs.visibility,'hidden');
});
