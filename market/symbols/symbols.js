'use strict';
(function () {
  const $ = (selector) => document.querySelector(selector);
  const C = window.SymbolCore;
  const M = window.MarketCore;
  let market = null, archive = null, manifest = {};
  let items = [], selected = null;
  let scoreView = { timeframe: '15m', day: null, mode: 'candle' };
  const isLeverageMember = (r, item) => r&&r.symbol===item.symbol;
  const esc = (value) => C.text(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const num = C.number;
  const score = (value) => { const n = num(value); return n === null ? '—' : C.format(n, 1); };
  const integer = (value) => num(value) === null ? '—' : C.integer(value);
  const money = (value, divisor, suffix, digits = 1) => { const n = num(value); return n === null ? '—' : C.format(n / divisor, digits) + suffix; };
  const billion = (value) => money(value, 1e9, ' B', 0);
  const million = (value) => money(value, 1e6, ' M');
  const millionBare = (value) => money(value, 1e6, '');
  const hmt = (value) => money(value, 1e12, ' همت');
  const signed = (value, digits = 1) => { const n = num(value); return n === null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + C.format(Math.abs(n), digits); };
  const rank = (value, total) => { const n = num(value), t = num(total); return n === null || t === null || !t ? '—' : C.digits(n) + ' از ' + C.digits(t); };
  const fmtTime = (raw) => { const d = new Date(raw); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fa-IR', { timeZone:'Asia/Tehran', year:'numeric', month:'2-digit', day:'2-digit' }) + ' · ' + d.toLocaleTimeString('fa-IR', { timeZone:'Asia/Tehran', hour:'2-digit', minute:'2-digit' }); };
  const faDate = (day) => { const d = new Date(String(day) + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fa-IR-u-ca-persian', { timeZone:'UTC', year:'numeric', month:'2-digit', day:'2-digit' }); };
  const load = (url) => Promise.resolve().then(() => { const controller = typeof AbortController === 'function' ? new AbortController() : null; const options = controller ? { cache:'no-store', signal:controller.signal } : { cache:'no-store' }; return fetch(url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now(), options); }).then((r) => { if (!r.ok) throw Error('HTTP ' + r.status); return r.json(); });
  const download = (data, type, name) => { const url = URL.createObjectURL(new Blob([data], {type})); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
  const csv = (rows) => rows.map((row) => row.map((v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const group = (title, fields) => '<section class="metric-group"><h3>' + esc(title) + '</h3><div class="fields">' + fields.map((f) => '<div class="field"><span>' + esc(f[0]) + '</span><b><bdi>' + esc(f[1] === null || f[1] === undefined ? '—' : f[1]) + '</bdi></b></div>').join('') + '</div></section>';


  function scoreCandles(candlesByFrame, timeframe, day, mode) {
    const source = Array.isArray(candlesByFrame && candlesByFrame[timeframe]) ? candlesByFrame[timeframe] : [];
    const days = Array.from(new Set(source.map((row) => row && row.day).filter(Boolean))).sort();
    const activeDay = timeframe === '1d' ? null : (days.includes(day) ? day : days[days.length - 1]);
    let rows = timeframe === '1d' ? source : source.filter((row) => row.day === activeDay);
    if (timeframe !== '1d' && activeDay) {
      const width = timeframe === '1m' ? 1 : timeframe === '30m' ? 30 : 15;
      const byTime = new Map(rows.map((row) => [String(row.time).slice(11, 16), row]));
      const slots = [];
      for (let minute = 9 * 60; minute < 12 * 60 + 30; minute += width) {
        slots.push(String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'));
      }
      rows = slots.map((time) => byTime.get(time) || null);
    }
    const observed = rows.filter(Boolean);
    const options = days.slice().reverse().map((value) => '<option value="' + esc(value) + '" ' + (value === activeDay ? 'selected' : '') + '>' + esc(faDate(value)) + '</option>').join('');
    const timeframeButtons = ['1m', '15m', '30m', '1d'].map((key) => '<button type="button" data-score-timeframe="' + key + '" class="' + (key === timeframe ? 'active' : '') + '">' + (key === '1m' ? '۱ دقیقه' : key === '15m' ? '۱۵ دقیقه' : key === '30m' ? '۳۰ دقیقه' : '۱ روزه') + '</button>').join('');
    const modeButtons = ['candle', 'line'].map((key) => '<button type="button" data-score-mode="' + key + '" class="' + (key === mode ? 'active' : '') + '">' + (key === 'candle' ? 'کندل' : 'خطی') + '</button>').join('');
    const controls = '<div class="score-candle-controls"><div class="score-control-group"><span class="score-control-label">تایم‌فریم</span><div class="score-timeframes">' + timeframeButtons + '</div></div><div class="score-control-group"><span class="score-control-label">نوع نمودار</span><div class="score-chart-modes">' + modeButtons + '</div></div>' + (timeframe === '15m' || timeframe === '30m' ? '<label class="score-day-label">روز <select id="scoreDay">' + options + '</select></label>' : '') + '</div>';
    if (!observed.length) return '<div class="symbol-chart"><div class="symbol-chart-head"><b>نمودار امتیاز سهم</b><small>داده معتبر برای این بازه موجود نیست.</small></div>' + controls + '<p class="meta">برای این سهم در جلسه ۰۹:۰۰ تا ۱۲:۳۰ نمونه‌ای ثبت نشده است.</p></div>';

    const W = 980, H = 360, left = 78, right = 950, top = 24, bottom = 68;
    const values = observed.flatMap((row) => [row.open, row.high, row.low, row.close].map(num)).filter((value) => value !== null);
    let lo = Math.min(...values), hi = Math.max(...values); if (lo === hi) { lo -= 1; hi += 1; }
    const rawStep = (hi - lo) / 5, magnitude = Math.pow(10, Math.floor(Math.log10(rawStep))), normalized = rawStep / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const tickStep = nice * magnitude, axisLo = Math.floor(lo / tickStep) * tickStep, axisHi = Math.ceil(hi / tickStep) * tickStep;
    lo = axisLo; hi = axisHi;
    const x = (index) => left + index * (right - left) / Math.max(1, rows.length - 1);
    const y = (value) => H - bottom - (value - lo) * (H - bottom - top) / (hi - lo);
    const tickText = (value) => C.format(value, Math.abs(value - Math.round(value)) < 0.0001 ? 0 : 1);
    let grid = '';
    for (let tick = axisLo; tick <= axisHi + tickStep / 2; tick += tickStep) {
      const yy = y(tick);
      grid += '<line x1="' + left + '" x2="' + right + '" y1="' + yy + '" y2="' + yy + '" class="score-grid-line"/><text x="' + (left - 12) + '" y="' + (yy + 4) + '" text-anchor="end" class="score-axis-label">' + esc(tickText(tick)) + '</text>';
    }
    const step = (right - left) / Math.max(1, rows.length - 1), bodyWidth = Math.max(3, Math.min(22, step * 0.62));
    let plots = '', linePaths = '', hitAreas = '';
    let segment = [];
    const flushSegment = () => { if (segment.length > 1) linePaths += '<path d="' + segment.join(' ') + '" class="score-close-line"/>'; segment = []; };
    rows.forEach((row, index) => {
      if (!row) { flushSegment(); return; }
      const o = num(row.open), h = num(row.high), l = num(row.low), c = num(row.close);
      if ([o, h, l, c].some((value) => value === null)) { flushSegment(); return; }
      const cx = x(index), bodyTop = y(Math.max(o, c)), bodyBottom = y(Math.min(o, c)), rising = c >= o;
      const label = timeframe === '1d' ? faDate(row.day) : String(row.time).slice(11, 16);
      if (mode === 'line') segment.push((segment.length ? 'L' : 'M') + cx.toFixed(2) + ' ' + y(c).toFixed(2));
      else plots += '<g class="daily-candle ' + (rising ? 'up' : 'down') + '"><line x1="' + cx + '" x2="' + cx + '" y1="' + y(h) + '" y2="' + y(l) + '"/><rect x="' + (cx - bodyWidth / 2) + '" y="' + bodyTop + '" width="' + bodyWidth + '" height="' + Math.max(3, bodyBottom - bodyTop) + '" rx="2"/></g>';
      hitAreas += '<rect class="score-hit-area" data-score-index="' + index + '" data-score-x="' + cx + '" data-score-y="' + y(c) + '" data-open="' + o + '" data-high="' + h + '" data-low="' + l + '" data-close="' + c + '" data-label="' + esc(label) + '" x="' + (cx - Math.max(8, step / 2)) + '" y="' + top + '" width="' + Math.max(16, step) + '" height="' + (H - bottom - top) + '"/>';
    });
    flushSegment();
    const labelIndexes = rows.map((_, index) => index).filter((index) => index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2));
    const labels = labelIndexes.map((index) => { const row = rows[index]; const label = row ? (timeframe === '1d' ? faDate(row.day) : String(row.time).slice(11, 16)) : ''; return '<text x="' + x(index) + '" y="' + (H - 22) + '" text-anchor="middle" class="score-time-label">' + esc(label) + '</text>'; }).join('');
    const title = timeframe === '1d' ? 'امتیاز روزانه · ۳۰ روز اخیر' : 'امتیاز · ' + (timeframe === '1m' ? '۱ دقیقه‌ای · روز جاری' : timeframe === '15m' ? '۱۵ دقیقه‌ای' : '۳۰ دقیقه‌ای') + ' · ' + (activeDay ? esc(faDate(activeDay)) : 'آخرین روز');
    const tip = '<div class="score-tooltip" hidden></div>';
    return '<div class="symbol-chart score-chart-root" data-chart-width="' + W + '"><div class="symbol-chart-head"><b>' + title + '</b><small>' + (mode === 'line' ? 'مقدار بسته‌شدن هر کندل به هم وصل شده؛ شکاف‌های بدون داده حفظ شده‌اند' : 'باز / بیشینه / کمینه / بسته از نمونه‌های واقعی؛ بدون پرکردن شکاف‌ها') + '</small></div>' + controls + '<div class="score-chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="daily-candle-chart score-candle-chart" role="img" aria-label="' + esc(title) + '">' + grid + '<line class="score-crosshair-x" x1="0" x2="0" y1="' + top + '" y2="' + (H - bottom) + '"/><line class="score-crosshair-y" x1="' + left + '" x2="' + right + '" y1="0" y2="0"/>' + plots + linePaths + hitAreas + labels + '</svg>' + tip + '</div></div>';
  }

  function bindScoreInteractions(root) {
    if (!root) return;
    const tooltip = root.querySelector('.score-tooltip'), crossX = root.querySelector('.score-crosshair-x'), crossY = root.querySelector('.score-crosshair-y'), svg = root.querySelector('svg');
    const hide = () => { tooltip.hidden = true; crossX.style.opacity = '0'; crossY.style.opacity = '0'; };
    const show = (event) => {
      const hit = event.currentTarget;
      if (!hit.dataset.open) { hide(); return; }
      const label = hit.dataset.label || '';
      tooltip.innerHTML = '<b>' + esc(label) + '</b><span><i>O</i> ' + esc(score(hit.dataset.open)) + '</span><span><i>H</i> ' + esc(score(hit.dataset.high)) + '</span><span><i>L</i> ' + esc(score(hit.dataset.low)) + '</span><span><i>C</i> ' + esc(score(hit.dataset.close)) + '</span>';
      const svgBox = svg.getBoundingClientRect(), rootBox = root.getBoundingClientRect();
      tooltip.style.left = Math.max(80, Math.min(rootBox.width - 80, (Number(hit.dataset.scoreX) / Number(root.dataset.chartWidth)) * svgBox.width + (svgBox.left - rootBox.left))) + 'px';
      tooltip.style.top = '8px'; tooltip.hidden = false;
      crossX.setAttribute('x1', hit.dataset.scoreX); crossX.setAttribute('x2', hit.dataset.scoreX); crossX.style.opacity = '1';
      crossY.setAttribute('y1', hit.dataset.scoreY); crossY.setAttribute('y2', hit.dataset.scoreY); crossY.style.opacity = '1';
    };
    root.querySelectorAll('.score-hit-area').forEach((hit) => { hit.addEventListener('pointerenter', show); hit.addEventListener('pointermove', show); });
    root.addEventListener('pointerleave', hide); root.addEventListener('blur', hide, true);
  }

  function renderScorePanel(payload) {
    const candlesByFrame = payload && payload.candles ? payload.candles : {};
    const available = Array.isArray(candlesByFrame[scoreView.timeframe]) && candlesByFrame[scoreView.timeframe].length;
    if (!available && scoreView.timeframe !== '1d' && Array.isArray(candlesByFrame['1d']) && candlesByFrame['1d'].length) scoreView = { timeframe: '1d', day: null, mode: scoreView.mode };
    $('#scoreChart').innerHTML = scoreCandles(candlesByFrame, scoreView.timeframe, scoreView.day, scoreView.mode);
    $('#scoreChart').querySelectorAll('[data-score-timeframe]').forEach((button) => { button.onclick = () => { scoreView = { timeframe: button.dataset.scoreTimeframe, day: scoreView.day, mode: scoreView.mode }; renderScorePanel(payload); }; });
    $('#scoreChart').querySelectorAll('[data-score-mode]').forEach((button) => { button.onclick = () => { scoreView = { timeframe: scoreView.timeframe, day: scoreView.day, mode: button.dataset.scoreMode }; renderScorePanel(payload); }; });
    const daySelect = $('#scoreDay'); if (daySelect) daySelect.onchange = () => { scoreView.day = daySelect.value; renderScorePanel(payload); };
    bindScoreInteractions($('#scoreChart .score-chart-root'));
  }


  function renderList() {
    const q = C.normalize($('#q').value), key = $('#sort').value;
    const list = items.filter((item) => !q || C.normalize(item.symbol + ' ' + ((item.current && item.current.industry) || '')).includes(q));
        list.sort((a,b) => key === 'symbol' ? a.symbol.localeCompare(b.symbol, 'fa') : key === 'history' ? b.history.length-a.history.length : ((num(b.current && b.current[key === 'pct' ? 'last_pct' : 'score']) === null ? -Infinity : num(b.current && b.current[key === 'pct' ? 'last_pct' : 'score'])) - (num(a.current && a.current[key === 'pct' ? 'last_pct' : 'score']) === null ? -Infinity : num(a.current && a.current[key === 'pct' ? 'last_pct' : 'score']))));
    $('#shown').textContent = C.integer(list.length) + ' نماد';
    $('#list').innerHTML = list.map((item) => '<a class="row ' + (item.symbol === selected ? 'sel' : '') + '" href="?symbol=' + encodeURIComponent(item.symbol) + '"><span><b>' + esc(item.symbol) + '</b><small>' + esc(item.current && item.current.industry || 'فقط آرشیو تاریخی') + '</small></span><strong>' + esc(item.current ? score(item.current.score) : C.integer(item.history.length) + ' روز') + '</strong></a>').join('') || '<p class="empty">نمادی پیدا نشد.</p>';
  }

  function select(symbol, push = false) {
    selected = symbol;
    scoreView = { timeframe: '15m', day: null, mode: 'candle' };
    if (push) history.pushState(null, '', '?symbol=' + encodeURIComponent(symbol));
    renderList();
    const item = items.find((x) => x.symbol === symbol);
    if (!item) { $('#dossier').innerHTML = '<div class="empty"><h2>یک سهم را انتخاب کن</h2><p>از فهرست جست‌وجو و انتخاب کنید.</p></div>'; return; }
    const c = item.current || {}, daily = item.history.slice(-30);
    const groups = c ? [
      group('امتیاز و جایگاه', [['امتیاز فعلی', score(c.score)], ['جایگاه از لحاظ امتیاز', rank(c.score_rank, c.score_rank_total)]]),
      group('صف و معاملات', [['ارزش صف', billion((num(c.buy_queue_value_toman) || 0) > 0 ? c.buy_queue_value_toman : c.sell_queue_value_toman)], ['حجم معاملات امروز', million(c.trade_volume)], ['حجم معاملات میانگین ۱۵ روز اخیر', million(c.avg15_trade_volume)], ['ارزش معاملات امروز', billion(c.trade_value_toman)], ['ارزش معاملات میانگین ۱۵ روز اخیر', billion(c.avg15_trade_value_toman)], ['جایگاه ارزش معاملات', rank(c.avg15_trade_value_rank, c.avg15_trade_value_rank_total)]]),
      group('رفتار معامله‌گران', [['سرانه خرید', millionBare(c.buy_per_capita_toman)], ['سرانه فروش', million(c.sell_per_capita_toman)], ['جایگاه سرانه خرید', rank(c.buy_per_capita_rank, c.buy_per_capita_rank_total)], ['قدرت', score(c.buyer_power)], ['جایگاه قدرت', rank(c.buyer_power_rank, c.buyer_power_rank_total)]]),
      group('مشخصات سهم', [['صنعت', c.industry || '—'], ['مارکت کپ', hmt(c.market_cap_hmt)], ['جایگاه مارکت کپ', rank(c.market_cap_rank, c.market_cap_rank_total)]])
    ] : [];
    const tsetmc = c.tsetmc_url ? '<a class="tsetmc-link" href="' + esc(c.tsetmc_url) + '" target="_blank" rel="noopener">صفحه سهم در TSETMC ↗</a>' : '';
    $('#dossier').innerHTML = '<div class="dossier-head"><div><span class="tag">' + (c.score !== undefined ? 'آخرین snapshot' : 'فقط آرشیو تاریخی') + '</span><h2>' + esc(symbol) + '</h2><p class="meta">' + (c.timestamp ? 'زمان منبع: ' + esc(M.formatDate(c.timestamp)) : 'در snapshot جاری داده‌ای برای این نماد نداریم.') + '</p></div><div class="head-actions">' + tsetmc + '<button class="share" id="copyLink">کپی لینک</button></div></div><div class="metric-groups">' + groups.join('') + '</div><div id="scoreChart" class="chartbox"><p class="meta">در حال دریافت نمودار امتیاز…</p></div><div class="export-actions"><button class="share" id="dailyCsv">دانلود CSV روزانه</button><button class="share" id="dailyXlsx">دانلود Excel روزانه</button><span class="meta">' + C.integer(daily.length) + ' روز اخیر؛ داده ناموجود با «—» نمایش داده می‌شود.</span></div>';
    $('#copyLink').onclick = () => navigator.clipboard && navigator.clipboard.writeText(location.href);
    $('#dailyCsv').onclick = () => download('\ufeff' + csv([['تاریخ','نماد','تعداد نمونه','میانگین','میانه','کمینه','بیشینه','آخرین','کیفیت'], ...daily.map((r) => [r.day,r.symbol,r.count,r.mean,r.median,r.min,r.max,r.last,r.quality])]), 'text/csv;charset=utf-8', symbol + '-score-history.csv');
    $('#dailyXlsx').onclick = () => { if (!window.XLSX) return; const sheet = XLSX.utils.json_to_sheet(daily.map((r) => ({ 'تاریخ':r.day,'نماد':r.symbol,'تعداد نمونه':r.count,'میانگین امتیاز':r.mean,'میانه امتیاز':r.median,'کمینه':r.min,'بیشینه':r.max,'آخرین امتیاز':r.last,'کیفیت':r.quality }))); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Score History'); XLSX.writeFile(book, symbol + '-score-history.xlsx'); };
    const info = manifest[symbol];
    if (!info) { renderScorePanel({ candles: {} }); return; }
    load('data/' + info.file).then((payload) => { renderScorePanel(payload); }).catch(() => { renderScorePanel({ candles: {} }); });
  }

  function refresh() {
    Promise.all([load('../data/market.json'), load('../history/data/history.json'), load('data/history-manifest.json')]).then(([m,h,man]) => {
      market=m; archive=h; manifest=man.symbols || {};
      const bySymbol=new Map(); (market.stocks || []).forEach((row) => bySymbol.set(row.symbol, {symbol:row.symbol,current:row,history:[]}));
      (archive.rows || []).forEach((row) => { if(!bySymbol.has(row.symbol)) bySymbol.set(row.symbol,{symbol:row.symbol,current:null,history:[]}); bySymbol.get(row.symbol).history.push(row); });
      items=Array.from(bySymbol.values());
      $('#archiveDays').textContent=C.integer(archive.valid_day_count); $('#archiveRows').textContent=C.integer(archive.row_count); $('#archiveLastDay').textContent=faDate(archive.generated_at);
      const wanted=new URLSearchParams(location.search).get('symbol'); select(wanted || (items[0] ? items[0].symbol : null)); $('#availability').textContent='داده سهم آماده است';
    }).catch(() => { $('#availability').textContent='دریافت داده ناموفق بود'; $('#list').innerHTML='<p class="empty">داده سهم در دسترس نیست.</p>'; });
  }
  $('#q').oninput=renderList; $('#sort').onchange=renderList; $('#refresh').onclick=refresh; const archiveDownload=$('#downloadAllArchive'); if(archiveDownload) archiveDownload.onclick=()=>{ location.href='../history/data/market-score-history.xlsx'; }; window.addEventListener('popstate',()=>select(new URLSearchParams(location.search).get('symbol'))); refresh();
})();
