"use strict";

(() => {
  const core = window.MarketCore;
  const $ = (selector) => document.querySelector(selector);
  const numeric = (value) => core.number(value);
  let currentData = null;
  let loading = false;

  if (!core) return;

  const escapeHtml = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  const signed = (value, digits = 1) => core.formatSigned(value, digits);
  const integer = (value) => core.formatInteger(value);
  const sourceAge = (value) => { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null; };

  function showToast(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function setState(label, state = "normal") {
    const element = $("#marketState");
    if (!element) return;
    element.textContent = label;
    const parent = element.closest(".live-state");
    if (parent) parent.dataset.state = state;
  }

  function renderSummary(data) {
    const market = data.market || {};
    const leaders = core.findLeaders(data);
    const marketMedian = numeric(market.median);
    const leaderMedian = numeric(leaders && leaders.median);
    const buy = numeric(market.buy_value_hmt);
    const sell = numeric(market.sell_value_hmt);
    const net = buy === null || sell === null ? null : buy - sell;
    const allocation = core.allocation(marketMedian, leaderMedian);
    const age = sourceAge(core.sourceTimestamp(data));
    const mood = marketMedian === null ? "خوانش بازار در دسترس نیست" : marketMedian > 2 ? "مثبت و پرقدرت" : marketMedian > 0 ? "مثبت اما متعادل" : marketMedian < -2 ? "فشار عرضه" : "خنثی / نوسانی";

    setText("#heroScore", signed(marketMedian));
    setText("#marketMood", mood);
    setText("#marketMedian", signed(marketMedian));
    setText("#leaderMedian", signed(leaderMedian));
    setText("#tradedCount", integer(market.count));
    setText("#allocationLabel", allocation.label);
    setText("#directionTitle", allocation.label);
    setText("#allocationGap", allocation.gap === null ? "فاصله با بازار: —" : `فاصله با بازار: ${signed(allocation.gap)}`);
    setText("#directionText", allocation.gap === null ? "فاصله میانه‌ها برای خوانش جهت کافی نیست." : `میانه بازار ${allocation.gap >= 0 ? "بالاتر" : "پایین‌تر"} از لیدرها قرار گرفته است.`);
    setText("#netQueue", net === null ? "—" : `${signed(net, 2)} همت`);
    setText("#sourceName", data.source || "—");
    setText("#updatedAt", core.formatDate(core.sourceTimestamp(data)));
    setText("#sourceStatus", `منبع: ${data.source || "نامشخص"} · ${core.formatDate(core.sourceTimestamp(data))}`);
    setState(age !== null && age > 24 * 60 * 60 * 1000 ? "snapshot قدیمی" : "snapshot به‌روز", age !== null && age > 24 * 60 * 60 * 1000 ? "stale" : "normal");
    const marker = $("#allocationMarker");
    if (marker) { marker.hidden = allocation.gap === null; marker.style.right = allocation.gap === null ? "50%" : `${Math.max(5, Math.min(95, 50 - allocation.gap * 12))}%`; }
  }

  function chartPath(values, x, y) {
    let path = "";
    values.forEach((value, index) => {
      if (numeric(value) === null) return;
      const previous = index > 0 ? numeric(values[index - 1]) : null;
      path += `${path && previous !== null ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    });
    return path.trim();
  }

  function renderChart(data) {
    const svg = $("#marketChart");
    if (!svg) return;
    const days = [...(Array.isArray(data.daily) ? data.daily : [])].reverse();
    const series = core.chartSeries(data);
    const values = [series.market, series.leaders, series.rest].flat().map(numeric).filter((value) => value !== null);
    const width = 860, height = 300, pad = { top: 26, right: 16, bottom: 42, left: 34 };
    if (!values.length) { svg.innerHTML = '<text class="chart-empty" x="430" y="150" text-anchor="middle">داده تاریخی بازار موجود نیست.</text>'; return; }
    const min = Math.min(-3, ...values) - .5, max = Math.max(3, ...values) + .5;
    const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(days.length - 1, 1);
    const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
    const grid = [-3, 0, 3].map((tick) => `<line class="chart-grid ${tick === 0 ? "zero" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-axis" x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${core.faDigits(tick)}</text>`).join("");
    const labels = days.map((day, index) => `<text class="chart-axis" x="${x(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(core.faDigits(String(day.trading_date || "").slice(5)))}</text>`).join("");
    svg.innerHTML = `${grid}${labels}<path class="chart-path rest-path" d="${chartPath(series.rest, x, y)}"/><path class="chart-path leader-path" d="${chartPath(series.leaders, x, y)}"/><path class="chart-path market-path" d="${chartPath(series.market, x, y)}"/>`;
  }

  function scoreRow(row) {
    const score = numeric(row.score);
    const tone = score === null ? "missing" : score >= 0 ? "positive" : "negative";
    return `<div class="compact-row"><span class="row-symbol">${escapeHtml(row.symbol)}</span><span class="row-score ${tone}">${escapeHtml(signed(score))}</span></div>`;
  }

  function renderLists(data) {
    const top = Array.isArray(data.top_stocks) ? data.top_stocks.slice(0, 5) : [];
    const leveraged = Array.isArray(data.leveraged) ? data.leveraged.slice(0, 5) : [];
    const industries = Array.isArray(data.industries) ? [...data.industries].slice(0, 3) : [];
    const empty = '<div class="empty-row">داده‌ای برای نمایش نیست.</div>';
    const topElement = $("#topStocks");
    const leveragedElement = $("#leveragedStocks");
    const industryElement = $("#topIndustries");
    if (topElement) topElement.innerHTML = top.map(scoreRow).join("") || empty;
    if (leveragedElement) leveragedElement.innerHTML = leveraged.map(scoreRow).join("") || empty;
    if (industryElement) industryElement.innerHTML = industries.map((row, index) => `<div class="compact-row"><span class="row-symbol"><i>${core.faDigits(index + 1)}</i>${escapeHtml(row.industry || "بدون صنعت")}</span><span class="row-score ${numeric(row.median) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.median))}</span></div>`).join("") || empty;
  }

  const leaderSymbols = ["وبملت","فملی","فولاد","وتجارت","فزر","خودرو","شستا","شپدیس","فارس","ومعادن","تاپیکو","خساپا","وبصادر","وپارس","نوری","وپاسار","ونوین","کگل","رمپنا","ذوب","وغدیر","فخوز","خگستر","صبا","وساپا","کالا","اخابر","سپید","شسپا","پارسان","تیپیکو","دزاگرس","مبین","کاما","کچاد","دعبید","خبهمن","اروند","دی","خزامیا"];
  const parityEmpty = '<tr><td colspan="6" class="parity-empty">داده‌ای برای نمایش نیست.</td></tr>';
  const parityLine = (values, width, height, color, min, max) => {
    const clean = values.map(numeric), pad = {top:18,right:12,bottom:24,left:30};
    const x = index => pad.left + index * (width - pad.left - pad.right) / Math.max(clean.length - 1, 1);
    const y = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / Math.max(max - min, 1);
    let path = "";
    clean.forEach((value, index) => { if (value === null) return; path += `${path && clean[index - 1] !== null ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `; });
    return path ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : "";
  };
  function renderParityChart(id, rows, series, colors, queue = false) {
    const svg = $(id); if (!svg) return;
    const values = series.flat().map(numeric).filter(value => value !== null);
    if (!values.length) { svg.innerHTML = '<text class="chart-empty" x="380" y="105" text-anchor="middle">داده درون‌روزی موجود نیست.</text>'; return; }
    const min = queue ? 0 : Math.min(-3, ...values) - .4, max = queue ? Math.max(1, ...values) * 1.12 : Math.max(3, ...values) + .4;
    const grid = [min, queue ? max / 2 : 0, max].map(value => `<line x1="30" x2="748" y1="${18 + (max - value) * 168 / Math.max(max - min, 1)}" y2="${18 + (max - value) * 168 / Math.max(max - min, 1)}" stroke="#d9d9d1" stroke-dasharray="3 5"/>`).join("");
    svg.innerHTML = `${grid}${series.map((values, index) => parityLine(values, 760, 210, colors[index], min, max)).join("")}<text class="chart-axis" x="30" y="202">${escapeHtml(rows[0] && (rows[0].time || rows[0].timestamp || ""))}</text><text class="chart-axis" x="748" y="202" text-anchor="end">${escapeHtml(rows[rows.length - 1] && (rows[rows.length - 1].time || rows[rows.length - 1].timestamp || ""))}</text>`;
  }
  function renderParity(data, options) {
    const intraday = Array.isArray(data.intraday) ? data.intraday.slice(-80) : [];
    renderParityChart("#intradayChart", intraday, [intraday.map(row => row.median_score), intraday.map(row => row.leader_median_score), intraday.map(row => row.rest_median_score)], ["#3f735b","#e87958","#8bb8c9"]);
    const queues = Array.isArray(data.queue_intraday) ? data.queue_intraday.slice(-80) : [];
    renderParityChart("#queueChart", queues, [queues.map(row => row.buy_value_hmt), queues.map(row => row.sell_value_hmt)], ["#3f735b","#e87958"], true);
    const topQueue = Array.isArray(data.top_buy_queue) ? data.top_buy_queue : [];
    const queueRows = $("#topBuyQueueRows"); if (queueRows) queueRows.innerHTML = topQueue.map((row,index) => `<tr><td>${core.faDigits(index + 1)}</td><td>${escapeHtml(row.symbol)}</td><td class="${numeric(row.score) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.score))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman))}</td><td>${escapeHtml(core.formatMillionToman(row.buy_per_capita_toman))}</td><td>${escapeHtml(core.formatNumber(row.buyer_power, 1))}</td></tr>`).join("") || parityEmpty;
    const stockMap = new Map((Array.isArray(data.stocks) ? data.stocks : []).map(row => [row.symbol, row]));
    const leaders = leaderSymbols.map(symbol => stockMap.get(symbol) || {symbol, score:null, buy_queue_value_toman:null}).sort((a,b) => (numeric(b.score) || -Infinity) - (numeric(a.score) || -Infinity));
    const leaderRows = $("#leaderRows"); if (leaderRows) leaderRows.innerHTML = leaders.map(row => `<tr><td>${escapeHtml(row.symbol)}</td><td class="${numeric(row.score) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.score))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman))}</td></tr>`).join("") || parityEmpty;
    const industries = Array.isArray(data.industry_table) ? data.industry_table.slice(0,48) : (Array.isArray(data.industries) ? data.industries : []);
    const industryRows = $("#industryRows"); if (industryRows) industryRows.innerHTML = industries.map(row => `<tr><td>${escapeHtml(row.industry)}</td><td>${escapeHtml(integer(row.stock_count !== undefined ? row.stock_count : row.count))}</td><td>${escapeHtml(signed(row.median_score !== undefined ? row.median_score : row.median))}</td><td>${escapeHtml(core.formatBillionToman(row.buy_queue_value_toman))}</td></tr>`).join("") || parityEmpty;
    const payload = options && typeof options === "object" ? options : data.options || {};
    const pairs = Array.isArray(payload.pairs) ? payload.pairs.filter(pair => pair.eligible === true) : [];
    setText("#optionsState", payload.message || (pairs.length ? "جفت‌های واجد شرایط نمایش داده می‌شوند." : "فعلاً جفت واجد شرایطی برای نمایش نیست."));
    setText("#optionsEligible", payload.counts && payload.counts.eligible_pairs !== undefined ? integer(payload.counts.eligible_pairs) : integer(pairs.length));
    setText("#optionsContracts", payload.counts && payload.counts.contracts !== undefined ? integer(payload.counts.contracts) : integer(Array.isArray(payload.contracts) ? payload.contracts.length : null));
    setText("#optionsSourceTime", payload.source_at ? `${payload.source || "—"} · ${core.formatDate(payload.source_at)}` : "—");
    const optionRows = $("#optionsRows"); if (optionRows) optionRows.innerHTML = pairs.slice(0,20).map(pair => `<tr><td>${escapeHtml(pair.underlying)}</td><td>${escapeHtml(pair.expiry)}<small>${escapeHtml(integer(pair.dte))} روز</small></td><td>${escapeHtml(core.formatNumber(pair.net_debit_toman, 1))}</td><td class="positive">${escapeHtml(core.formatPercent(pair.monthly_return_pct, 1))}</td></tr>`).join("") || '<tr><td colspan="4" class="parity-empty">جفت واجد شرایطی برای نمایش نیست.</td></tr>';
  }
  function render(data, options) { currentData = data; renderSummary(data); renderChart(data); renderLists(data); renderParity(data, options); }

  async function fetchJson(path) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {cache: "no-store", signal: controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { window.clearTimeout(timer); }
  }
  async function loadData(showToastMessage = false) {
    if (loading) return;
    loading = true;
    setState("در حال دریافت", "loading");
    try {
      const data = core.validateSnapshot(await fetchJson(`../data/market.json?ts=${Date.now()}`));
      render(data, data.options);
      try { renderParity(data, await fetchJson(`../data/options.json?ts=${Date.now()}`)); } catch (optionsError) { renderParity(data, data.options); console.warn(optionsError); }
      if (showToastMessage) showToast("نمای کلی ۲ به‌روزرسانی شد");
    } catch (error) {
      setState(currentData ? "داده قدیمی" : "دریافت ناموفق", "stale");
      if (showToastMessage) showToast("دریافت داده انجام نشد");
      console.error(error);
    } finally { loading = false; }
  }

  const refreshButton = $("#refreshButton");
  if (refreshButton) refreshButton.addEventListener("click", () => loadData(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadData(); });
  loadData();
  window.setInterval(() => loadData(), 60000);
})();
