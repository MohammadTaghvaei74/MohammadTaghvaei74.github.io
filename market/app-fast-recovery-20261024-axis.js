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
  let industryFilterBound = false;
  let activeIndustryPreset = null;
  const industryColumnFilters = {industry: [{op: "contains", value: ""}], rank: [{op: "", value: ""}, {op: "", value: ""}], count: [{op: "", value: ""}, {op: "", value: ""}], median: [{op: "", value: ""}, {op: "", value: ""}], turnover: [{op: "", value: ""}, {op: "", value: ""}], diff: [{op: "", value: ""}, {op: "", value: ""}]};
  const industryFilterJoin = {rank: "and", count: "and", median: "and", turnover: "and", diff: "and"};

  if (!core) {
    console.error("Market core failed to load");
    return;
  }

  const escapeHtml = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  const numeric = (value) => core.number(value);
  const formatHmt = (value) => core.formatNumber(value, 1);
  const formatValueBillion = (value) => { const parsed = numeric(value); return parsed === null ? "—" : core.faDigits(Math.round(parsed / 1e9).toLocaleString("fa-IR")); };
  const signed = (value, digits = 1) => core.formatSigned(value, digits);
  const pct = (value) => core.formatPercent(value, 1);
  const percentMarkup = (value) => { const label = pct(value); return label === "—" ? label : `<strong>${escapeHtml(label.slice(0, -1))}</strong> <span class="percent-unit">٪</span>`; };
  const integer = (value) => core.formatInteger(value);
  const closePct = (row) => core.closePercent(row.close_price, row.yesterday_price);
  const lastCloseDiffPct = (row) => {
    const last = numeric(row && row.last_pct);
    const close = closePct(row);
    return last === null || close === null ? null : last - close;
  };

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
    return `<span class="market-position" title="رتبه ${core.faDigits(position.rank)} از ${core.faDigits(position.total)}"><strong>${core.faDigits(percentage)}</strong> <span class="percent-unit">٪</span></span>`;
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
    const marketTimestamp = core.sourceTimestamp(data);
    const lastUpdate = $("#lastUpdate");
    if (lastUpdate) {
      lastUpdate.textContent = core.formatDate(marketTimestamp, true);
      lastUpdate.dateTime = marketTimestamp || "";
    }
    text("#updatedAt", core.formatDate(marketTimestamp));
    text("#sourceStatus", `منبع: ${data.source || "نامشخص"} · زمان منبع: ${core.formatDate(marketTimestamp)}`);
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
    const points = values.map((value, index) => numeric(value) === null ? null : {x: x(index), y: y(value)});
    let path = "";
    points.forEach((point, index) => {
      if (!point) return;
      const previous = points[index - 1];
      const next = points[index + 1];
      if (!previous) {
        path += `M${point.x.toFixed(1)},${point.y.toFixed(1)} `;
        return;
      }
      const before = points[index - 2] || previous;
      const after = next || point;
      const cp1x = previous.x + (point.x - before.x) / 6;
      const cp1y = previous.y + (point.y - before.y) / 6;
      const cp2x = point.x - (after.x - previous.x) / 6;
      const cp2y = point.y - (after.y - previous.y) / 6;
      path += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)} `;
    });
    return path.trim();
  }

  function chartTooltipMarkup(index, points, series, x, y) {
    const point = points[index] || {};
    const values = [
      ["کل بازار", series.market[index], "#111827"],
            ["لیدرها", series.leaders[index], "#2686c5"],

    ].filter(([, value]) => numeric(value) !== null);
    const tooltipWidth = 190;
    const tooltipHeight = 30 + values.length * 19;
    const rawX = x(index) + 14;
    const tooltipX = rawX + tooltipWidth > 1200 ? x(index) - tooltipWidth - 14 : rawX;
    const tooltipY = Math.max(8, Math.min(460 - tooltipHeight - 8, y(numeric(series.market[index]) !== null ? numeric(series.market[index]) : numeric(series.leaders[index])) - tooltipHeight / 2));
    const time = escapeHtml(core.faDigits(String(point.time || "—").slice(0, 5)));
    const rows = values.map(([label, value, color], rowIndex) => `<circle cx="${tooltipX + 12}" cy="${tooltipY + 31 + rowIndex * 19}" r="3.5" fill="${color}"/><text class="chart-tooltip-value" fill="#ffffff" x="${tooltipX + tooltipWidth - 12}" y="${tooltipY + 35 + rowIndex * 19}" text-anchor="end">${escapeHtml(label)}: ${escapeHtml(signed(value, 2))}</text>`).join("");
    return `<g class="chart-tooltip active" data-tooltip-index="${index}" role="status"><rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="8" fill="#07131a" stroke="#ffffff"/><text class="chart-tooltip-title" fill="#ffffff" x="${tooltipX + tooltipWidth - 12}" y="${tooltipY + 20}" text-anchor="end">ساعت ${time}</text>${rows}</g>`;
  }

  function densifyIntraday(points, startTime = "09:05") {
    const candidates = points.filter((point) => point && /^\d{2}:\d{2}$/.test(String(point.time || ""))).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const observedByTimestamp = new Map();
    candidates.forEach((point) => {
      const sourceKey = point.timestamp ? String(point.timestamp).slice(0, 16) : String(point.time);
      if (!observedByTimestamp.has(sourceKey)) observedByTimestamp.set(sourceKey, point);
    });
    const valid = [...observedByTimestamp.values()];
    if (!valid.length) return [];
    const toMinutes = (time) => Number(String(time).slice(0, 2)) * 60 + Number(String(time).slice(3, 5));
    const fromMinutes = toMinutes(startTime);
    const lastMinute = toMinutes(valid[valid.length - 1].time);
    const byMinute = new Map(valid.map((point) => [toMinutes(point.time), point]));
    const interpolate = (left, right, key, ratio) => {
      const a = numeric(left && left[key]);
      const b = numeric(right && right[key]);
      return a === null || b === null ? (a === null ? b : a) : a + (b - a) * ratio;
    };
    const result = [];
    let latest = null;
    for (let minute = fromMinutes; minute <= lastMinute; minute += 1) {
      const source = byMinute.get(minute);
      if (source) latest = source;
      if (!latest) {
        result.push({time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`, median_score: null, leader_median_score: null});
        continue;
      }
      const next = valid.find((point) => toMinutes(point.time) > minute);
      const previousMinute = toMinutes(latest.time);
      const ratio = next ? (minute - previousMinute) / Math.max(toMinutes(next.time) - previousMinute, 1) : 0;
      result.push({...latest,
        time: `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
        median_score: source ? source.median_score : interpolate(latest, next, "median_score", ratio),
        leader_median_score: source ? source.leader_median_score : interpolate(latest, next, "leader_median_score", ratio),
      });
    }
    return result;
  }

  function renderQueueChart(data) {
    const svg = $("#queueChart");
    if (!svg) return;
    const rows = Array.isArray(data.queue_intraday) ? data.queue_intraday : [];
    const values = rows.flatMap((row) => [numeric(row.buy_value_hmt), numeric(row.sell_value_hmt)]).filter((value) => value !== null);
    if (!values.length) { svg.innerHTML = `<text class="chart-empty" x="600" y="145" text-anchor="middle">داده ارزش صف‌ها برای امروز موجود نیست.</text>`; return; }
    const width = 1200, height = 460, pad = {top:18,right:24,bottom:46,left:92};
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 0.01);
    const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(rows.length - 1, 1);
    const y = (value) => pad.top + (max - value) * (height - pad.top - pad.bottom) / range;
    const path = (key) => pathFor(rows.map((row) => row[key]), x, y);
    const ticks = [min, min + range / 2, max].map((tick, index) => `<line class="${index === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width-pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left-12}" y="${y(tick)+6}" text-anchor="end">${core.formatNumber(tick,1)} همت</text>`).join("");
    const labels = rows.map((row, index) => index === 0 || index === rows.length - 1 || /:(00|30)$/.test(row.time || "") ? `<text class="chart-label" x="${x(index)}" y="${height-8}" text-anchor="middle">${escapeHtml(core.faDigits(row.time || "—"))}</text>` : "").join("");
    svg.innerHTML = `${ticks}${labels}<path class="chart-path chart-buy" d="${path("buy_value_hmt")}"/><path class="chart-path chart-sell" d="${path("sell_value_hmt")}"/>`;
  }

  function renderChart(data) {
    const svg = $("#marketChart");
    if (!svg) return;
    const points = densifyIntraday(Array.isArray(data.intraday) ? data.intraday : [], "09:15");
    const days = points;
    const series = {
      leaders: points.map((row) => row.leader_median_score),

      market: points.map((row) => row.median_score),
    };
    const actualValues = [series.leaders, series.market].flat().map(numeric).filter((value) => value !== null);
    const width = 1200, height = 560, pad = { top: 8, right: 24, bottom: 30, left: 62 };
    if (!actualValues.length) {
      svg.innerHTML = `<text class="chart-empty" x="600" y="180" text-anchor="middle">دادهٔ امروز از ۰۹:۰۵ هنوز موجود نیست.</text>`;
      return;
    }
    const min = Math.min(...actualValues);
    const max = Math.max(...actualValues);
    const chartMax = max === min ? max + 0.01 : max;
    const x = (index) => pad.left + index * (width - pad.left - pad.right) / Math.max(days.length - 1, 1);
    const y = (value) => pad.top + (chartMax - value) * (height - pad.top - pad.bottom) / (chartMax - min);
    const marketPath = pathFor(series.market, x, y);
    const leadersPath = pathFor(series.leaders, x, y);

    const zeroY = y(0);
    // Do not bridge missing samples with a filled area.
    const areaPath = marketPath && series.market.every((value) => value !== null) ? `${marketPath} L ${x(days.length - 1)},${zeroY} L ${x(0)},${zeroY} Z` : "";
    const ticks = [min, min + (chartMax - min) / 2, chartMax];
    const grid = ticks.map((tick, index) => `<line class="${index === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left - 11}" y="${y(tick) + 6}" text-anchor="end">${core.formatNumber(tick, 1)}</text>`).join("");
    const labels = days.map((point, index) => {
      const time = String(point.time || "").slice(0, 5);
      return /:(00|30)$/.test(time) || index === days.length - 1 ? `<text class="chart-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(core.faDigits(time))}</text>` : "";
    }).join("");
    const leadersMarkup = leadersPath ? `<path class="chart-path chart-leaders" d="${leadersPath}"/>` : "";

    const plotWidth = width - pad.left - pad.right;
    const step = plotWidth / Math.max(days.length - 1, 1);
    const hitArea = `<rect class="chart-hit-area" x="${pad.left}" y="${pad.top}" width="${plotWidth}" height="${height - pad.top - pad.bottom}" tabindex="0" aria-label="نقاط نمودار امتیاز"/>`;
    const bands = `<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8df55" stop-opacity=".25"/><stop offset="1" stop-color="#b8df55" stop-opacity="0"/></linearGradient><linearGradient id="positiveBand" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#9bd5a3" stop-opacity=".035"/><stop offset="1" stop-color="#5cae70" stop-opacity=".20"/></linearGradient><linearGradient id="negativeBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e5a0a0" stop-opacity=".035"/><stop offset="1" stop-color="#c96b70" stop-opacity=".20"/></linearGradient></defs><rect x="${pad.left}" y="${y(3)}" width="${plotWidth}" height="${zeroY - y(3)}" fill="url(#positiveBand)"/><rect x="${pad.left}" y="${zeroY}" width="${plotWidth}" height="${y(-3) - zeroY}" fill="url(#negativeBand)"/>`;
    svg.innerHTML = `${bands}${grid}${labels}${areaPath ? `<path class="chart-area" d="${areaPath}"/>` : ""}${leadersMarkup}<path class="chart-path chart-market" d="${marketPath}"/><line class="chart-crosshair" x1="${x(0)}" x2="${x(0)}" y1="${pad.top}" y2="${height - pad.bottom}" opacity="0"/>${hitArea}`;
    const chartWrap = svg.parentElement;
    let tooltip = chartWrap && chartWrap.querySelector(".chart-tooltip-html");
    if (!tooltip && chartWrap) {
      tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip-html";
      tooltip.hidden = true;
      chartWrap.appendChild(tooltip);
    }
    let lastTooltipIndex = -1;
    const showTooltip = (index) => {
      if (index === lastTooltipIndex) return;
      lastTooltipIndex = index;
      const crosshair = svg.querySelector(".chart-crosshair");
      if (crosshair) { crosshair.setAttribute("x1", x(index)); crosshair.setAttribute("x2", x(index)); crosshair.setAttribute("opacity", "1"); crosshair.style.opacity = "1"; }
      if (tooltip) {
        const point = days[index] || {};
        const market = numeric(series.market[index]);
        const leaders = numeric(series.leaders[index]);
        tooltip.innerHTML = `<strong>ساعت ${core.faDigits(String(point.time || "—").slice(0, 5))}</strong><span class="market-value">کل بازار: ${market === null ? "—" : escapeHtml(signed(market, 2))}</span><span class="leader-value">لیدرها: ${leaders === null ? "—" : escapeHtml(signed(leaders, 2))}</span>`;
        const box = svg.getBoundingClientRect();
        const wrapBox = chartWrap.getBoundingClientRect();
        tooltip.hidden = false;
        tooltip.style.left = `${(x(index) / width) * box.width + (box.left - wrapBox.left)}px`;
        const anchor = market === null ? (leaders === null ? 0 : leaders) : market;
        tooltip.style.top = `${(y(anchor) / height) * box.height + (box.top - wrapBox.top)}px`;
      }
    };
    const hideTooltip = () => {
      if (tooltip) tooltip.hidden = true;
      const crosshair = svg.querySelector(".chart-crosshair");
      if (crosshair) { crosshair.setAttribute("opacity", "0"); crosshair.style.opacity = "0"; }
      lastTooltipIndex = -1;
    };
    const hitAreaElement = svg.querySelector(".chart-hit-area");
    const moveTooltip = (event) => {
      const box = svg.getBoundingClientRect();
      const svgX = (event.clientX - box.left) * width / box.width;
      showTooltip(Math.max(0, Math.min(days.length - 1, Math.round((svgX - pad.left) / step))));
    };
    if (hitAreaElement) {
      hitAreaElement.addEventListener("pointerenter", moveTooltip);
      hitAreaElement.addEventListener("pointermove", moveTooltip);
      hitAreaElement.addEventListener("focus", () => showTooltip(0));
      hitAreaElement.addEventListener("pointerleave", hideTooltip);
      hitAreaElement.addEventListener("blur", hideTooltip);
    };
  }

  function scoreClass(value) {
    const parsed = numeric(value);
    return parsed === null ? "missing" : parsed >= 0 ? "high" : "low";
  }

  function symbolLink(symbol, className = "ranking-symbol") {
    if (symbol === null || symbol === undefined) return "—";
    const value = String(symbol);
    if (!value || typeof symbol !== "string") return escapeHtml(value);
    return `<a class="${className}" href="symbols/?symbol=${encodeURIComponent(value)}">${escapeHtml(value)}</a>`;
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
    const topMarkup = top.map((row) => `<tr><td>${symbolLink(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${marketPositionMarkup(row, ranking)}</td><td>${queueMarkup(row)}</td></tr>`).join("");
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
    const leveragedMarkup = leveraged.map((row) => `<tr><td>${symbolLink(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${queueMarkup(row)}</td></tr>`).join("");
    const leveragedElement = $("#leveragedStocks");
    if (leveragedElement) leveragedElement.innerHTML = leveragedMarkup || `<tr><td colspan="3">هنوز snapshot اهرمی ثبت نشده است.</td></tr>`;
    const leaderSymbols = ['وبملت','فملی','فولاد','وتجارت','فزر','خودرو','شستا','شپدیس','فارس','ومعادن','تاپیکو','خساپا','وبصادر','وپارس','نوری','وپاسار','ونوین','کگل','رمپنا','ذوب','وغدیر','فخوز','خگستر','صبا','وساپا','کالا','اخابر','سپید','شسپا','پارسان','تیپیکو','دزاگرس','مبین','کاما','کچاد','دعبید','خبهمن','اروند','دی','خزامیا'];
    const bySymbol = new Map((Array.isArray(data.stocks) ? data.stocks : []).map(row => [row.symbol, row]));
    const leaders = leaderSymbols.map(symbol => bySymbol.get(symbol) || {symbol, score:null, avg15_trade_value_toman:null, trade_value_toman:null});
    leaders.sort((a,b) => (numeric(a.score) === null) - (numeric(b.score) === null) || (numeric(b.score) || 0) - (numeric(a.score) || 0) || a.symbol.localeCompare(b.symbol,'fa'));
    const leaderElement = $('#leaderStocks');
    if (leaderElement) leaderElement.innerHTML = leaders.map((row) => `<tr><td>${symbolLink(row.symbol)}</td><td><span class="score ${scoreClass(row.score)}">${escapeHtml(signed(row.score))}</span></td><td>${marketPositionMarkup(row, ranking)}</td><td>${queueMarkup(row)}</td></tr>`).join('');
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
    const stocks = Array.isArray(data.stocks) ? data.stocks : [];
    const groups = new Map();
    stocks.forEach((stock) => {
      const name = String(stock.industry || "").trim();
      if (!name) return;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(stock);
    });
    const sourceRows = Array.isArray(data.industry_table) && data.industry_table.length ? data.industry_table : (Array.isArray(data.industries) ? data.industries : []);
    const rows = sourceRows.map((row) => {
      const members = groups.get(String(row.industry || "").trim()) || [];
      const diffs = members.map(lastCloseDiffPct).filter((value) => value !== null);
      const turnover = members.reduce((sum, stock) => sum + (numeric(stock.trade_value_toman) || 0), 0);
      const avgDiff = diffs.length ? diffs.reduce((sum, value) => sum + value, 0) / diffs.length : numeric(row.avg_last_close_diff_pct);
      const rowScore = numeric(row.median !== undefined ? row.median : row.median_score);
      return { ...row, count: members.length || row.count || row.stock_count, median: rowScore, turnover_toman: turnover || numeric(row.turnover_toman || row.trade_value_toman), avg_last_close_diff_pct: avgDiff };
    });
    const totalIndustries = rows.length;
    const compareIndustryFilter = (value, filter, scale = 1) => {
      if (!filter || !filter.op || filter.value === "") return true;
      const actual = numeric(value);
      const expected = numeric(filter.value);
      if (actual === null || expected === null) return false;
      const left = actual / scale;
      if (filter.op === "=") return left === expected;
      if (filter.op === ">") return left > expected;
      if (filter.op === ">=") return left >= expected;
      if (filter.op === "<") return left < expected;
      if (filter.op === "<=") return left <= expected;
      return true;
    };
    const matchesTwo = (value, filters, scale) => {
      const active = filters.filter((filter) => filter.op && filter.value !== "");
      if (!active.length) return true;
      return industryFilterJoin.and === "and" ? active.every((filter) => compareIndustryFilter(value, filter, scale)) : active.some((filter) => compareIndustryFilter(value, filter, scale));
    };
    const query = String(industryColumnFilters.industry[0].value || "").trim().toLocaleLowerCase("fa");
    const visibleRows = rows.filter((row, index) => {
      const name = String(row.industry || "");
      const rank = numeric(row.rank) || index + 1;
      const rankPercent = numeric(row.rank_position_pct) || Math.round(rank / totalIndustries * 100);
      const moneyWhere = activeIndustryPreset !== "money-where" || (rankPercent < 20 && numeric(row.turnover_toman) !== null && row.turnover_toman / 1000000000 > 500);
      return moneyWhere && (!query || name.toLocaleLowerCase("fa").indexOf(query) >= 0) && matchesTwo(rank, industryColumnFilters.rank, 1) && matchesTwo(row.count, industryColumnFilters.count, 1) && matchesTwo(row.median, industryColumnFilters.median, 1) && matchesTwo(row.turnover_toman, industryColumnFilters.turnover, 1000000000) && matchesTwo(row.avg_last_close_diff_pct, industryColumnFilters.diff, 1);
    });
    const markup = visibleRows.map((row, index) => {
      const score = numeric(row.median !== undefined ? row.median : row.median_score);
      const positive = score === null || score >= 0;
      const industry = String(row.industry || "بدون صنعت");
      const rank = numeric(row.rank) || index + 1;
      const rankPercent = numeric(row.rank_position_pct) || Math.round(rank / totalIndustries * 100);
      return `<tr><td class="industry-name-cell"><a href="industries/?industry=${encodeURIComponent(industry)}" aria-label="مشاهده سهام صنعت ${escapeHtml(industry)}">${escapeHtml(industry)}</a></td><td data-sort-value="${rank}"><bdi dir="ltr" title="رتبه ${escapeHtml(integer(rank))} از ${escapeHtml(integer(totalIndustries))}"><strong>${escapeHtml(integer(rankPercent))}</strong> <span class="percent-unit">٪</span></bdi></td><td>${escapeHtml(integer(row.count))}</td><td><span class="industry-median ${positive ? "" : "negative"}">${escapeHtml(signed(score))}</span></td><td data-sort-value="${numeric(row.turnover_toman) === null ? "" : row.turnover_toman}">${escapeHtml(formatValueBillion(row.turnover_toman))}</td><td data-sort-value="${numeric(row.avg_last_close_diff_pct) === null ? "" : row.avg_last_close_diff_pct}"><bdi dir="ltr" class="industry-signed-value">${percentMarkup(row.avg_last_close_diff_pct)}</bdi></td></tr>`;
    }).join("");
    const element = $("#industriesGrid");
    if (element) element.innerHTML = markup || `<tr><td colspan="6" class="industry-empty">داده صنعت هنوز آماده نیست.</td></tr>`;
  }

  function bindIndustryColumnFilters() {
    const table = $(".industry-table");
    if (!table) return;
    if (!industryFilterBound) {
      industryFilterBound = true;
      table.addEventListener("input", (event) => {
        const input = event.target.closest("[data-industry-filter]");
        if (!input) return;
        const key = input.getAttribute("data-industry-filter");
        const slot = Number(input.getAttribute("data-slot") || 0);
        industryColumnFilters[key][slot].value = input.value;
        if (currentData) renderIndustries(currentData);
      });
      table.addEventListener("change", (event) => {
        const control = event.target.closest("[data-industry-op]");
        if (!control) return;
        const key = control.getAttribute("data-industry-op");
        const slot = Number(control.getAttribute("data-slot") || 0);
        industryColumnFilters[key][slot].op = control.value;
        if (currentData) renderIndustries(currentData);
      });
    }
    const operators = `<option value="">شرط</option><option value=">">&gt;</option><option value=">=">≥</option><option value="=">=</option><option value="<">&lt;</option><option value="<=">≤</option>`;
    table.querySelectorAll("[data-filter-cell]").forEach((cell) => {
      const key = cell.getAttribute("data-filter-cell");
      const placeholder = key === "turnover" ? "میلیارد" : key === "diff" ? "درصد" : "عدد";
      cell.innerHTML = `<div class="industry-filter-stack"><span class="industry-filter-pair" dir="ltr"><select data-industry-op="${key}" data-slot="0" aria-label="فیلتر اول ${key}">${operators}</select><input data-industry-filter="${key}" data-slot="0" inputmode="decimal" placeholder="${placeholder}" aria-label="مقدار فیلتر اول ${key}"></span><span class="industry-filter-pair" dir="ltr"><select data-industry-op="${key}" data-slot="1" aria-label="فیلتر دوم ${key}">${operators}</select><input data-industry-filter="${key}" data-slot="1" inputmode="decimal" placeholder="${placeholder}" aria-label="مقدار فیلتر دوم ${key}"></span></div>`;
      cell.querySelectorAll("[data-industry-op]").forEach((control) => { const slot = Number(control.getAttribute("data-slot")); control.value = industryColumnFilters[key][slot].op; });
      cell.querySelectorAll("[data-industry-filter]").forEach((control) => { const slot = Number(control.getAttribute("data-slot")); control.value = industryColumnFilters[key][slot].value; });
    });
    const textInput = table.querySelector('[data-industry-filter="industry"]');
    if (textInput) textInput.value = industryColumnFilters.industry[0].value;
    const presetButton = document.querySelector('[data-industry-preset="money-where"]');
    if (presetButton) presetButton.setAttribute("aria-pressed", activeIndustryPreset === "money-where" ? "true" : "false");
  }
  const industryPresetButton = document.querySelector('[data-industry-preset="money-where"]');
  if (industryPresetButton) industryPresetButton.addEventListener("click", () => {
    activeIndustryPreset = activeIndustryPreset === "money-where" ? null : "money-where";
    if (currentData) renderIndustries(currentData);
  });
  bindIndustryColumnFilters();

  const optionsNumber = (value, digits = 0) => { const parsed = numeric(value); return parsed === null ? "—" : core.faDigits(parsed.toLocaleString("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: digits })); };
  const optionsPercent = (value) => { const parsed = numeric(value); return parsed === null ? "—" : `<strong>${optionsNumber(parsed, 1)}</strong> <span class="percent-unit">٪</span>`; };
  function optionsStatusLabel(status) { return ({ ready: "داده معتبر آماده است.", no_opportunity: "فعلاً جفت واجد شرایط پیدا نشد.", insufficient_data: "داده کافی برای محاسبه کامل نیست.", stale: "داده آپشن قدیمی است.", unavailable: "منبع داده آپشن در دسترس نیست." }[status] || "وضعیت داده نامشخص است."); }
  function renderFundReport(data) {
    const payload = data && data.fund_report || {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const element = $("#fundReportRows");
    if (!element) return;
    const n = (value, digits = 1) => numeric(value) === null ? "—" : core.faDigits(Number(value).toLocaleString("fa-IR", {minimumFractionDigits: digits, maximumFractionDigits: digits}));
    const faText = (value) => value === null || value === undefined || value === "" ? "—" : core.faDigits(String(value));
    const scoreMarkup = (value) => numeric(value) === null ? "—" : `<bdi dir="ltr">${escapeHtml(core.formatSigned(value, 1))}</bdi>`;
    const bubbleMarkup = (value) => numeric(value) === null ? "—" : `<bdi dir="ltr">${escapeHtml(core.formatSigned(value, 1))}٪</bdi>`;
    const historyBubbleMarkup = (value) => numeric(value) === null ? "—" : `<bdi dir="ltr">${escapeHtml(core.formatSigned(value, 2))}٪</bdi>`;
    const boardMarkup = (value) => numeric(value) === null ? "—" : `<bdi dir="ltr">${escapeHtml(core.formatSigned(value, 2))}</bdi>`;
    element.innerHTML = rows.map((row, index) => `<tr><td>${core.faDigits(index + 1)}</td><td><b>${escapeHtml(row.symbol || "—")}</b>${String(row.description || "").includes("اهرمی") ? ' <span class="fund-leveraged">🔥</span>' : ""}</td><td>${n(row.liquidity, 1)}</td><td>${faText(row.portfolio_last_update || row.report_date)}</td><td>${bubbleMarkup(row.bubble_pct)}</td><td>${historyBubbleMarkup(row.bubble_min_30d)}</td><td>${historyBubbleMarkup(row.bubble_max_30d)}</td><td>${scoreMarkup(row.portfolio_score)}</td><td>${boardMarkup(row.board_score)}</td><td>${scoreMarkup(row.score_diff)}</td></tr>`).join("") || `<tr><td colspan="10">گزارش صندوق‌ها هنوز آماده نیست.</td></tr>`;
  }

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
    renderQueueChart(data);
    renderChart(data);
    renderTables(data);
    renderIndustries(data);
    renderFundReport(data);
    renderOptions(options || data.options || emptyOptions());
  }

const LIVE_DATA_ORIGIN = "https://94-101-184-98.sslip.io/market/";
  function liveDataUrl(path, cacheMode = "no-store") {
    const url = new URL(path, LIVE_DATA_ORIGIN);
    if (cacheMode === "no-store") url.searchParams.set("ts", String(Date.now()));
    else url.searchParams.delete("ts");
    return url.href;
  }

  async function fetchJson(path, cacheMode = "no-store") {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(liveDataUrl(path, cacheMode), { cache: cacheMode, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw new Error("مهلت دریافت snapshot تمام شد.");
      if (error instanceof SyntaxError) throw new Error("فایل snapshot JSON نامعتبر است.");
      throw error;
    } finally { window.clearTimeout(timeout); }
  }

  async function fetchFundReportInBackground() {
    try {
      const funds = await fetchJson("data/funds.json", "default");
      if (currentData) { currentData.fund_report = funds; renderFundReport(currentData); }
    } catch (error) {
      console.warn("Fund report snapshot unavailable", error);
      if (currentData) renderFundReport(currentData);
    }
  }

  async function fetchOptionsInBackground() {
    try {
      const options = await fetchJson("data/options.json", "default");
      if (currentData) renderOptions(options);
    } catch (error) {
      console.warn("Options snapshot unavailable", error);
      renderOptions(emptyOptions());
    }
  }

  async function fetchComprehensiveInBackground() {
    try {
      const comprehensive = await fetchJson("data/comprehensive.json?cb=" + String(Date.now()), "no-store");
      if (currentData && typeof window.dispatchEvent === "function") {
        const detail = {...currentData, comprehensive_stocks: Array.isArray(comprehensive.rows) ? comprehensive.rows : [], comprehensive_meta: comprehensive.meta || {}};
        const event = typeof window.CustomEvent === "function" ? new window.CustomEvent("market:snapshot", {detail}) : null;
        if (event) window.dispatchEvent(event);
      }
    } catch (error) { console.warn("Comprehensive snapshot unavailable", error); }
  }

  async function loadData(showToast = false, force = false) {
    if (loading || (!force && currentData && Date.now() - lastLoadAt < 10000)) return;
    loading = true;
    if (!currentData) setStatus("در حال دریافت", "loading");
    try {
      // Critical path: render the 179KB market snapshot immediately. The heavy
      // options feed must never delay the first useful paint.
      const data = core.validateSnapshot(await fetchJson("data/market.json", "no-store"));
      render(data, emptyOptions());
      text("#sourceStatus", `منبع: ${currentData.source} · زمان منبع: ${core.formatDate(core.sourceTimestamp(currentData))}`);
      lastLoadAt = Date.now();
      // Keep the first useful paint isolated from large secondary feeds.
      // They are loaded only after the browser has had a chance to paint and
      // only on pages that actually render the corresponding surface.
      const loadSecondaryFeeds = () => {
        if (document.querySelector("#comprehensiveRows")) void fetchComprehensiveInBackground();
        if (document.querySelector("#fundReportRows")) void fetchFundReportInBackground();
        if (document.querySelector("#optionsPairs")) void fetchOptionsInBackground();
      };
      if ("requestIdleCallback" in window) window.requestIdleCallback(loadSecondaryFeeds, {timeout: 1200});
      else window.setTimeout(loadSecondaryFeeds, 150);
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

  let lastLoadAt = 0;
  const refreshButton = $("#refreshButton");
  if (refreshButton) refreshButton.addEventListener("click", () => loadData(true, true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadData(false);
  });
  window.addEventListener("pageshow", () => loadData(false));
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") loadData(false);
  }, REFRESH_MS);
  void refreshTimer;
  setupNavigation();
  loadData();
})();

if (navigator.userAgent.includes("MarketPulseAndroid")) document.documentElement.classList.add("native-market-webview");
