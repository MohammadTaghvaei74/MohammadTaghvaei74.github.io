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
  const formatHmt = (value) => core.formatNumber(value, 1);
  const formatValueBillion = (value) => core.formatBillionToman(value);
  const signed = (value, digits = 1) => core.formatSigned(value, digits);
  const pct = (value) => core.formatPercent(value, 2);
  const integer = (value) => core.formatInteger(value);
  const closePct = (row) => core.closePercent(row.close_price, row.yesterday_price);

  function scorePosition(row, ranking) {
    const rank = numeric(row && row.score_rank);
    const total = numeric(row && row.score_rank_total);
    if (rank !== null && total !== null && total > 0) return {rank, total};
    const score = numeric(row && row.score);
    if (score === null || !ranking.length) return null;
    const index = ranking.findIndex((item) => item.symbol === row.symbol);
    return index < 0 ? null : {rank: index + 1, total: ranking.length};
  }

  function marketPositionMarkup(row, ranking) {
    const position = scorePosition(row, ranking);
    if (!position) return "<span class=\"market-position missing\">—</span>";
    const percentage = Math.round((position.rank / position.total) * 100);
    return `<span class="market-position" title="رتبه ${core.faDigits(position.rank)} از ${core.faDigits(position.total)}">${core.faDigits(percentage)}٪</span>`;
  }

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
      // In RTL layout the visual order is هم‌وزن (left) → لیدرها (right).
      // A positive market-vs-leaders gap means stronger هم‌وزن, so move left.
      marker.style.left = allocation.gap === null ? "50%" : `${Math.max(5, Math.min(95, 50 - allocation.gap * 12))}%`;
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

  function chartTooltipMarkup(index, points, series, x, y) {
    const point = points[index] || {};
    const values = [
      ["کل بازار", series.market[index], "#388268"],
      ["لیدرها", series.leaders[index], "#ffae73"],
      ["بقیه بازار", series.rest[index], "#7fd8ef"],
    ].filter(([, value]) => numeric(value) !== null);
    const tooltipWidth = 190;
    const tooltipHeight = 30 + values.length * 19;
    const rawX = x(index) + 14;
    const tooltipX = rawX + tooltipWidth > 760 ? x(index) - tooltipWidth - 14 : rawX;
    const tooltipY = Math.max(8, Math.min(300 - tooltipHeight - 8, y(numeric(series.market[index]) !== null ? numeric(series.market[index]) : numeric(series.leaders[index]) !== null ? numeric(series.leaders[index]) : numeric(series.rest[index])) - tooltipHeight / 2));
    const time = escapeHtml(core.faDigits(String(point.time || "—").slice(0, 5)));
    const rows = values.map(([label, value, color], rowIndex) => `<circle cx="${tooltipX + 12}" cy="${tooltipY + 31 + rowIndex * 19}" r="3.5" fill="${color}"/><text class="chart-tooltip-value" x="${tooltipX + tooltipWidth - 12}" y="${tooltipY + 35 + rowIndex * 19}" text-anchor="end">${escapeHtml(label)}: ${escapeHtml(signed(value, 2))}</text>`).join("");
    return `<g class="chart-tooltip active" data-tooltip-index="${index}" role="status"><rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="8"/><text class="chart-tooltip-title" x="${tooltipX + tooltipWidth - 12}" y="${tooltipY + 20}" text-anchor="end">ساعت ${time}</text>${rows}</g>`;
  }

  function renderChart(data) {
    const svg = $("#marketChart");
    if (!svg) return;
    const points = Array.isArray(data.intraday) ? data.intraday : [];
    const days = points;
    const series = {
      leaders: points.map((row) => row.leader_median_score),
      rest: points.map((row) => row.rest_median_score),
      market: points.map((row) => row.median_score),
    };
    const actualValues = [series.leaders, series.rest, series.market].flat().map(numeric).filter((value) => value !== null);
    const width = 760, height = 300, pad = { top: 18, right: 14, bottom: 38, left: 48 };
    if (!actualValues.length) {
      svg.innerHTML = `<text class="chart-empty" x="380" y="145" text-anchor="middle">دادهٔ امروز از ۰۹:۱۵ هنوز موجود نیست.</text>`;
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
    const grid = [-3, -2, -1, 0, 1, 2, 3].map((tick) => `<line class="${tick === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left - 11}" y="${y(tick) + 5}" text-anchor="end">${core.faDigits(tick)}</text>`).join("");
    const labels = days.map((point, index) => `<text class="chart-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(core.faDigits(String(point.time || "").slice(0, 5)))}</text>`).join("");
    const leadersMarkup = leadersPath ? `<path class="chart-path chart-leaders" d="${leadersPath}"/>` : "";
    const restMarkup = restPath ? `<path class="chart-path chart-rest" d="${restPath}"/>` : "";
    const pointMarkup = days.map((point, index) => [
      [series.market[index], "market"], [series.leaders[index], "leaders"], [series.rest[index], "rest"],
    ].filter(([value]) => numeric(value) !== null).map(([value, name]) => `<circle class="chart-hit chart-hit-${name}" data-index="${index}" cx="${x(index)}" cy="${y(value)}" r="10" tabindex="0" aria-label="${escapeHtml(String(point.time || ""))} ${escapeHtml(name)} ${escapeHtml(signed(value, 2))}"/>`).join("")).join("");
    svg.innerHTML = `<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8df55" stop-opacity=".25"/><stop offset="1" stop-color="#b8df55" stop-opacity="0"/></linearGradient></defs>${grid}${labels}${areaPath ? `<path class="chart-area" d="${areaPath}"/>` : ""}${leadersMarkup}${restMarkup}<path class="chart-path chart-market" d="${marketPath}"/><line class="chart-crosshair" x1="${x(0)}" x2="${x(0)}" y1="${pad.top}" y2="${height - pad.bottom}"/>${pointMarkup}`;
    const showTooltip = (index) => {
      const crosshair = svg.querySelector(".chart-crosshair");
      if (crosshair) { crosshair.setAttribute("x1", x(index)); crosshair.setAttribute("x2", x(index)); }
      const current = svg.querySelector(".chart-tooltip");
      if (current) current.outerHTML = chartTooltipMarkup(index, days, series, x, y);
      else if (crosshair) crosshair.insertAdjacentHTML("afterend", chartTooltipMarkup(index, days, series, x, y));
    };
    svg.querySelectorAll(".chart-hit").forEach((hit) => {
      const show = () => showTooltip(Number(hit.dataset.index));
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("focus", show);
    });
  }

  function scoreClass(value) {
    const parsed = numeric(value);
    return parsed === null ? "missing" : parsed >= 0 ? "high" : "low";
  }

  function queueMarkup(row) {
    const buy = numeric(row.buy_queue_value_toman);
    const sell = numeric(row.sell_queue_value_toman);
    if (buy !== null && buy > 0) return `<span class="queue-buy">${escapeHtml(core.formatQueueBillion(buy))}</span>`;
    if (sell !== null && sell > 0) return `<span class="queue-sell">${escapeHtml(core.formatQueueBillion(sell))}</span>`;
    return `<span class="pct">-</span>`;
  }

  function renderTopBuyQueue(data) {
    const rows = Array.isArray(data.top_buy_queue) ? data.top_buy_queue : [];
    const element = $("#topBuyQueue");
    if (!element) return;
    const valueB = (v) => numeric(v) === null ? "—" : escapeHtml(core.formatNumber(numeric(v) / 1000000000, 0));
    const valuePct = (v) => numeric(v) === null ? "—" : escapeHtml(core.formatNumber(v, 0) + "%");
    const valueM = (v) => numeric(v) === null ? "—" : escapeHtml(core.formatNumber(numeric(v) / 1000000, 0));
    const valuePower = (v) => numeric(v) === null ? "—" : escapeHtml(core.formatNumber(v, 0));
    const legalPct = (v, kind) => {
      const parsed = numeric(v);
      if (parsed === null) return `<span class="legal-pct">—</span>`;
      const qualified = kind === "buy" ? parsed > 20 : parsed > 40;
      return `<span class="legal-pct ${kind} ${qualified ? "qualified" : ""}">${escapeHtml(core.formatNumber(parsed, 0) + "%")}</span>`;
    };
    element.innerHTML = rows.map((row, index) => `<tr><td>${core.faDigits(index + 1)}</td><td><a class="ranking-symbol" href="symbols/?symbol=${encodeURIComponent(row.symbol || "")}">${escapeHtml(row.symbol)}</a></td><td><span class="queue-number">${escapeHtml(signed(row.score))}</span></td><td><span class="queue-number">${valueB(row.avg_trade_value_toman !== null && row.avg_trade_value_toman !== undefined ? row.avg_trade_value_toman : row.avg15_trade_value_toman)}</span></td><td><span class="queue-number">${valueB(row.buy_queue_value_toman)}</span></td><td><span class="queue-number">${numeric(row.queue_to_avg !== null && row.queue_to_avg !== undefined ? row.queue_to_avg : row.queue_to_avg15) === null ? "—" : `${escapeHtml(core.formatNumber(row.queue_to_avg !== null && row.queue_to_avg !== undefined ? row.queue_to_avg : row.queue_to_avg15, 0))}×`}</span></td><td><span class="queue-number">${valueM(row.buy_per_capita_toman)}</span></td><td><span class="queue-number">${valuePower(row.buyer_power)}</span></td><td>${legalPct(row.legal_buy_pct, "buy")}</td><td>${legalPct(row.legal_sell_pct, "sell")}</td></tr>`).join("") || `<tr><td colspan="10">صف خرید معتبر برای نمایش نیست.</td></tr>`;
  }

  function renderTables(data) {
    const top = Array.isArray(data.top_stocks) ? data.top_stocks : [];
    const ranking = [...(Array.isArray(data.stocks) ? data.stocks : [])].filter((row) => numeric(row.score) !== null).sort((a, b) => numeric(b.score) - numeric(a.score) || String(a.symbol || "").localeCompare(String(b.symbol || ""), "fa"));
    const topMarkup = top.map((row) => `<tr><td>${escapeHtml(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${marketPositionMarkup(row, ranking)}</td><td>${queueMarkup(row)}</td></tr>`).join("");
    const topElement = $("#topStocks");
    const rankingManaged = topElement && topElement.closest(".table-panel") && topElement.closest(".table-panel").querySelector(".ranking-tools");
    if (topElement && !rankingManaged) topElement.innerHTML = topMarkup || `<tr><td colspan="4">داده‌ای برای نمایش نیست.</td></tr>`;
    renderTopBuyQueue(data);
    if (typeof window.dispatchEvent === "function") {
      var snapshotEvent = null;
      if (typeof window.CustomEvent === "function") snapshotEvent = new window.CustomEvent("market:snapshot", {detail: data});
      else if (document && typeof document.createEvent === "function") { snapshotEvent = document.createEvent("CustomEvent"); snapshotEvent.initCustomEvent("market:snapshot", false, false, data); }
      if (snapshotEvent) window.dispatchEvent(snapshotEvent);
    }
    const leveraged = Array.isArray(data.leveraged) ? data.leveraged : [];
    const leveragedMarkup = leveraged.map((row) => `<tr><td>${escapeHtml(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${marketPositionMarkup(row, ranking)}</td><td>${queueMarkup(row)}</td></tr>`).join("");
    const leveragedElement = $("#leveragedStocks");
    if (leveragedElement) leveragedElement.innerHTML = leveragedMarkup || `<tr><td colspan="4">هنوز snapshot اهرمی ثبت نشده است.</td></tr>`;
    const leaderSymbols = ['وبملت','فملی','فولاد','وتجارت','فزر','خودرو','شستا','شپدیس','فارس','ومعادن','تاپیکو','خساپا','وبصادر','وپارس','نوری','وپاسار','ونوین','کگل','رمپنا','ذوب','وغدیر','فخوز','خگستر','صبا','وساپا','کالا','اخابر','سپید','شسپا','پارسان','تیپیکو','دزاگرس','مبین','کاما','کچاد','دعبید','خبهمن','اروند','دی','خزامیا'];
    const bySymbol = new Map((Array.isArray(data.stocks) ? data.stocks : []).map(row => [row.symbol, row]));
    const leaders = leaderSymbols.map(symbol => bySymbol.get(symbol) || {symbol, score:null, avg15_trade_value_toman:null, trade_value_toman:null});
    leaders.sort((a,b) => (numeric(a.score) === null) - (numeric(b.score) === null) || (numeric(b.score) || 0) - (numeric(a.score) || 0) || a.symbol.localeCompare(b.symbol,'fa'));
    const leaderElement = $('#leaderStocks');
    if (leaderElement) leaderElement.innerHTML = leaders.map((row) => `<tr><td>${escapeHtml(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${marketPositionMarkup(row, ranking)}</td><td>${queueMarkup(row)}</td></tr>`).join('');
    function sizeLeaders() {
      if (!leaderElement || leaderElement.rows.length < 10) return;
      const wrap = leaderElement.closest('.table-scroll');
      wrap.style.height = (leaderElement.rows[9].getBoundingClientRect().bottom - wrap.getBoundingClientRect().top + wrap.scrollTop) + 'px';
    }
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => window.setTimeout(callback, 0);
    schedule(sizeLeaders);
    if (document.fonts) document.fonts.ready.then(sizeLeaders);
  }

  function renderIndustries(data) {
    const rows = Array.isArray(data.industries) ? data.industries : [];
    const markup = rows.map((row, index) => {
      const score = numeric(row.median);
      const positive = score === null || score >= 0;
      return `<tr><td class="industry-rank-cell">${core.faDigits(index + 1)}</td><td class="industry-name-cell">${escapeHtml(row.industry || "بدون صنعت")}</td><td>${escapeHtml(integer(row.count))}</td><td><span class="industry-median ${positive ? "" : "negative"}">${escapeHtml(signed(score))}</span></td></tr>`;
    }).join("");
    const element = $("#industriesGrid");
    if (element) element.innerHTML = markup || `<tr><td colspan="4" class="industry-empty">داده صنعت هنوز آماده نیست.</td></tr>`;
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
    const counts = payload.counts && typeof payload.counts === "object" ? payload.counts : {};
    // A stale feed is informational only. Never turn thousands of stale pairs
    // into DOM nodes; that blocks the WebView main thread after network I/O.
    const renderDetails = status !== "stale" && allPairs.length <= 250;
    const rejected = renderDetails ? allPairs.filter(pair => pairs.indexOf(pair) < 0) : [];
    text("#optionsStatus", optionsStatusLabel(status));
    text("#optionsMessage", stale ? "آخرین snapshot برای بررسی نمایش داده می‌شود؛ قیمت قدیمی مبنای ورود یا سیگنال نیست." : payload.message || "snapshot آپشن هنوز منتشر نشده است.");
    text("#optionsSource", payload.source || "—");
    text("#optionsUpdatedAt", core.formatDate(payload.source_at));
    text("#optionsEligibleCount", status === "unavailable" ? "—" : optionsNumber(status === "ready" ? pairs.length : status === "stale" ? 0 : counts.eligible_pairs));
    text("#optionsPairCount", status === "unavailable" ? "—" : optionsNumber(counts.pairs));
    const reasonText = pair => escapeHtml((pair.reasons && pair.reasons.length ? pair.reasons : ["قیمت قدیمی یا اعتبار قابل تأیید نیست"]).join("؛ "));
    const rejectedElement = $("#optionsRejected");
    if (rejectedElement) rejectedElement.innerHTML = rejected.length ? `<details><summary>بررسی جفت‌ها · ${optionsNumber(rejected.length)} جفت غیرمجاز برای سیگنال</summary><p>این جدول فقط تشخیصی است؛ هیچ ردیف آن پیشنهاد ورود نیست.</p>${rejected.map(pair => `<details class="option-detail"><summary>${escapeHtml(pair.underlying)} · ${escapeHtml(pair.long_symbol)} / ${escapeHtml(pair.short_symbol)} · ${escapeHtml(pair.expiry)}</summary><p class="options-warning">${reasonText(pair)}</p><div class="option-facts"><span>قیمت پایه: ${optionsNumber(pair.underlying_price_toman, 1)}</span><span>اعمال پایین / بالا: ${optionsNumber(pair.k1_toman, 1)} / ${optionsNumber(pair.k2_toman, 1)}</span><span>Ask خرید / Bid فروش: ${optionsNumber(pair.ask_toman, 1)} / ${optionsNumber(pair.bid_toman, 1)}</span><span>هزینه ورود با کارمزد: ${optionsNumber(pair.net_debit_toman, 2)}</span><span>کارمزد: ${optionsNumber(pair.fees_toman, 2)}</span><span>حداکثر زیان: ${optionsNumber(pair.max_loss_toman, 2)}</span><span>حداکثر سود: ${optionsNumber(pair.max_profit_toman, 2)}</span><span>سربه‌سر: ${optionsNumber(pair.break_even_toman, 2)}</span><span>بازده کل / ماهانه: ${optionsPercent(pair.total_return_pct)} / ${optionsPercent(pair.monthly_return_pct)}</span><span>ارزش معاملات امروز خرید / فروش: ${optionsNumber(pair.long_today_value_toman)} / ${optionsNumber(pair.short_today_value_toman)}</span></div></details>`).join("")}</details>` : "";
    const contracts = Array.isArray(payload.contracts) ? payload.contracts : [];
    const contractsElement = $("#optionsContracts");
    if (contractsElement) contractsElement.innerHTML = renderDetails ? `<h3>قراردادهای رصدشده · ${optionsNumber(contracts.length)}</h3><p>قیمت‌ها تومان به‌ازای واحد پایه هستند؛ ارزش معاملات تومان است. فیلتر نقدشوندگی: ارزش معاملات امروز هر قرارداد بیش از ۱۵ میلیارد تومان؛ بدون شرط سابقه.</p><div class="options-table-wrap"><table class="options-table"><thead><tr><th>قرارداد / پایه</th><th>رتبه</th><th>سررسید / روز</th><th>اعمال</th><th>Ask</th><th>Bid</th><th>ارزش امروز</th></tr></thead><tbody>${contracts.map(c => `<tr><td><b>${escapeHtml(c.symbol)}</b><small>${escapeHtml(c.underlying)}</small></td><td>${optionsNumber(c.leader_rank)}</td><td>${escapeHtml(c.expiry)}<small>${optionsNumber(c.dte)} روز</small></td><td>${optionsNumber(c.strike_toman, 1)}</td><td>${optionsNumber(c.ask_toman, 1)}</td><td>${optionsNumber(c.bid_toman, 1)}</td><td>${optionsNumber(c.trade_value_toman)}</td></tr>`).join("") || '<tr><td colspan="7">قرارداد قابل نمایش موجود نیست.</td></tr>'}</tbody></table></div>` : "<p>جزئیات آپشن برای جلوگیری از کندی صفحه در این وضعیت بارگذاری نشده است.</p>";
    const rows = pairs.map((pair) => `<tr><td><b>${escapeHtml(pair.underlying || "—")}</b><small>رتبه ${escapeHtml(optionsNumber(pair.leader_rank))}</small></td><td>${escapeHtml(pair.expiry || "—")}<small>${escapeHtml(optionsNumber(pair.dte))} روز</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.k1_toman))}</span> / <span class="ltr">${escapeHtml(optionsNumber(pair.k2_toman))}</span><small>${escapeHtml(pair.long_symbol || "—")} / ${escapeHtml(pair.short_symbol || "—")}</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.ask_toman))}</span> / <span class="ltr">${escapeHtml(optionsNumber(pair.bid_toman))}</span><small>Ask / Bid</small></td><td><span class="ltr">${escapeHtml(optionsNumber(pair.net_debit_toman))}</span><small>تومان/واحد پایه</small></td><td><span class="positive ltr">${escapeHtml(optionsNumber(pair.max_profit_toman))}</span> / <span class="negative ltr">${escapeHtml(optionsNumber(pair.max_loss_toman))}</span><small>سود / زیان سقف</small></td><td><b class="positive ltr">${escapeHtml(optionsPercent(pair.monthly_return_pct))}</b><small>بازده کل: ${escapeHtml(optionsPercent(pair.total_return_pct))}</small></td></tr>`).join("");
    const table = $("#optionsPairs"); if (table) table.innerHTML = rows || `<tr><td colspan="7">${escapeHtml(payload.message || "جفت واجد شرایطی برای نمایش نیست.")}</td></tr>`;
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [], diagnosticElement = $("#optionsDiagnostics"); if (diagnosticElement) diagnosticElement.innerHTML = diagnostics.length ? `<span>کنترل فیلترها:</span> ${diagnostics.map((item) => `<b>${escapeHtml(item.label)}: ${escapeHtml(optionsNumber(item.count))}</b>`).join(" · ")}` : "فقط جفت‌های تأییدشده نمایش داده می‌شوند؛ سفارش خودکار فعال نیست.";
  }
  const emptyOptions = () => ({ status: "unavailable", source: "options.json", message: "داده آپشن در پس‌زمینه دریافت می‌شود.", counts: { eligible_pairs: null, pairs: null, contracts: null }, pairs: [], contracts: [], diagnostics: [] });

  function render(data, options) {
    currentData = data;
    renderMetrics(data);
    renderChart(data);
    renderTables(data);
    renderIndustries(data);
    renderOptions(options || data.options || emptyOptions());
  }

  async function fetchJson(path, cacheMode = "no-store") {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(path, { cache: cacheMode, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw new Error("مهلت دریافت snapshot تمام شد.");
      if (error instanceof SyntaxError) throw new Error("فایل snapshot JSON نامعتبر است.");
      throw error;
    } finally { window.clearTimeout(timeout); }
  }

  async function fetchOptionsInBackground() {
    try {
      const options = await fetchJson(`data/options.json?ts=${Date.now()}`);
      if (currentData) renderOptions(options);
    } catch (error) {
      console.warn("Options snapshot unavailable", error);
      renderOptions(emptyOptions());
    }
  }

  async function loadData(showToast = false) {
    if (loading) return;
    loading = true;
    if (!currentData) setStatus("در حال دریافت", "loading");
    try {
      // Critical path: render the 179KB market snapshot immediately. The heavy
      // options feed must never delay the first useful paint.
      const data = core.validateSnapshot(await fetchJson(`data/market.json?ts=${Date.now()}`));
      render(data, emptyOptions());
      text("#sourceStatus", `منبع: ${currentData.source} · زمان منبع: ${core.formatDate(core.sourceTimestamp(currentData))}`);
      void fetchOptionsInBackground();
      if (showToast) toast("داده داشبورد به‌روزرسانی شد");
    } catch (error) {
      const message = error instanceof Error ? error.message : "خطای ناشناخته در دریافت داده.";
      setStatus(currentData ? "داده قدیمی" : "دریافت ناموفق", "stale");
      text("#sourceStatus", currentData ? `خطا در به‌روزرسانی: ${message} · نمایش آخرین snapshot` : `خطا در دریافت snapshot: ${message}`);
      if (showToast) toast("دریافت داده انجام نشد");
      console.error(error);
    } finally { loading = false; }
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
