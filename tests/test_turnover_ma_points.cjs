const fs=require('fs'),vm=require('vm'),assert=require('assert');
for(const file of ['app.js']) {
 const src=fs.readFileSync(`market/${file}`,'utf8');
 const svg={innerHTML:''};
 const ctx={Intl,Map,Date,Number,Math,numeric:v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v),escapeHtml:String,core:{faDigits:String},$:()=>svg,text:()=>{}};
 vm.createContext(ctx);
 vm.runInContext(src.slice(src.indexOf('  function movingAverage('),src.indexOf('  function renderQueueCountChart(')),ctx);
 ctx.bindTurnoverTooltip=()=>{};
 const daily=Array.from({length:20},(_,i)=>({trading_date:`2026-09-${String(i+10).padStart(2,'0')}`,turnover_scope:'common_stocks_plus_leveraged_funds',complete:true,final_turnover_toman:(i+1)*1e12}));
 ctx.renderTurnoverChart({daily});
 assert(svg.innerHTML.includes('data-ma20-count="1"'));
 assert.equal((svg.innerHTML.match(/class="ma20-point"/g)||[]).length,1,`${file}: singleton MA20 must have visible circle`);
 assert(svg.innerHTML.includes('data-value-hmt="10.5"'), 'actual 20-day average');
 ctx.renderTurnoverChart({daily:daily.slice(0,19)});
 assert(!svg.innerHTML.includes('class="ma20-point"'), 'no invented short window');
 daily[10].complete=false;
 ctx.renderTurnoverChart({daily});
 assert(!svg.innerHTML.includes('class="ma20-point"'), 'do not bridge invalid history');
 assert.equal((svg.innerHTML.match(/class="turnover-bar"/g)||[]).length,19);
 console.log(file,'PASS singleton, exact average, insufficient history, invalid gap');
}
