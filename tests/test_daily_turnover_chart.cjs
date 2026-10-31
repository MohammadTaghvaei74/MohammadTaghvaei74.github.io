const fs = require('fs'), vm = require('vm'), assert = require('assert');
for (const file of ['app.js','app-fast-recovery-20261024-axis.js']) {
 const source = fs.readFileSync(`market/${file}`, 'utf8');
 const start = source.indexOf('  function movingAverage('), end = source.indexOf('  function renderQueueCountChart(',start);
 const svg = {innerHTML:''}, status = {textContent:''};
 const context = {Intl, Map, Date, Number, Math, console, numeric: v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v), escapeHtml: String,
  core:{faDigits:String}, $: s => s === '#turnoverChart' ? svg : status, text: (s,v)=>status.textContent=v};
 vm.createContext(context); vm.runInContext(source.slice(start,end),context);
 const daily = Array.from({length:30},(_,i)=>({trading_date: new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10), final_turnover_toman:(i+1)*1e12})).reverse();
 context.renderTurnoverChart({daily});
 assert.equal((svg.innerHTML.match(/class="turnover-bar"/g)||[]).length,30,`${file}: one bar per trading day`);
 assert.ok(svg.innerHTML.includes('data-ma5-count="26"'));
 assert.ok(svg.innerHTML.includes('data-ma20-count="11"'));
 assert.ok(svg.innerHTML.includes('<title>'));
 assert.ok(svg.innerHTML.includes('۱۴۰۵'), 'Persian calendar');
 assert.ok(!/\bC\d/.test(svg.innerHTML), 'no cubic smoothing');
 context.renderTurnoverChart({daily:daily.slice(0,7)});
 assert.ok(status.textContent.includes('۲۰'), 'insufficient MA20 explanation');
 assert.ok(svg.innerHTML.includes('data-ma20-count="0"'));
 assert.equal(context.movingAverage([1,2,3,4,5],5)[4],3);
 assert.equal(context.movingAverage([1,2,null,4,5],5)[4],null);
 console.log(file, 'PASS bars, full-window MA, Persian calendar, tooltip, insufficient history');
}
assert.ok(fs.readFileSync('market/index.html','utf8').includes('id="turnover-section"'));
assert.ok(fs.readFileSync('market/observation-ui.js','utf8').includes("if (within('#turnoverChart'))"), 'daily archive needs its own source range');
