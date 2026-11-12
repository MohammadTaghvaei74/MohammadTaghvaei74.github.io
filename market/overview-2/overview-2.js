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
    setText("#netQueue", net === null ? "—" : signed(net, 2));
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
    const width = 760, height = 265, pad = { top: 18, right: 14, bottom: 32, left: 38 };
    if (!values.length) { svg.innerHTML = '<text class="chart-empty" x="430" y="150" text-anchor="middle">داده تاریخی بازار موجود نیست.</text>'; return; }
    const min = Math.min(-3, ...values) - .5, max = Math.max(3, ...values) + .5;
    const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(days.length - 1, 1);
    const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / (max - min);
    const grid = [-3, 0, 3].map((tick) => `<line class="chart-grid ${tick === 0 ? "zero" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-axis" x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${core.faDigits(tick)}</text>`).join("");
    const labelIndexes = days.length <= 6 ? days.map((_, index) => index) : [0, Math.round((days.length - 1) / 4), Math.round((days.length - 1) / 2), Math.round(3 * (days.length - 1) / 4), days.length - 1].filter((index, position, all) => all.indexOf(index) === position); const labels = labelIndexes.map(index => { const day = days[index]; return `<text class="chart-axis" x="${x(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(core.faDigits(String(day.trading_date || "").slice(5)))}</text>`; }).join("");
    svg.innerHTML = `${grid}${labels}<path class="chart-path rest-path" d="${chartPath(series.rest, x, y)}"/><path class="chart-path leader-path" d="${chartPath(series.leaders, x, y)}"/><path class="chart-path market-path" d="${chartPath(series.market, x, y)}"/>`;
  }

  function scoreRow(row) {
    const score = numeric(row.score);
    const tone = score === null ? "missing" : score >= 0 ? "positive" : "negative";
    return `<div class="compact-row"><span class="row-symbol">${escapeHtml(row.symbol)}</span><span class="row-score ${tone}">${escapeHtml(signed(score))}</span></div>`;
  }

  function renderLists(data) {
    const leveraged = Array.isArray(data.leveraged) ? data.leveraged : [];
    const leveragedElement = $("#leveragedStocks");
    const empty = '<tr><td colspan="3" class="parity-empty">داده‌ای برای نمایش نیست.</td></tr>';
    if (leveragedElement) leveragedElement.innerHTML = leveraged.map(row => `<tr><td>${escapeHtml(row.symbol)}</td><td class="${numeric(row.score) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.score, 1))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman || row.sell_queue_value_toman))}</td></tr>`).join("") || empty;
  }

  const leaderSymbols = ["وبملت","فملی","فولاد","وتجارت","فزر","خودرو","شستا","شپدیس","فارس","ومعادن","تاپیکو","خساپا","وبصادر","وپارس","نوری","وپاسار","ونوین","کگل","رمپنا","ذوب","وغدیر","فخوز","خگستر","صبا","وساپا","کالا","اخابر","سپید","شسپا","پارسان","تیپیکو","دزاگرس","مبین","کاما","کچاد","دعبید","خبهمن","اروند","دی","خزامیا"];
  const parityEmpty = '<tr><td colspan="6" class="parity-empty">داده‌ای برای نمایش نیست.</td></tr>';
  const parityLine = (values, width, height, color, min, max) => {
    const clean = values.map(numeric), pad = {top:18,right:12,bottom:24,left:30};
    const x = index => clean.length === 1 ? width / 2 : pad.left + index * (width - pad.left - pad.right) / Math.max(clean.length - 1, 1);
    const y = value => pad.top + (max - value) * (height - pad.top - pad.bottom) / Math.max(max - min, 1);
    let path = "";
    clean.forEach((value, index) => { if (value === null) return; path += `${path && clean[index - 1] !== null ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `; });
    const points = clean.map((value, index) => value === null ? "" : `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3.5" fill="${color}"/>`).join("");
    return path ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${points}` : "";
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
    const intraday = Array.isArray(data.intraday) && data.intraday.length ? data.intraday.slice(-80) : (Array.isArray(data.daily) ? data.daily.slice(-80).map(row => ({...row, time: row.trading_date})) : []);
    renderParityChart("#intradayChart", intraday, [intraday.map(row => row.median_score), intraday.map(row => row.leader_median_score), intraday.map(row => row.rest_median_score)], ["#3f735b","#e87958","#8bb8c9"]);
    const queueValues = Array.isArray(data.queue_intraday) && data.queue_intraday.length ? data.queue_intraday.slice(-80).map(row => ({...row, buy_value_hmt: row.buy_value_hmt, sell_value_hmt: row.sell_value_hmt})) : Array.isArray(data.queue_count_intraday) && data.queue_count_intraday.length ? data.queue_count_intraday.slice(-80).map(row => ({...row, buy_value_hmt: row.buy_queue_count, sell_value_hmt: row.sell_queue_count})) : [{time: core.formatDate(core.sourceTimestamp(data)), buy_value_hmt: numeric(data.market && data.market.buy_value_hmt) || 0, sell_value_hmt: numeric(data.market && data.market.sell_value_hmt) || 0}];
    renderParityChart("#queueChart", queueValues, [queueValues.map(row => row.buy_value_hmt), queueValues.map(row => row.sell_value_hmt)], ["#3f735b","#e87958"], true);
    const topQueue = Array.isArray(data.top_buy_queue) ? data.top_buy_queue : [];
    const queueRows = $("#topBuyQueueRows"); if (queueRows) queueRows.innerHTML = topQueue.map(row => `<tr><td>${escapeHtml(row.symbol)}</td><td class="${numeric(row.score) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.score, 1))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman))}</td><td>${escapeHtml(core.formatBillionToman(row.avg15_trade_value_toman))}</td><td>${escapeHtml(core.formatPercent(row.legal_sell_pct, 0))}</td></tr>`).join("") || '<tr><td colspan="5" class="parity-empty">صف خرید معتبر برای نمایش نیست.</td></tr>';
    const stockMap = new Map((Array.isArray(data.stocks) ? data.stocks : []).map(row => [row.symbol, row]));
    const ranking = [...(Array.isArray(data.stocks) ? data.stocks : [])].filter(row => !core.isBaseMarket(row) && numeric(row.score) !== null).sort((a,b) => numeric(b.score) - numeric(a.score));
    const leaders = leaderSymbols.map(symbol => stockMap.get(symbol) || {symbol, score:null, score_rank:null, score_rank_total:null, buy_queue_value_toman:null}).sort((a,b) => (numeric(b.score) || -Infinity) - (numeric(a.score) || -Infinity));
    const position = row => numeric(row.score_rank) !== null && numeric(row.score_rank_total) ? `${core.faDigits(Math.round((row.score_rank / row.score_rank_total) * 100))}` : (numeric(row.score) === null ? "—" : `${core.faDigits(ranking.findIndex(item => item.symbol === row.symbol) + 1)} / ${core.faDigits(ranking.length)}`);
    const leaderRows = $("#leaderRows"); if (leaderRows) leaderRows.innerHTML = leaders.map(row => `<tr><td>${escapeHtml(row.symbol)}</td><td class="${numeric(row.score) >= 0 ? "positive" : "negative"}">${escapeHtml(signed(row.score, 1))}</td><td>${escapeHtml(position(row))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman))}</td>`).join("") || parityEmpty;
    const industries = Array.isArray(data.industry_table) ? data.industry_table : (Array.isArray(data.industries) ? data.industries : []);
    const industryAverages = new Map();
    (Array.isArray(data.stocks) ? data.stocks : []).filter(row => !core.isBaseMarket(row)).forEach(row => { const value = numeric(row.avg15_trade_value_toman); if (!row.industry || value === null) return; const item = industryAverages.get(row.industry) || {sum: 0, count: 0}; item.sum += value; item.count += 1; industryAverages.set(row.industry, item); });
    const industryRows = $("#industryRows"); if (industryRows) industryRows.innerHTML = industries.map(row => { const avg = row.avg_trade_value_15d_toman !== undefined ? row.avg_trade_value_15d_toman : (industryAverages.has(row.industry) ? industryAverages.get(row.industry).sum / industryAverages.get(row.industry).count : null); return `<tr><td>${escapeHtml(row.industry)}</td><td>${escapeHtml(signed(row.median_score !== undefined ? row.median_score : row.median, 1))}</td><td>${escapeHtml(core.formatBillionToman(row.trade_value_toman !== undefined ? row.trade_value_toman : row.turnover_toman))}</td><td>${escapeHtml(core.formatBillionToman(avg))}</td></tr>`; }).join("") || '<tr><td colspan="4" class="parity-empty">داده صنعت برای نمایش نیست.</td></tr>';
    const comprehensiveRows = $("#comprehensiveRows"); if (comprehensiveRows) comprehensiveRows.innerHTML = (Array.isArray(data.stocks) ? data.stocks : []).map(row => { const closePct = core.closePercent(row.close_price, row.yesterday_price); const lastCloseDiff = numeric(row.last_pct) === null || closePct === null ? null : numeric(row.last_pct) - closePct; return `<tr><td>${escapeHtml(row.symbol)}</td><td>${escapeHtml(row.industry)}</td><td>${escapeHtml(signed(row.score, 1))}</td><td>${escapeHtml(signed(row.score_10d_total, 1))}</td><td>${escapeHtml(row.score_position_pct === null || row.score_position_pct === undefined ? "—" : core.formatPercent(row.score_position_pct, 0))}</td><td>${escapeHtml(row.industry_position_pct === null || row.industry_position_pct === undefined ? "—" : core.formatPercent(row.industry_position_pct, 0))}</td><td>${escapeHtml(core.formatBillionToman(row.avg15_trade_value_toman))}</td><td>${escapeHtml(core.formatPercent(lastCloseDiff, 1))}</td><td>${escapeHtml(core.formatQueueBillion(row.buy_queue_value_toman || row.sell_queue_value_toman))}</td><td>${escapeHtml(core.formatMillionToman(row.buy_per_capita_toman))}</td><td>${escapeHtml(core.formatNumber(row.buyer_power, 1))}</td><td>${escapeHtml(core.formatPercent(row.legal_buy_pct, 0))}</td><td>${escapeHtml(core.formatPercent(row.legal_sell_pct, 0))}</td></tr>`; }).join("") || parityEmpty;
    const fundRows = $("#fundRows"), funds = data.fund_report && Array.isArray(data.fund_report.rows) ? data.fund_report.rows.filter(row => numeric(row.portfolio_score) !== null && numeric(row.board_score) !== null && numeric(row.score_diff) !== null) : [];
    if (fundRows) fundRows.innerHTML = funds.map((row,index) => `<tr><td>${core.faDigits(index + 1)}</td><td>${escapeHtml(row.symbol)}</td><td>${escapeHtml(core.formatPercent(row.bubble_pct, 1))}</td><td>${escapeHtml(core.formatBillionToman(row.avg_daily_value_toman))}</td><td>${escapeHtml(signed(row.portfolio_score, 1))}</td><td>${escapeHtml(signed(row.board_score, 1))}</td><td>${escapeHtml(signed(row.score_diff, 1))}</td><td>${escapeHtml(core.faDigits(row.display_portfolio_date || row.portfolio_last_update || "—"))}</td></tr>`).join("") || '<tr><td colspan="8" class="parity-empty">صندوقی با سه امتیاز معتبر برای نمایش نیست.</td></tr>';
    const payload = options && typeof options === "object" ? options : data.options || {};
    const pairs = Array.isArray(payload.pairs) ? payload.pairs.filter(pair => pair.eligible === true) : [];
    setText("#optionsState", payload.message || (pairs.length ? "جفت‌های واجد شرایط نمایش داده می‌شوند." : "فعلاً جفت واجد شرایطی برای نمایش نیست."));
    setText("#optionsEligible", payload.counts && payload.counts.eligible_pairs !== undefined ? integer(payload.counts.eligible_pairs) : integer(pairs.length));
    setText("#optionsContracts", payload.counts && payload.counts.contracts !== undefined ? integer(payload.counts.contracts) : integer(Array.isArray(payload.contracts) ? payload.contracts.length : null));
    setText("#optionsSourceTime", payload.source_at ? `${payload.source || "—"} · ${core.formatDate(payload.source_at)}` : "—");
    const optionRows = $("#optionsRows"); if (optionRows) optionRows.innerHTML = pairs.slice(0,20).map(pair => `<tr><td>${escapeHtml(pair.underlying)}</td><td>${escapeHtml(pair.expiry)}<small>${escapeHtml(integer(pair.dte))} روز</small></td><td>${escapeHtml(core.formatNumber(pair.net_debit_toman, 1))}</td><td class="positive">${escapeHtml(core.formatPercent(pair.monthly_return_pct, 1))}</td></tr>`).join("") || '<tr><td colspan="4" class="parity-empty">جفت واجد شرایطی برای نمایش نیست.</td></tr>';
  }
  function render(data, options) { currentData = data; renderSummary(data); renderChart(data); renderLists(data); renderParity(data, options); }

  const normalizeSortable = (value) => String(value === null || value === undefined ? "" : value)
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const sortValue = (value) => {
    const normalized = normalizeSortable(value).replace(/[٪%]/g, "").replace(/[٬،,]/g, "").replace(/−/g, "-").replace(/٫/g, ".").trim();
    if (!normalized || normalized === "—" || normalized === "-") return {type: "missing", value: null};
    const numberValue = Number(normalized.replace(/[^0-9.+-].*$/g, ""));
    return Number.isFinite(numberValue) && /^[-+]?\d/.test(normalized) ? {type: "number", value: numberValue} : {type: "text", value: normalized};
  };
  function parseFilter(input, selectedOperator) {
    const raw = normalizeSortable(input).replace(/٪/g, "%").trim();
    const match = raw.match(/^(>|<|=)\s*(.+)$/);
    const operator = selectedOperator || (match ? match[1] : ">");
    const value = (match && !selectedOperator ? match[2] : raw).trim();
    const number = Number(value.replace(/[%٬،,]/g, "").replace(/٫/g, "."));
    return {operator, value, number: Number.isFinite(number) ? number : null};
  }
  function applyTableFilter(table) {
    const filters = (table._overviewFilters || []).map(filter => parseFilter(filter.input.value, filter.operator.value));
    Array.from(table.tBodies[0] ? table.tBodies[0].rows : []).forEach(row => {
      row.hidden = filters.some((filter, index) => {
        if (!filter.value) return false;
        const cell = row.cells[index] && row.cells[index].textContent;
        const parsed = sortValue(cell);
        if (filter.number === null || parsed.type !== "number") return filter.operator === "=" ? !normalizeSortable(cell).toLocaleLowerCase("fa").includes(filter.value.toLocaleLowerCase("fa")) : true;
        if (filter.operator === ">") return !(parsed.value > filter.number);
        if (filter.operator === "<") return !(parsed.value < filter.number);
        return parsed.value !== filter.number;
      });
    });
  }
  function applyTableSort(table) {
    const state = table._overviewSort;
    const tbody = table.tBodies[0];
    if (!tbody) return;
    if (state.direction === "none") state.defaultRows.forEach(row => tbody.appendChild(row));
    else {
      const rows = Array.from(tbody.rows).sort((left, right) => {
        const a = sortValue(left.cells[state.column] && left.cells[state.column].textContent);
        const b = sortValue(right.cells[state.column] && right.cells[state.column].textContent);
        if (a.type === "missing" && b.type === "missing") return Number(left.dataset.defaultIndex) - Number(right.dataset.defaultIndex);
        if (a.type === "missing") return 1;
        if (b.type === "missing") return -1;
        const result = a.type === "number" && b.type === "number" ? a.value - b.value : String(a.value).localeCompare(String(b.value), "fa");
        return (state.direction === "asc" ? result : -result) || (Number(left.dataset.defaultIndex) - Number(right.dataset.defaultIndex));
      });
      rows.forEach(row => tbody.appendChild(row));
    }
    Array.from(table.tHead ? table.tHead.rows[0].cells : []).forEach((header, index) => header.setAttribute("aria-sort", state.column === index && state.direction !== "none" ? state.direction === "asc" ? "ascending" : "descending" : "none"));
    applyTableFilter(table);
  }
  function enhanceTables() {
    document.querySelectorAll(".parity-card table, .compact-table").forEach(table => {
      const tbody = table.tBodies[0];
      const headers = table.tHead && table.tHead.rows[0] ? Array.from(table.tHead.rows[0].cells) : [];
      if (!tbody || !headers.length) return;
      table.classList.add("sortable-table");
      if (!table._overviewInitialized) {
        const tools = document.createElement("div"); tools.className = "table-tools";
        table._overviewFilters = headers.map(header => { const field = document.createElement("span"); field.className = "table-filter-field"; const operator = document.createElement("select"); operator.setAttribute("aria-label", `عملگر فیلتر ${header.textContent.trim()}`); [[">","بیشتر از"],["<","کمتر از"],["=","برابر"]].forEach(([value,label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; operator.appendChild(option); }); const isNumericFilter = /امتیاز|صف|ارزش|جایگاه|قدرت|سرانه|حباب|اختلاف|رتبه|خ حقوقی|ف حقوقی|بازده|Debit|درصد/i.test(header.textContent); operator.hidden = !isNumericFilter; operator.value = isNumericFilter ? ">" : "contains"; const input = document.createElement("input"); input.type = "search"; input.inputMode = "text"; input.placeholder = `فیلتر ${header.textContent.trim()}`; input.setAttribute("aria-label", `مقدار فیلتر ستون ${header.textContent.trim()}`); input.addEventListener("input", () => applyTableFilter(table)); operator.addEventListener("change", () => applyTableFilter(table)); field.appendChild(operator); field.appendChild(input); tools.appendChild(field); return {input, operator}; });
        table.closest(".parity-card, .data-card").insertBefore(tools, table.closest(".table-scroll, .compact-table-wrap") || table);
        table._overviewSort = {column: -1, direction: "none", defaultRows: []};
        headers.forEach((header, index) => {
          header.tabIndex = 0; header.setAttribute("role", "button"); header.setAttribute("aria-sort", "none"); header.title = "کلیک برای مرتب‌سازی؛ سه حالت";
          const toggle = () => { const state = table._overviewSort; if (state.column !== index) { state.column = index; state.direction = "asc"; } else if (state.direction === "asc") state.direction = "desc"; else if (state.direction === "desc") state.direction = "none"; else state.direction = "asc"; applyTableSort(table); };
          header.addEventListener("click", toggle); header.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
        });
        table._overviewInitialized = true;
      }
      table._overviewSort.column = -1; table._overviewSort.direction = "none";
      table._overviewSort.defaultRows = Array.from(tbody.rows);
      table._overviewSort.defaultRows.forEach((row, index) => { row.dataset.defaultIndex = String(index); row.hidden = false; });
      applyTableSort(table);
    });
  }
  const renderWithTables = render;
  render = function(data, options) { renderWithTables(data, options); enhanceTables(); };

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

  const themeToggle = $("#themeToggle");
  const applyTheme = (dark) => {
    document.documentElement.classList.toggle("dark-mode", dark);
    if (themeToggle) { themeToggle.querySelector("b").textContent = dark ? "لایت" : "دارک"; themeToggle.setAttribute("aria-pressed", String(dark)); }
  };
  const savedTheme = window.localStorage ? window.localStorage.getItem("overview-2-theme") : null;
  const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme === "dark" || (savedTheme === null && systemDark));
  if (themeToggle) themeToggle.addEventListener("click", () => { const dark = !document.documentElement.classList.contains("dark-mode"); applyTheme(dark); if (window.localStorage) window.localStorage.setItem("overview-2-theme", dark ? "dark" : "light"); });
  const refreshButton = $("#refreshButton");
  if (refreshButton) refreshButton.addEventListener("click", () => loadData(true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadData(); });
  loadData();
  window.setInterval(() => loadData(), 60000);
})();
