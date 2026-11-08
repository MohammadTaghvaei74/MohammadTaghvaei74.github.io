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

  function render(data) { currentData = data; renderSummary(data); renderChart(data); renderLists(data); }

  async function loadData(showToastMessage = false) {
    if (loading) return;
    loading = true;
    setState("در حال دریافت", "loading");
    try {
      const response = await fetch(`../data/market.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(core.validateSnapshot(await response.json()));
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
