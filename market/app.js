"use strict";

(() => {
  const core = window.MarketCore;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const REFRESH_MS = 60000;
  const FETCH_TIMEOUT_MS = 10000;
  let currentData = null;
  let loading = false;
  let refreshTimer = null;

  if (!core) {
    console.error("Market core failed to load");
    return;
  }

  const escapeHtml = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  const numeric = (value) => core.number(value);
  const formatHmt = (value) => core.formatNumber(value, 2);
  const formatValueHmt = (value) => {
    const parsed = numeric(value);
    return parsed === null ? "—" : `${formatHmt(parsed / 1e12)} همت`;
  };
  const signed = (value, digits = 1) => core.formatSigned(value, digits);
  const pct = (value) => core.formatPercent(value, 2);
  const integer = (value) => core.formatInteger(value);

  function toast(message) {
    const element = $("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove("show"), 2600);
  }

  function sourceAge(timestamp, now = Date.now()) {
    const parsed = Date.parse(timestamp || "");
    return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
  }

  function freshnessLabel(data) {
    const age = sourceAge(core.sourceTimestamp(data));
    if (age === null) return "زمان منبع نامعتبر";
    return age <= 24 * 60 * 60 * 1000 ? "snapshot به‌روز" : "snapshot قدیمی";
  }

  function setStatus(message, kind = "normal") {
    const element = $("#marketState");
    if (!element) return;
    element.textContent = message;
    element.dataset.state = kind;
    const indicator = element.closest(".market-state");
    if (indicator) indicator.dataset.state = kind;
  }

  function renderMetrics(data) {
    const market = data.market || {};
    const leaders = core.findLeaders(data);
    const marketMedian = numeric(market.median);
    const leaderMedian = numeric(leaders ? leaders.median : undefined);
    const buy = numeric(market.buy_value_hmt);
    const sell = numeric(market.sell_value_hmt);
    const net = buy === null || sell === null ? null : buy - sell;
    const allocation = core.allocation(marketMedian, leaderMedian);

    text("#marketMedian", signed(marketMedian));
    text("#buyValue", formatHmt(buy));
    text("#sellValue", formatHmt(sell));
    text("#tradedCount", integer(market.count));
    text("#signalMarket", signed(marketMedian));
    text("#signalLeaders", signed(leaderMedian));
    text("#signalNet", signed(net, 2));
    text("#updatedAt", core.formatDate(core.sourceTimestamp(data)));
    text("#sourceStatus", `منبع: ${data.source || "نامشخص"} · زمان منبع: ${core.formatDate(core.sourceTimestamp(data))}`);
    text("#marketMood", marketMedian === null ? "داده موجود نیست" : marketMedian > 2 ? "مثبت و پرقدرت" : marketMedian > 0 ? "مثبت اما متعادل" : marketMedian < -2 ? "فشار عرضه" : "خنثی / نوسانی");
    text("#marketTrend", marketMedian === null ? "—" : marketMedian >= 0 ? "بالای صفر" : "زیر صفر");
    text("#allocationLabel", allocation.label);
    text("#allocationGap", allocation.gap === null ? "فاصله میانه‌ها: —" : `فاصله میانه‌ها: ${signed(allocation.gap)}`);
    const marker = $("#allocationMarker");
    if (marker) {
      marker.hidden = allocation.gap === null;
      marker.style.left = allocation.gap === null ? "50%" : `${Math.max(5, Math.min(95, 50 + allocation.gap * 12))}%`;
    }
    setStatus(freshnessLabel(data), sourceAge(core.sourceTimestamp(data)) > 24 * 60 * 60 * 1000 ? "stale" : "normal");
  }

  function pathFor(values, x, y) {
    let path = "";
    values.forEach((value, index) => {
      if (numeric(value) === null) return;
      const command = index > 0 && numeric(values[index - 1]) !== null ? "L" : "M";
      path += `${command}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    });
    return path.trim();
  }

  function renderChart(data) {
    const svg = $("#marketChart");
    if (!svg) return;
    const days = [...(Array.isArray(data.daily) ? data.daily : [])].reverse();
    const series = core.chartSeries(data);
    const actualValues = [series.leaders, series.rest, series.market].flat().map(numeric).filter((value) => value !== null);
    const width = 760, height = 265, pad = { top: 18, right: 14, bottom: 32, left: 38 };
    if (!actualValues.length) {
      svg.innerHTML = `<text class="chart-empty" x="380" y="130" text-anchor="middle">داده تاریخی بازار موجود نیست.</text>`;
      return;
    }
    const min = Math.min(-3, ...actualValues) - .4;
    const max = Math.max(3, ...actualValues) + .4;
    const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(days.length - 1, 1);
    const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
    const marketPath = pathFor(series.market, x, y);
    const leadersPath = pathFor(series.leaders, x, y);
    const restPath = pathFor(series.rest, x, y);
    const zeroY = y(0);
    // Do not bridge missing samples with a filled area.
    const areaPath = marketPath && series.market.every((value) => value !== null) ? `${marketPath} L ${x(days.length - 1)},${zeroY} L ${x(0)},${zeroY} Z` : "";
    const grid = [-3, 0, 3].map((tick) => `<line class="${tick === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left - 9}" y="${y(tick) + 4}" text-anchor="end">${core.faDigits(tick)}</text>`).join("");
    const labels = days.map((day, index) => `<text class="chart-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(core.faDigits(String(day.trading_date || "").slice(5)))}</text>`).join("");
    const leadersMarkup = leadersPath ? `<path class="chart-path chart-leaders" d="${leadersPath}"/>` : "";
    const restMarkup = restPath ? `<path class="chart-path chart-rest" d="${restPath}"/>` : "";
    svg.innerHTML = `<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8df55" stop-opacity=".25"/><stop offset="1" stop-color="#b8df55" stop-opacity="0"/></linearGradient></defs>${grid}${labels}${areaPath ? `<path class="chart-area" d="${areaPath}"/>` : ""}${leadersMarkup}${restMarkup}<path class="chart-path chart-market" d="${marketPath}"/>`;
  }

  function scoreClass(value) {
    const parsed = numeric(value);
    return parsed === null ? "missing" : parsed >= 0 ? "high" : "low";
  }

  function queueMarkup(row) {
    const buy = numeric(row.buy_queue_value_toman);
    const sell = numeric(row.sell_queue_value_toman);
    if (buy !== null && buy > 0) return `<span class="queue-buy">+${escapeHtml(formatValueHmt(buy))}</span>`;
    if (sell !== null && sell > 0) return `<span class="queue-sell">−${escapeHtml(formatValueHmt(sell))}</span>`;
    return `<span class="pct">—</span>`;
  }

  function renderTables(data) {
    const top = Array.isArray(data.top_stocks) ? data.top_stocks : [];
    const topMarkup = top.map((row, index) => `<tr><td>${core.faDigits(index + 1)}</td><td>${escapeHtml(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td><span class="pct">${escapeHtml(pct(row.last_pct))}</span></td><td><span class="pct">${escapeHtml(formatValueHmt(row.trade_value_toman))}</span></td></tr>`).join("");
    const topElement = $("#topStocks");
    const rankingManaged = topElement && topElement.closest(".table-panel") && topElement.closest(".table-panel").querySelector(".ranking-tools");
    if (topElement && !rankingManaged) topElement.innerHTML = topMarkup || `<tr><td colspan="5">داده‌ای برای نمایش نیست.</td></tr>`;
    if (typeof window.dispatchEvent === "function") {
      var snapshotEvent = null;
      if (typeof window.CustomEvent === "function") snapshotEvent = new window.CustomEvent("market:snapshot", {detail: data});
      else if (document && typeof document.createEvent === "function") { snapshotEvent = document.createEvent("CustomEvent"); snapshotEvent.initCustomEvent("market:snapshot", false, false, data); }
      if (snapshotEvent) window.dispatchEvent(snapshotEvent);
    }
    const leveraged = Array.isArray(data.leveraged) ? data.leveraged : [];
    const leveragedMarkup = leveraged.map((row) => `<tr><td>${escapeHtml(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td><span class="pct">${escapeHtml(pct(row.last_pct))}</span></td><td>${queueMarkup(row)}</td></tr>`).join("");
    const leveragedElement = $("#leveragedStocks");
    if (leveragedElement) leveragedElement.innerHTML = leveragedMarkup || `<tr><td colspan="4">هنوز snapshot اهرمی ثبت نشده است.</td></tr>`;
  }

  function renderIndustries(data) {
    const rows = Array.isArray(data.industries) ? data.industries : [];
    const values = rows.map((row) => numeric(row.median)).filter((value) => value !== null);
    const max = Math.max(...values.map(Math.abs), 1);
    const markup = rows.map((row, index) => {
      const score = numeric(row.median);
      const positive = score === null || score >= 0;
      const color = positive ? "var(--lime-2)" : "var(--red)";
      const scale = score === null ? .12 : Math.max(.12, Math.abs(score) / max);
      return `<article class="industry-card" style="--bar-color:${color};--bar-scale:${scale}"><div class="industry-head"><span class="industry-name">${escapeHtml(row.industry || "بدون صنعت")}</span><span class="industry-rank">${core.faDigits(index + 1)} / ${core.faDigits(rows.length)}</span></div><div class="industry-score ${positive ? "" : "negative"}">${escapeHtml(signed(score))}</div><div class="industry-detail"><span>${escapeHtml(integer(row.count))} نماد</span><span>خالص صف: ${escapeHtml(signed(row.net_queue_hmt, 2))} همت</span></div></article>`;
    }).join("");
    const element = $("#industriesGrid");
    if (element) element.innerHTML = markup || `<div class="industry-card">داده صنعت هنوز آماده نیست.</div>`;
  }

  const optionsNumber = (value, digits = 0) => { const parsed = numeric(value); return parsed === null ? "—" : core.faDigits(parsed.toLocaleString("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: digits })); };
  const optionsPercent = (value) => { const parsed = numeric(value); return parsed === null ? "—" : `${optionsNumber(parsed, 1)}٪`; };
  function optionsStatusLabel(status) { return ({ ready: "داده معتبر آماده است.", no_opportunity: "فعلاً جفت واجد شرایط پیدا نشد.", insufficient_data: "داده کافی برای محاسبه کامل نیست.", stale: "داده آپشن قدیمی است.", unavailable: "منبع داده آپشن در دسترس نیست." }[status] || "وضعیت داده نامشخص است."); }
  function renderOptions(options) {
    const payload = options && typeof options === "object" ? options : {};
    const allPairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    const sourceTime = Date.parse(payload.source_at || "");
    const stale = Number.isFinite(sourceTime) && (Date.now() - sourceTime > 120000 || sourceTime > Date.now() + 5000);
    const status = stale ? "stale" : payload.status;
    const pairs = status === "ready" ? allPairs.filter(pair => pair.eligible === true && !(pair.reasons || []).length) : [];
    const rejected = allPairs.filter(pair => pairs.indexOf(pair) < 0);
    text("#optionsStatus", optionsStatusLabel(status));
    text("#optionsMessage", stale ? "آخرین snapshot برای بررسی نمایش داده می‌شود؛ قیمت قدیمی مبنای ورود یا سیگنال نیست." : payload.message || "snapshot آپشن هنوز منتشر نشده است.");
    text("#optionsSource", payload.source || "—");
    text("#optionsUpdatedAt", core.formatDate(payload.source_at));
    text("#optionsEligibleCount", status === "unavailable" ? "—" : optionsNumber(pairs.length));
    text("#optionsPairCount", status === "unavailable" ? "—" : optionsNumber(pairs.length));
    const reasonText = pair => escapeHtml((pair.reasons && pair.reasons.length ? pair.reasons : ["قیمت قدیمی یا اعتبار قابل تأیید نیست"]).join("؛ "));
    const rejectedElement = $("#optionsRejected");
    if (rejectedElement) rejectedElement.innerHTML = rejected.length ? `<details><summary>بررسی جفت‌ها · ${optionsNumber(rejected.length)} جفت غیرمجاز برای سیگنال</summary><p>این جدول فقط تشخیصی است؛ هیچ ردیف آن پیشنهاد ورود نیست.</p>${rejected.map(pair => `<details class="option-detail"><summary>${escapeHtml(pair.underlying)} · ${escapeHtml(pair.long_symbol)} / ${escapeHtml(pair.short_symbol)} · ${escapeHtml(pair.expiry)}</summary><p class="options-warning">${reasonText(pair)}</p><div class="option-facts"><span>قیمت پایه: ${optionsNumber(pair.underlying_price_toman, 1)}</span><span>اعمال پایین / بالا: ${optionsNumber(pair.k1_toman, 1)} / ${optionsNumber(pair.k2_toman, 1)}</span><span>Ask خرید / Bid فروش: ${optionsNumber(pair.ask_toman, 1)} / ${optionsNumber(pair.bid_toman, 1)}</span><span>هزینه ورود با کارمزد: ${optionsNumber(pair.net_debit_toman, 2)}</span><span>کارمزد: ${optionsNumber(pair.fees_toman, 2)}</span><span>حداکثر زیان: ${optionsNumber(pair.max_loss_toman, 2)}</span><span>حداکثر سود: ${optionsNumber(pair.max_profit_toman, 2)}</span><span>سربه‌سر: ${optionsNumber(pair.break_even_toman, 2)}</span><span>بازده کل / ماهانه: ${optionsPercent(pair.total_return_pct)} / ${optionsPercent(pair.monthly_return_pct)}</span><span>میانگین ارزش ۷ روز خرید / فروش: ${optionsNumber(pair.long_avg7d_toman)} / ${optionsNumber(pair.short_avg7d_toman)}</span></div></details>`).join("")}</details>` : "";
    const contracts = Array.isArray(payload.contracts) ? payload.contracts : [];
    const contractsElement = $("#optionsContracts");
    if (contractsElement) contractsElement.innerHTML = `<h3>قراردادهای رصدشده · ${optionsNumber(contracts.length)}</h3><p>قیمت‌ها تومان به‌ازای واحد پایه هستند؛ ارزش معاملات تومان است. تاریخچه ناقص با «—» نمایش داده می‌شود.</p><div class="options-table-wrap"><table class="options-table"><thead><tr><th>قرارداد / پایه</th><th>رتبه</th><th>سررسید / روز</th><th>اعمال</th><th>Ask</th><th>Bid</th><th>ارزش امروز</th><th>میانگین ۷ روز</th><th>روز معتبر</th></tr></thead><tbody>${contracts.map(c => `<tr><td><b>${escapeHtml(c.symbol)}</b><small>${escapeHtml(c.underlying)}</small></td><td>${optionsNumber(c.leader_rank)}</td><td>${escapeHtml(c.expiry)}<small>${optionsNumber(c.dte)} روز</small></td><td>${optionsNumber(c.strike_toman, 1)}</td><td>${optionsNumber(c.ask_toman, 1)}</td><td>${optionsNumber(c.bid_toman, 1)}</td><td>${optionsNumber(c.trade_value_toman)}</td><td>${optionsNumber(c.avg7d_toman)}</td><td>${optionsNumber(c.history_days)} / ۷</td></tr>`).join("") || '<tr><td colspan="9">قرارداد قابل نمایش موجود نیست.</td></tr>'}</tbody></table></div>`;
    const rows = pairs.map((pair) => `<tr><td><b>${escapeHtml(pair.underlying || "—")}</b><small>رتبه ${escapeHtml(optionsNumber(pair.leader_rank))}</small></td><td>${escapeHtml(pair.expiry || "—")}<small>${escapeHtml(optionsNumber(pair.dte))} روز</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.k1_toman))}</span> / <span class="ltr">${escapeHtml(optionsNumber(pair.k2_toman))}</span><small>${escapeHtml(pair.long_symbol || "—")} / ${escapeHtml(pair.short_symbol || "—")}</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.ask_toman))}</span> / <span class="ltr">${escapeHtml(optionsNumber(pair.bid_toman))}</span><small>Ask / Bid</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.net_debit_toman))}</span><small>تومان/واحد پایه</small></td><td><span class="positive ltr">${escapeHtml(optionsNumber(pair.max_profit_toman))}</span> / <span class="negative ltr">${escapeHtml(optionsNumber(pair.max_loss_toman))}</span><small>سود / زیان سقف</small></td><td><b class="positive ltr">${escapeHtml(optionsPercent(pair.monthly_return_pct))}</b><small>بازده کل: ${escapeHtml(optionsPercent(pair.total_return_pct))}</small></td></tr>`).join("");
    const table = $("#optionsPairs"); if (table) table.innerHTML = rows || `<tr><td colspan="7">${escapeHtml(payload.message || "جفت واجد شرایطی برای نمایش نیست.")}</td></tr>`;
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [], diagnosticElement = $("#optionsDiagnostics"); if (diagnosticElement) diagnosticElement.innerHTML = diagnostics.length ? `<span>کنترل فیلترها:</span> ${diagnostics.map((item) => `<b>${escapeHtml(item.label)}: ${escapeHtml(optionsNumber(item.count))}</b>`).join(" · ")}` : "فقط جفت‌های تأییدشده نمایش داده می‌شوند؛ سفارش خودکار فعال نیست.";
  }
  function render(data, options) { currentData = data; renderMetrics(data); renderChart(data); renderTables(data); renderIndustries(data); renderOptions(options || data.options); }

  async function fetchSnapshot() {
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const marketResponse = await fetch(`data/market.json?ts=${Date.now()}`, { cache: "no-store", signal: controller.signal }); if (!marketResponse.ok) throw new Error(`HTTP ${marketResponse.status}`); const data = await marketResponse.json();
      let options = { status: "unavailable", source: "options.json", message: "snapshot آپشن هنوز منتشر نشده است.", counts: { eligible_pairs: null }, pairs: [], diagnostics: [] };
      try { const optionsResponse = await fetch(`data/options.json?ts=${Date.now()}`, { cache: "no-store", signal: controller.signal }); if (optionsResponse.ok) options = await optionsResponse.json(); } catch (optionsError) { console.warn("Options snapshot unavailable", optionsError); }
      return { data: core.validateSnapshot(data), options };
    } catch (error) { if (error.name === "AbortError") throw new Error("مهلت دریافت snapshot تمام شد."); if (error instanceof SyntaxError) throw new Error("فایل snapshot JSON نامعتبر است."); throw error; } finally { window.clearTimeout(timeout); }
  }

  async function loadData(showToast = false) {
    if (loading) return;
    loading = true;
    if (!currentData) setStatus("در حال دریافت", "loading");
    try {
      const snapshot = await fetchSnapshot();
      render(snapshot.data, snapshot.options);
      text("#sourceStatus", `منبع: ${currentData.source} · زمان منبع: ${core.formatDate(core.sourceTimestamp(currentData))}`);
      if (showToast) toast("داده داشبورد به‌روزرسانی شد");
    } catch (error) {
      const message = error instanceof Error ? error.message : "خطای ناشناخته در دریافت داده.";
      setStatus(currentData ? "داده قدیمی" : "دریافت ناموفق", "stale");
      text("#sourceStatus", currentData ? `خطا در به‌روزرسانی: ${message} · نمایش آخرین snapshot` : `خطا در دریافت snapshot: ${message}`);
      if (showToast) toast("دریافت داده انجام نشد");
      console.error(error);
    } finally {
      loading = false;
    }
  }

  function setupNavigation() {
    const navLinks = $$(".main-nav a[href^='#'], .mobile-nav a[href^='#']");
    const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
    }), { rootMargin: "-35% 0px -55%" });
    sections.forEach((section) => observer.observe(section));
  }

  const refreshButton = $("#refreshButton");
  if (refreshButton) refreshButton.addEventListener("click", () => loadData(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadData(true);
  });
  window.addEventListener("pageshow", () => loadData(true));
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") loadData(false);
  }, REFRESH_MS);
  void refreshTimer;
  setupNavigation();
  loadData();
})();

if (navigator.userAgent.includes("MarketPulseAndroid")) document.documentElement.classList.add("native-market-webview");
