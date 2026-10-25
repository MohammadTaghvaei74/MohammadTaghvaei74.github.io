'use strict';
(function () {
  const $ = (selector) => document.querySelector(selector);
  const C = window.SymbolCore;
  const M = window.MarketCore;
  let market = null, archive = null, candles = [], candleIndex = {}, intraday = {}, manifest = {};
  let items = [], selected = null, minuteRows = [], symbolPayload = null;
  let scoreView = { timeframe: '15m', day: null };
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

  function lineChart(points, key, title, color) {
    const values = points.map((p) => num(p[key])).filter((v) => v !== null);
    if (!values.length) return '<p class="meta">داده دقیقه‌ای این سهم برای امروز منتشر نشده است.</p>';
    const W = 900, H = 250, left = 48, right = 880, top = 18, bottom = 38;
    let lo = Math.min(...values), hi = Math.max(...values); if (lo === hi) { lo -= 1; hi += 1; }
    const x = (i) => left + i * (right - left) / Math.max(1, points.length - 1);
    const y = (v) => H - bottom - (v - lo) * (H - bottom - top) / (hi - lo);
    let path = '', circles = '';
    points.forEach((p, i) => { const v = num(p[key]); if (v === null) return; path += (path ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); circles += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3" fill="' + color + '" tabindex="0"><title>' + esc(p.time || '') + ' · ' + esc(score(v)) + '</title></circle>'; });
    const labels = points.filter((_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map((p) => '<span>' + esc(p.time || '') + '</span>').join('');
    return '<div class="symbol-chart"><div class="symbol-chart-head"><b>' + esc(title) + '</b><small>هر نقطه = یک دقیقه مشاهده‌شده؛ بدون پرکردن دقیقه‌های مفقود</small></div><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '"><line x1="' + left + '" x2="' + right + '" y1="' + y(0) + '" y2="' + y(0) + '" class="chart-zero"/><path d="' + path + '" stroke="' + color + '"/><g>' + circles + '</g></svg><div class="symbol-chart-labels">' + labels + '</div></div>';
  }

  function scoreCandles(candlesByFrame, timeframe, day) {
    const source = Array.isArray(candlesByFrame && candlesByFrame[timeframe]) ? candlesByFrame[timeframe] : [];
    const days = Array.from(new Set(source.map((row) => row && row.day).filter(Boolean))).sort();
    const activeDay = timeframe === '1d' ? null : (days.includes(day) ? day : days[days.length - 1]);
    let rows = timeframe === '1d' ? source : source.filter((row) => row.day === activeDay);
    if (timeframe !== '1d' && activeDay) {
      const width = timeframe === '30m' ? 30 : 15;
      const byTime = new Map(rows.map((row) => [String(row.time).slice(11, 16), row]));
      const slots = [];
      for (let minute = 9 * 60; minute < 12 * 60 + 30; minute += width) {
        slots.push(String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'));
      }
      rows = slots.map((time) => byTime.get(time) || null);
    }
    const observed = rows.filter(Boolean);
    const options = days.slice().reverse().map((value) => '<option value="' + esc(value) + '" ' + (value === activeDay ? 'selected' : '') + '>' + esc(faDate(value)) + '</option>').join('');
    const controls = '<div class="score-candle-controls"><div class="score-timeframes">' + ['15m', '30m', '1d'].map((key) => '<button type="button" data-score-timeframe="' + key + '" class="' + (key === timeframe ? 'active' : '') + '">' + (key === '1d' ? '۱ روزه' : key === '15m' ? '۱۵ دقیقه' : '۳۰ دقیقه') + '</button>').join('') + '</div>' + (timeframe === '1d' ? '' : '<label>روز <select id="scoreDay">' + options + '</select></label>') + '</div>';
    if (!observed.length) return '<div class="symbol-chart"><div class="symbol-chart-head"><b>کندل امتیاز سهم</b><small>داده معتبر برای این بازه موجود نیست.</small></div>' + controls + '<p class="meta">برای این سهم در جلسه ۰۹:۰۰ تا ۱۲:۳۰ نمونه‌ای ثبت نشده است.</p></div>';
    const W = 900, H = 330, left = 58, right = 880, top = 24, bottom = 58;
    const values = observed.flatMap((row) => [row.open, row.high, row.low, row.close].map(num)).filter((value) => value !== null);
    let lo = Math.min(...values), hi = Math.max(...values); if (lo === hi) { lo -= 1; hi += 1; }
    const x = (index) => left + index * (right - left) / Math.max(1, rows.length - 1);
    const y = (value) => H - bottom - (value - lo) * (H - bottom - top) / (hi - lo);
    const step = (right - left) / Math.max(1, rows.length - 1), bodyWidth = Math.max(4, Math.min(24, step * 0.55));
    const plots = rows.map((row, index) => {
      if (!row) return '';
      const o = num(row.open), h = num(row.high), l = num(row.low), c = num(row.close); if ([o, h, l, c].some((value) => value === null)) return '';
      const rising = c >= o, cx = x(index), bodyTop = y(Math.max(o, c)), bodyBottom = y(Math.min(o, c));
      const label = timeframe === '1d' ? faDate(row.day) : String(row.time).slice(11, 16);
      return '<g class="daily-candle ' + (rising ? 'up' : 'down') + '"><line x1="' + cx + '" x2="' + cx + '" y1="' + y(h) + '" y2="' + y(l) + '"/><rect x="' + (cx - bodyWidth / 2) + '" y="' + bodyTop + '" width="' + bodyWidth + '" height="' + Math.max(3, bodyBottom - bodyTop) + '" rx="2"><title>' + esc(label) + ' · باز ' + esc(score(o)) + ' · بالا ' + esc(score(h)) + ' · پایین ' + esc(score(l)) + ' · بسته ' + esc(score(c)) + '</title></rect></g>';
    }).join('');
    const labelIndexes = rows.map((_, index) => index).filter((index) => index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2));
    const labels = labelIndexes.map((index) => { const row = rows[index]; const label = row ? (timeframe === '1d' ? faDate(row.day) : String(row.time).slice(11, 16)) : ''; return '<text x="' + x(index) + '" y="' + (H - 15) + '" text-anchor="middle">' + esc(label) + '</text>'; }).join('');
    const zero = lo <= 0 && hi >= 0 ? '<line x1="' + left + '" x2="' + right + '" y1="' + y(0) + '" y2="' + y(0) + '" class="chart-zero"/>' : '';
    const title = timeframe === '1d' ? 'کندل روزانه امتیاز · ۳۰ روز اخیر' : 'کندل امتیاز · ' + (timeframe === '15m' ? '۱۵ دقیقه‌ای' : '۳۰ دقیقه‌ای') + ' · ' + esc(faDate(activeDay));
    return '<div class="symbol-chart"><div class="symbol-chart-head"><b>' + title + '</b><small>باز / بیشینه / کمینه / بسته از نمونه‌های واقعی؛ بدون پرکردن شکاف‌ها</small></div>' + controls + '<svg viewBox="0 0 ' + W + ' ' + H + '" class="daily-candle-chart score-candle-chart" role="img" aria-label="' + esc(title) + '">' + zero + plots + labels + '</svg><div class="candle-legend"><span class="up">● بسته بالاتر یا برابر باز</span><span class="down">● بسته پایین‌تر از باز</span></div></div>';
  }

  function renderScorePanel(payload) {
    const candlesByFrame = payload && payload.candles ? payload.candles : {};
    const available = Array.isArray(candlesByFrame[scoreView.timeframe]) && candlesByFrame[scoreView.timeframe].length;
    if (!available && scoreView.timeframe !== '1d' && Array.isArray(candlesByFrame['1d']) && candlesByFrame['1d'].length) scoreView = { timeframe: '1d', day: null };
    $('#scoreChart').innerHTML = scoreCandles(candlesByFrame, scoreView.timeframe, scoreView.day);
    $('#scoreChart').querySelectorAll('[data-score-timeframe]').forEach((button) => { button.onclick = () => { scoreView = { timeframe: button.dataset.scoreTimeframe, day: scoreView.day }; renderScorePanel(payload); }; });
    const daySelect = $('#scoreDay'); if (daySelect) daySelect.onchange = () => { scoreView.day = daySelect.value; renderScorePanel(payload); };
  }

  function priceCandles(points) {
    const rows = points.filter((p) => [p.price_open,p.price_high,p.price_low,p.price_close].every((v) => num(v) !== null));
    if (!rows.length) return '<p class="meta">روند قیمت دقیقه‌ای برای این سهم در snapshot فعلی در دسترس نیست.</p>';
    const W=900,H=300,left=48,right=880,top=18,bottom=45, values=rows.flatMap((r)=>[r.price_open,r.price_high,r.price_low,r.price_close].map(num)); let lo=Math.min(...values),hi=Math.max(...values); if(lo===hi){lo-=1;hi+=1;}
    const x=(i)=>left+i*(right-left)/Math.max(1,rows.length-1),y=(v)=>H-bottom-(v-lo)*(H-bottom-top)/(hi-lo);
    const plots=rows.map((r,i)=>{const o=num(r.price_open),h=num(r.price_high),l=num(r.price_low),c=num(r.price_close),cx=x(i),up=c>=o;return '<g class="price-candle '+(up?'up':'down')+'"><line x1="'+cx+'" x2="'+cx+'" y1="'+y(h)+'" y2="'+y(l)+'"/><rect x="'+(cx-3)+'" y="'+y(Math.max(o,c))+'" width="6" height="'+Math.max(2,y(Math.min(o,c))-y(Math.max(o,c)))+'"><title>'+esc(r.time)+' · باز '+esc(integer(o))+' · بسته '+esc(integer(c))+'</title></rect></g>';}).join('');
    const labels=rows.filter((_,i)=>i===0||i===rows.length-1||i===Math.floor(rows.length/2)).map((r)=>'<text x="'+x(rows.indexOf(r))+'" y="'+(H-12)+'" text-anchor="middle">'+esc(r.time)+'</text>').join('');
    return '<div class="symbol-chart"><div class="symbol-chart-head"><b>روند حرکت قیمت · کندل دقیقه‌ای</b><small>فقط قیمت‌های مشاهده‌شده در snapshot امروز</small></div><svg viewBox="0 0 '+W+' '+H+'" class="price-candle-chart" role="img" aria-label="روند حرکت قیمت به صورت کندلی">'+plots+labels+'</svg></div>';
  }

  function minuteTable(rows) {
    if (!rows.length) return '<p class="meta">داده دقیقه‌ای ذخیره‌شده برای این سهم در فهرست عمومی موجود نیست.</p>';
    const body = rows.map((r) => '<tr><td>' + esc(fmtTime(r[0])) + '</td><td><bdi>' + esc(score(r[1])) + '</bdi></td></tr>').join('');
    return '<div class="minute-data-head"><div><h3>کل داده دقیقه‌ای ذخیره‌شده</h3><small>' + C.integer(rows.length) + ' مشاهده واقعی؛ ترتیب زمانی صعودی</small></div><div><button class="share" id="minuteCsv">دانلود CSV</button><button class="share" id="minuteXlsx">دانلود Excel</button></div></div><div class="tablebox minute-tablebox"><table><thead><tr><th>تاریخ و ساعت تهران</th><th>امتیاز</th></tr></thead><tbody>' + body + '</tbody></table></div>';
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
    scoreView = { timeframe: '15m', day: null };
    if (push) history.pushState(null, '', '?symbol=' + encodeURIComponent(symbol));
    renderList();
    const item = items.find((x) => x.symbol === symbol);
    if (!item) { $('#dossier').innerHTML = '<div class="empty"><h2>یک سهم را انتخاب کن</h2><p>از فهرست جست‌وجو و انتخاب کنید.</p></div>'; return; }
    const c = item.current || {}, daily = item.history.slice(-30), points = intraday[item.symbol] || [];
    const groups = c ? [
      group('امتیاز و جایگاه', [['امتیاز فعلی', score(c.score)], ['جایگاه از لحاظ امتیاز', rank(c.score_rank, c.score_rank_total)]]),
      group('صف و معاملات', [['ارزش صف', billion((num(c.buy_queue_value_toman) || 0) > 0 ? c.buy_queue_value_toman : c.sell_queue_value_toman)], ['حجم معاملات امروز', million(c.trade_volume)], ['حجم معاملات میانگین ۱۵ روز اخیر', million(c.avg15_trade_volume)], ['ارزش معاملات امروز', billion(c.trade_value_toman)], ['ارزش معاملات میانگین ۱۵ روز اخیر', billion(c.avg15_trade_value_toman)], ['جایگاه ارزش معاملات', rank(c.avg15_trade_value_rank, c.avg15_trade_value_rank_total)]]),
      group('رفتار معامله‌گران', [['سرانه خرید', millionBare(c.buy_per_capita_toman)], ['سرانه فروش', million(c.sell_per_capita_toman)], ['جایگاه سرانه خرید', rank(c.buy_per_capita_rank, c.buy_per_capita_rank_total)], ['قدرت', score(c.buyer_power)], ['جایگاه قدرت', rank(c.buyer_power_rank, c.buyer_power_rank_total)]]),
      group('مشخصات سهم', [['صنعت', c.industry || '—'], ['مارکت کپ', hmt(c.market_cap_hmt)], ['جایگاه مارکت کپ', rank(c.market_cap_rank, c.market_cap_rank_total)]])
    ] : [];
    const tsetmc = c.tsetmc_url ? '<a class="tsetmc-link" href="' + esc(c.tsetmc_url) + '" target="_blank" rel="noopener">صفحه سهم در TSETMC ↗</a>' : '';
    $('#dossier').innerHTML = '<div class="dossier-head"><div><span class="tag">' + (c.score !== undefined ? 'آخرین snapshot' : 'فقط آرشیو تاریخی') + '</span><h2>' + esc(symbol) + '</h2><p class="meta">' + (c.timestamp ? 'زمان منبع: ' + esc(M.formatDate(c.timestamp)) : 'در snapshot جاری داده‌ای برای این نماد نداریم.') + '</p></div><div class="head-actions">' + tsetmc + '<button class="share" id="copyLink">کپی لینک</button></div></div><div class="metric-groups">' + groups.join('') + '</div><div id="scoreChart" class="chartbox"><p class="meta">در حال دریافت کندل‌های امتیاز…</p></div><div class="chartbox">' + priceCandles(points) + '</div><div id="minuteData" class="tablebox"><p class="meta">در حال دریافت دیتای دقیقه‌ای…</p></div><div class="export-actions"><button class="share" id="dailyCsv">دانلود CSV روزانه</button><button class="share" id="dailyXlsx">دانلود Excel روزانه</button><span class="meta">' + C.integer(daily.length) + ' روز اخیر؛ داده ناموجود با «—» نمایش داده می‌شود.</span></div>';
    $('#copyLink').onclick = () => navigator.clipboard && navigator.clipboard.writeText(location.href);
    $('#dailyCsv').onclick = () => download('\ufeff' + csv([['تاریخ','نماد','تعداد نمونه','میانگین','میانه','کمینه','بیشینه','آخرین','کیفیت'], ...daily.map((r) => [r.day,r.symbol,r.count,r.mean,r.median,r.min,r.max,r.last,r.quality])]), 'text/csv;charset=utf-8', symbol + '-score-history.csv');
    $('#dailyXlsx').onclick = () => { if (!window.XLSX) return; const sheet = XLSX.utils.json_to_sheet(daily.map((r) => ({ 'تاریخ':r.day,'نماد':r.symbol,'تعداد نمونه':r.count,'میانگین امتیاز':r.mean,'میانه امتیاز':r.median,'کمینه':r.min,'بیشینه':r.max,'آخرین امتیاز':r.last,'کیفیت':r.quality }))); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Score History'); XLSX.writeFile(book, symbol + '-score-history.xlsx'); };
    const info = manifest[symbol];
    if (!info) { renderScorePanel({ candles: {} }); $('#minuteData').innerHTML = minuteTable([]); return; }
    load('data/' + info.file).then((payload) => { symbolPayload = payload; renderScorePanel(payload); minuteRows = Array.isArray(payload.rows) ? payload.rows : []; $('#minuteData').innerHTML = minuteTable(minuteRows); $('#minuteCsv').onclick = () => download('\\ufeff' + csv([['تاریخ و ساعت','امتیاز'], ...minuteRows]), 'text/csv;charset=utf-8', symbol + '-minute-score.csv'); $('#minuteXlsx').onclick = () => { if (!window.XLSX) return; const sheet = XLSX.utils.aoa_to_sheet([['تاریخ و ساعت','امتیاز'], ...minuteRows]); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Minute Scores'); XLSX.writeFile(book, symbol + '-minute-score.xlsx'); }; }).catch(() => { renderScorePanel({ candles: {} }); $('#minuteData').innerHTML = '<p class="meta">دریافت دیتای دقیقه‌ای این سهم ناموفق بود.</p>'; });
  }

  function refresh() {
    Promise.all([load('../data/market.json'), load('../history/data/history.json'), load('../history/data/score-candles.json'), load('data/intraday.json'), load('data/history-manifest.json')]).then(([m,h,c,i,man]) => {
      market=m; archive=h; candles=c.rows || []; candleIndex={}; candles.forEach((row) => { if (!candleIndex[row.symbol]) candleIndex[row.symbol]=[]; candleIndex[row.symbol].push(row); }); intraday=i.symbols || {}; manifest=man.symbols || {};
      const bySymbol=new Map(); (market.stocks || []).forEach((row) => bySymbol.set(row.symbol, {symbol:row.symbol,current:row,history:[]}));
      (archive.rows || []).forEach((row) => { if(!bySymbol.has(row.symbol)) bySymbol.set(row.symbol,{symbol:row.symbol,current:null,history:[]}); bySymbol.get(row.symbol).history.push(row); });
      items=Array.from(bySymbol.values());
      $('#archiveDays').textContent=C.integer(archive.valid_day_count); $('#archiveRows').textContent=C.integer(archive.row_count); $('#archiveLastDay').textContent=faDate(archive.generated_at);
      const wanted=new URLSearchParams(location.search).get('symbol'); select(wanted || (items[0] ? items[0].symbol : null)); $('#availability').textContent='داده سهم آماده است';
    }).catch(() => { $('#availability').textContent='دریافت داده ناموفق بود'; $('#list').innerHTML='<p class="empty">داده سهم در دسترس نیست.</p>'; });
  }
  $('#q').oninput=renderList; $('#sort').onchange=renderList; $('#refresh').onclick=refresh; const archiveDownload=$('#downloadAllArchive'); if(archiveDownload) archiveDownload.onclick=()=>{ location.href='../history/data/market-score-history.xlsx'; }; window.addEventListener('popstate',()=>select(new URLSearchParams(location.search).get('symbol'))); refresh();
})();
