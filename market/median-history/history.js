/* Market score history: exact observed minutes only; incomplete buckets are omitted. */
(function (root) {
  'use strict';
  const SESSION_START = 9 * 60;
  const SESSION_END = 12 * 60 + 30;
  const SERIES = 'market';
  function minuteOf(iso) { const m = String(iso).match(/T(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
  function expectedMinutes(frame, day) {
    if (frame === 'daily') return Array.from({length: SESSION_END - SESSION_START + 1}, (_, i) => i + SESSION_START);
    const size = Number(frame), start = SESSION_START + Math.floor((minuteOf(day) - SESSION_START) / size) * size;
    return Array.from({length: size}, (_, i) => start + i);
  }
  function rowsFor(points, day) {
    return points.filter(p => Number.isFinite(p.market) && p.minute.slice(0, 10) === day && minuteOf(p.minute) >= SESSION_START && minuteOf(p.minute) <= SESSION_END)
      .sort((a, b) => a.minute.localeCompare(b.minute));
  }
  function candles(points, frame) {
    const days = [...new Set(points.map(p => p.minute.slice(0, 10)))].sort();
    const out = [];
    for (const day of days) {
      const rows = rowsFor(points, day);
      if (frame === 'daily') {
        const have = new Set(rows.map(p => minuteOf(p.minute)));
        if (!expectedMinutes('daily', day).every(m => have.has(m))) continue;
        const vs = rows.map(p => p.market);
        out.push({key: day, date: day, first: rows[0].minute, last: rows.at(-1).minute, o: vs[0], h: Math.max(...vs), l: Math.min(...vs), c: vs.at(-1), n: rows.length, expected: 211, series: SERIES});
        continue;
      }
      const size = Number(frame);
      for (let start = SESSION_START; start <= SESSION_END; start += size) {
        const bucket = rows.filter(p => minuteOf(p.minute) >= start && minuteOf(p.minute) < Math.min(start + size, SESSION_END + 1));
        const expected = Math.min(size, SESSION_END + 1 - start);
        if (bucket.length !== expected) continue;
        const vs = bucket.map(p => p.market);
        out.push({key: `${day}/${start}`, date: day, first: bucket[0].minute, last: bucket.at(-1).minute, o: vs[0], h: Math.max(...vs), l: Math.min(...vs), c: vs.at(-1), n: bucket.length, expected, series: SERIES});
      }
    }
    return out;
  }
  function samples(points) { return points.filter(p => Number.isFinite(p.market)).map(p => ({minute:p.minute, value:p.market})); }
  if (typeof module !== 'undefined') module.exports = { candles, samples, minuteOf, SESSION_START, SESSION_END };
  if (typeof document === 'undefined') return;

  const $ = s => document.querySelector(s);
  const fa = new Intl.NumberFormat('fa-IR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const integerFa = new Intl.NumberFormat('fa-IR', {maximumFractionDigits: 0});
  const axisStep = (low, high) => Math.max(1, Math.ceil(Math.max(high - low, 1) / 5));
  const axisBounds = (low, high) => { const step = axisStep(low, high); return {low: Math.floor(low / step) * step, high: Math.ceil(high / step) * step, step}; };
  const date = d => new Intl.DateTimeFormat('fa-IR', {timeZone:'Asia/Tehran', month:'2-digit', day:'2-digit', year:'numeric'}).format(new Date(d + 'T12:00:00+03:30'));
  const time = t => String(t).slice(11, 16).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const svgEl = (tag, attrs, text='') => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k,v)); n.textContent = text; return n; };

  function render(rows) {
    const svg = $('#candles');
    const shell = svg.closest('.chart-shell');
    const tip = $('#candle-tip');
    svg.replaceChildren();
    if (!rows.length) { svg.append(svgEl('text', {x:500,y:180,'text-anchor':'middle',class:'axis'}, 'کندل کامل و معتبر موجود نیست')); tip.textContent = 'کندل‌های ناقص یا دارای فاصله نمایش داده نمی‌شوند.'; return; }

    const keys = rows.map(r => r.key);
    const vals = rows.flatMap(r => [r.h, r.l]);
    const raw = axisBounds(Math.min(...vals), Math.max(...vals));
    const low = raw.low - raw.step;
    const high = raw.high + raw.step;
    const left=75, right=955, top=24, bottom=300;
    const x = k => left + (keys.indexOf(k) + .5) / keys.length * (right-left);
    const y = v => bottom - (v-low) / (high-low) * (bottom-top);
    const w = Math.max(3, Math.min(22, (right-left) / keys.length * .55));

    for (let v = raw.low; v <= raw.high; v += raw.step) {
      svg.append(svgEl('line', {x1:left,x2:right,y1:y(v),y2:y(v),stroke:'#d8e0e9'}), svgEl('text', {x:65,y:y(v)+4,'text-anchor':'end',class:'axis'}, integerFa.format(v)));
    }
    if (low <= 0 && high >= 0) svg.append(svgEl('line', {x1:left,x2:right,y1:y(0),y2:y(0),stroke:'#8192a6','stroke-width':1.5}));

    rows.forEach((r, i) => {
      const xx=x(r.key);
      svg.append(svgEl('line',{x1:xx,x2:xx,y1:y(r.h),y2:y(r.l),stroke:'#172c45','stroke-width':2}), svgEl('rect',{x:xx-w/2,y:y(Math.max(r.o,r.c)),width:w,height:Math.max(2,Math.abs(y(r.o)-y(r.c))),fill:r.c<r.o?'#172c45':'#fff',stroke:'#172c45','stroke-width':2,class:'candle-mark'}), svgEl('circle',{cx:xx,cy:y(r.c),r:Math.max(3,w/3),fill:'#e58b2c',class:'candle-point'}));
      if (i % Math.max(1,Math.ceil(rows.length/8))===0 || i===rows.length-1) svg.append(svgEl('text',{x:xx,y:325,'text-anchor':'middle',class:'axis'},r.key.length===10 ? date(r.date) : time(r.first)));
    });

    const hit = rows.map(r => ({r, x:x(r.key), y:y(r.c)}));
    const cross = svgEl('g', {'visibility':'hidden','pointer-events':'none'});
    const vx = svgEl('line',{y1:top,y2:bottom,stroke:'#8a4d0b','stroke-dasharray':'4 3'});
    const hy = svgEl('line',{x1:left,x2:right,stroke:'#8a4d0b','stroke-dasharray':'4 3'});
    cross.append(vx,hy); svg.append(cross);

    let tooltip = shell.querySelector('.chart-tooltip');
    if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.hidden = true; shell.append(tooltip); }
    const show = e => {
      const box = svg.getBoundingClientRect();
      const shellBox = shell.getBoundingClientRect();
      const px = (e.clientX-box.left) * 1000 / box.width;
      const py = (e.clientY-box.top) * 390 / box.height;
      const r = hit.reduce((a,b) => Math.hypot(a.x-px,a.y-py) < Math.hypot(b.x-px,b.y-py) ? a : b);
      cross.setAttribute('visibility','visible'); vx.setAttribute('x1',r.x); vx.setAttribute('x2',r.x); hy.setAttribute('y1',r.y); hy.setAttribute('y2',r.y);
      const label = r.r.key.length === 10 ? 'روزانه' : `${time(r.r.first)} تا ${time(r.r.last)}`;
      tooltip.innerHTML = `<strong>تاریخ: ${date(r.r.date)}</strong><span>لحظه: ${label}</span><span class="selected-value">عدد نقطه: ${fa.format(r.r.c)}</span><span>باز: ${fa.format(r.r.o)} · بیشینه: ${fa.format(r.r.h)}</span><span>کمینه: ${fa.format(r.r.l)} · بسته: ${fa.format(r.r.c)}</span>`;
      tooltip.hidden = false;
      const anchorX = (r.x / 1000) * box.width + (box.left-shellBox.left);
      const anchorY = (r.y / 390) * box.height + (box.top-shellBox.top);
      const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
      tooltip.style.left = `${Math.max(8, Math.min(anchorX + 14, shell.clientWidth - tw - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(anchorY - th - 12, shell.clientHeight - th - 8))}px`;
      tip.textContent = `تاریخ ${date(r.r.date)} · ${label} · عدد روی نقطه: ${fa.format(r.r.c)} · ${integerFa.format(r.r.n)} مشاهده معتبر`;
    };
    svg.onpointermove = show; svg.onclick = show;
    svg.onpointerleave = () => { cross.setAttribute('visibility','hidden'); tooltip.hidden = true; };
  }
  let data;
  function refresh(){ if(data) render(candles(data.points, $('#frame').value)); }
  async function load(){ try { const r=await fetch('../data/market-score-history.json?t='+Date.now(),{cache:'no-store'}); if(!r.ok) throw Error('HTTP '+r.status); data=await r.json(); if(!Array.isArray(data.points)) throw Error('schema'); $('#status').textContent=`پنجره نگهداری: ۳۰ روز تقویمی · ${data.coverage.length} روز دارای داده واقعی · ${data.points.length} مشاهده دقیقه‌ای · ساعت تهران ۰۹:۰۰ تا ۱۲:۳۰`; refresh(); } catch(e) { $('#status').textContent='دریافت تاریخچه ناموفق است؛ '+e.message; } }
  $('#frame').addEventListener('change', refresh); load();
})(typeof window === 'undefined' ? globalThis : window);
