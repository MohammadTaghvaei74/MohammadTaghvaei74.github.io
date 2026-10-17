"use strict";
let scoreCandles = null;
const candleFa = (v) => String(v).replace(/[0-9]/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const candleNum = v => candleFa(Number(v).toFixed(2));
const candleDate = day => new Date(`${day}T12:00:00Z`).toLocaleDateString("fa-IR", {month:"short", day:"numeric"});
function showCandleDetails(row) { document.querySelector("#candleDetails").innerHTML=`<b>${candleDate(row.day)}</b><br>باز ${candleNum(row.open)} · بیشینه ${candleNum(row.high)} · کمینه ${candleNum(row.low)} · بسته ${candleNum(row.close)}<br><small>${candleFa(row.count)} دقیقه معتبر · اولین نمونه تهران: ${new Date(row.first_timestamp).toLocaleTimeString("fa-IR",{timeZone:"Asia/Tehran"})} · پنجره ۰۹:۱۵ تا ۱۲:۳۰</small>`; }
function renderScoreCandles(symbol) {
  const svg = document.querySelector("#scoreCandleChart"); if (!svg || !scoreCandles) return;
  const rows = scoreCandles.rows.filter(r => r.symbol === symbol).sort((a,b) => a.day.localeCompare(b.day));
  const W=620,H=340,p={l:42,r:16,t:18,b:42};
  if (!rows.length) { svg.innerHTML=""; document.querySelector("#candleDetails").textContent=""; document.querySelector("#candleStatus").textContent="برای این نماد کندل مشاهده‌شده‌ای نیست."; return; }
  const vals=rows.flatMap(r=>[r.open,r.high,r.low,r.close]), min=Math.min(...vals)-.5,max=Math.max(...vals)+.5;
  const x=i=>p.l+(i+.5)*(W-p.l-p.r)/rows.length, y=v=>p.t+(max-v)*(H-p.t-p.b)/(max-min), bw=Math.max(5,Math.min(24,(W-p.l-p.r)/rows.length*.46));
  const grid=[min,(min+max)/2,max].map(t=>`<line class="candle-grid" x1="${p.l}" x2="${W-p.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${p.l-8}" y="${y(t)+4}" text-anchor="end">${candleNum(t)}</text>`).join("");
  const marks=rows.map((r,i)=>{const up=r.close>=r.open,c=up?"candle-up":"candle-down",xx=x(i);return `<g class="${c}" tabindex="0" role="button" data-candle-index="${i}"><line x1="${xx}" x2="${xx}" y1="${y(r.high)}" y2="${y(r.low)}"/><rect x="${xx-bw/2}" y="${Math.min(y(r.open),y(r.close))}" width="${bw}" height="${Math.max(2,Math.abs(y(r.open)-y(r.close)))}"/><title>${candleDate(r.day)}: ${candleNum(r.open)} / ${candleNum(r.high)} / ${candleNum(r.low)} / ${candleNum(r.close)} · ${r.count} samples</title></g>`}).join("");
  const labels=rows.map((r,i)=>(i % Math.max(1,Math.ceil(rows.length/6)) === 0 || i === rows.length-1) ? `<text x="${x(i)}" y="${H-12}" text-anchor="middle">${candleDate(r.day)}</text>` : "").join("");
  svg.innerHTML=grid+marks+labels;
  const last=rows[rows.length-1]; document.querySelector("#candleStatus").textContent=`${candleFa(rows.length)} روز کندل · آخرین روز ${candleDate(last.day)} · ${last.coverage === "complete" ? "پوشش کامل پنجره" : last.coverage === "partial" ? "پوشش ناقص پنجره" : "پوشش تأییدنشده"}`;
  svg.querySelectorAll("[data-candle-index]").forEach(el => { const select=() => showCandleDetails(rows[Number(el.dataset.candleIndex)]); el.addEventListener("click", select); el.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " ") select(); }); });
  showCandleDetails(last);
}
window.renderScoreCandles=renderScoreCandles;
fetch(`data/score-candles.json?ts=${Date.now()}`,{cache:"no-store"}).then(r=>{if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();}).then(d=>{scoreCandles=d; renderScoreCandles(document.querySelector("#symbolInput").value.trim());}).catch(()=>{const e=document.querySelector("#candleStatus");if(e)e.textContent="دریافت کندل‌ها انجام نشد.";});
window.addEventListener("score-archive-ready", e=>renderScoreCandles(e.detail));
// history.js calls renderScoreCandles after the archive selection is rendered.
