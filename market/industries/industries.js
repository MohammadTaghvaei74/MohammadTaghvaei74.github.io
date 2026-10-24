(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IndustryExplorer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
  var AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  var SUMMARY_COLUMNS = [
    {key: "industry", label: "نام صنعت", type: "text"},
    {key: "stock_count", label: "تعداد سهام", type: "number"},
    {key: "median_score", label: "میانه امتیاز سهام", type: "score"},
    {key: "buy_queue_value_toman", label: "صف خرید میلیارد تومان", type: "billion"},
    {key: "sell_queue_value_toman", label: "صف فروش میلیارد تومان", type: "billion"},
    {key: "avg_last_pct", label: "میانگین درصد آخرین", type: "percent"},
    {key: "avg_close_pct", label: "میانگین درصد پایانی", type: "percent"},
    {key: "avg_last_close_diff_pct", label: "میانگین اختلاف آخرین و پایانی", type: "percent"},
    {key: "avg_buy_per_capita_toman", label: "میانگین سرانه خرید", type: "million"},
    {key: "avg_sell_per_capita_toman", label: "میانگین سرانه فروش میلیون", type: "million"},
    {key: "avg_power", label: "میانگین قدرت", type: "power"},
    {key: "trade_value_toman", label: "مجموع ارزش معاملات میلیارد تومان", type: "billion"},
    {key: "avg_trade_value_5d_toman", label: "میانگین ارزش معاملات ۵ روز میلیارد تومان", type: "billion"},
    {key: "avg_trade_value_10d_toman", label: "میانگین ارزش معاملات ۱۰ روز میلیارد تومان", type: "billion"},
    {key: "avg_trade_value_20d_toman", label: "میانگین ارزش معاملات ۲۰ روز میلیارد تومان", type: "billion"}
  ];
  var OPERATOR_OPTIONS = [
    {value: "", label: "—"},
    {value: "eq", label: "="},
    {value: "gt", label: ">"},
    {value: "gte", label: ">="},
    {value: "lt", label: "<"},
    {value: "lte", label: "<="}
  ];
  var TEXT_OPERATOR_OPTIONS = [
    {value: "", label: "—"},
    {value: "contains", label: "شامل"},
    {value: "eq", label: "="}
  ];

  function finite(value) {
    return value !== null && value !== undefined && value !== "" &&
      !(typeof value === "string" && value.trim() === "") &&
      typeof value !== "boolean" && typeof value !== "object" &&
      Number.isFinite(typeof value === "number" ? value : Number(value));
  }
  function number(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null;
    var normalized = String(value)
      .replace(/[۰-۹]/g, function (d) { return String(FA_DIGITS.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String(AR_DIGITS.indexOf(d)); })
      .replace(/[٬،,]/g, "")
      .replace(/[٫]/g, ".")
      .replace(/[٪%]/g, "")
      .replace(/[−–]/g, "-")
      .trim();
    var match = normalized.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (!match) return null;
    var parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function normalizeFa(value) {
    return String(value == null ? "" : value)
      .replace(/[\u064A\u0649]/g, "ی")
      .replace(/[\u0643]/g, "ک")
      .replace(/[\u200c\u200f\u0640]/g, "")
      .replace(/[\s\-–—_]+/g, "")
      .replace(/[ًٌٍَُِّْ]/g, "")
      .toLocaleLowerCase("fa-IR");
  }
  function mean(values) {
    var clean = values.filter(finite).map(Number);
    return clean.length ? clean.reduce(function (a, b) { return a + b; }, 0) / clean.length : null;
  }
  function median(values) {
    var clean = values.filter(finite).map(Number).sort(function (a, b) { return a - b; });
    if (!clean.length) return null;
    var middle = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
  }
  function total(values) {
    var clean = values.filter(finite).map(Number);
    return clean.length ? clean.reduce(function (a, b) { return a + b; }, 0) : null;
  }
  function closePercent(stock) {
    var explicit = number(stock.close_pct);
    if (explicit !== null) return explicit;
    var yesterday = number(stock.yesterday_price);
    var close = number(stock.close_price);
    return yesterday === null || yesterday === 0 || close === null ? null : (close - yesterday) / yesterday * 100;
  }
  function lastCloseDifference(stock) {
    var explicit = number(stock.last_close_diff_pct);
    if (explicit !== null) return explicit;
    var lastPercent = number(stock.last_pct);
    var closePercentValue = closePercent(stock);
    return lastPercent === null || closePercentValue === null ? null : lastPercent - closePercentValue;
  }
  function readStocks(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.stocks)) throw new Error("فیلد stocks در snapshot وجود ندارد.");
    return snapshot.stocks.filter(function (row) {
      return row && row.symbol && row.industry;
    }).map(function (row) {
      if (row.score !== null && row.score !== undefined && !finite(row.score)) {
        throw new Error("ردیف سهام دارای عدد نامعتبر است.");
      }
      return Object.assign({}, row, {score: number(row.score)});
    });
  }
  function fallbackSummary(name, stocks) {
    return {
      industry: name,
      stock_count: stocks.length,
      median_score: median(stocks.map(function (stock) { return stock.score; })),
      buy_queue_value_toman: total(stocks.map(function (stock) { return stock.buy_queue_value_toman; })),
      sell_queue_value_toman: total(stocks.map(function (stock) { return stock.sell_queue_value_toman; })),
      avg_last_pct: mean(stocks.map(function (stock) { return stock.last_pct; })),
      avg_close_pct: mean(stocks.map(closePercent)),
      avg_last_close_diff_pct: mean(stocks.map(lastCloseDifference)),
      avg_buy_per_capita_toman: mean(stocks.map(function (stock) { return stock.buy_per_capita_toman; })),
      avg_sell_per_capita_toman: mean(stocks.map(function (stock) { return stock.sell_per_capita_toman; })),
      avg_power: mean(stocks.map(function (stock) { return stock.buyer_power; })),
      trade_value_toman: total(stocks.map(function (stock) { return stock.trade_value_toman; })),
      avg_trade_value_5d_toman: null,
      avg_trade_value_10d_toman: null,
      avg_trade_value_20d_toman: null
    };
  }
  function buildIndustries(snapshot) {
    var groups = new Map();
    readStocks(snapshot).forEach(function (stock) {
      if (/^اوراق(?:\s|‌)/.test(String(stock.industry || "").trim())) return;
      var key = normalizeFa(stock.industry);
      if (!groups.has(key)) groups.set(key, {name: String(stock.industry), stocks: []});
      groups.get(key).stocks.push(stock);
    });
    var provided = snapshot && Array.isArray(snapshot.industry_table) ? snapshot.industry_table : [];
    provided.forEach(function (row) {
      if (!row || !row.industry) return;
      if (/^اوراق(?:\s|‌)/.test(String(row.industry).trim())) return;
      var key = normalizeFa(row.industry);
      if (!groups.has(key)) groups.set(key, {name: String(row.industry), stocks: []});
      groups.get(key).summary = row;
    });
    var result = Array.from(groups.values()).map(function (group) {
      group.stocks.sort(function (a, b) {
        return (b.score === null ? -Infinity : b.score) - (a.score === null ? -Infinity : a.score) ||
          String(a.symbol).localeCompare(String(b.symbol), "fa");
      });
      group.summary = Object.assign(fallbackSummary(group.name, group.stocks), group.summary || {});
      group.count = number(group.summary.stock_count) === null ? group.stocks.length : number(group.summary.stock_count);
      group.score = number(group.summary.median_score);
      group.best = group.stocks[0] || null;
      return group;
    }).sort(function (a, b) {
      if (a.score === null && b.score !== null) return 1;
      if (b.score === null && a.score !== null) return -1;
      return (b.score === null ? 0 : b.score) - (a.score === null ? 0 : a.score) ||
        normalizeFa(a.name).localeCompare(normalizeFa(b.name), "fa");
    });
    result.forEach(function (group, index) { group.rank = index + 1; });
    return result;
  }
  function filterIndustries(groups, query) {
    var normalized = normalizeFa(query);
    if (!normalized) return groups.slice();
    return groups.filter(function (group) {
      return normalizeFa(group.name).indexOf(normalized) >= 0 || group.stocks.some(function (stock) {
        return normalizeFa(stock.symbol).indexOf(normalized) >= 0;
      });
    });
  }
  function searchSelection(groups, query, fallback) {
    var visible = filterIndustries(groups, query);
    return {visible: visible, selected: visible.indexOf(fallback) >= 0 ? fallback : visible[0] || null};
  }
  function sortStocks(stocks, direction) {
    return stocks.slice().sort(function (a, b) {
      var av = a.score === null ? -Infinity : a.score;
      var bv = b.score === null ? -Infinity : b.score;
      return (direction === "asc" ? av - bv : bv - av) || String(a.symbol).localeCompare(String(b.symbol), "fa");
    });
  }
  function parseComparison(operator, rawValue) {
    var value = number(rawValue);
    if (!operator || value === null) return null;
    return {operator: operator, value: value};
  }
  function filterScale(column) {
    return column.type === "billion" ? 1e9 : column.type === "million" ? 1e6 : 1;
  }
  function summaryValue(group, key) {
    if (key === "industry") return group.name;
    if (key === "stock_count") return group.count;
    var column = SUMMARY_COLUMNS.find(function (item) { return item.key === key; });
    var value = number(group.summary[key]);
    return value === null ? null : value / filterScale(column || {type: "number"});
  }
  function matchesComparison(value, comparison) {
    if (!comparison || value === null) return !comparison;
    if (comparison.operator === "eq") return value === comparison.value;
    if (comparison.operator === "gt") return value > comparison.value;
    if (comparison.operator === "gte") return value >= comparison.value;
    if (comparison.operator === "lt") return value < comparison.value;
    if (comparison.operator === "lte") return value <= comparison.value;
    return true;
  }
  function filterSummary(groups, filters) {
    return groups.filter(function (group) {
      return SUMMARY_COLUMNS.every(function (column) {
        var filter = filters[column.key];
        if (!filter || !filter.operator || filter.value === "") return true;
        if (column.type === "text") {
          var text = normalizeFa(filter.value);
          return filter.operator === "eq" ? normalizeFa(group.name) === text : normalizeFa(group.name).indexOf(text) >= 0;
        }
        return matchesComparison(summaryValue(group, column.key), parseComparison(filter.operator, filter.value));
      });
    });
  }
  function faDigits(value) {
    return String(value).replace(/[0-9]/g, function (digit) { return FA_DIGITS[Number(digit)]; });
  }
  function formatNumber(value, decimals) {
    var parsed = number(value);
    return parsed === null ? "—" : faDigits(parsed.toLocaleString("fa-IR", {
      maximumFractionDigits: decimals == null ? 2 : decimals,
      minimumFractionDigits: decimals == null ? 0 : decimals
    }));
  }
  function formatBillion(value) {
    var parsed = number(value);
    return parsed === null ? "—" : faDigits(Math.round(parsed / 1e9).toLocaleString("fa-IR"));
  }
  function formatMillion(value) {
    var parsed = number(value);
    return parsed === null ? "—" : faDigits(Math.round(parsed / 1e6).toLocaleString("fa-IR"));
  }
  function formatMillionBare(value) {
    var parsed = number(value);
    return parsed === null ? "—" : formatNumber(parsed / 1e6, 1);
  }
  function signedPercent(value) {
    var parsed = number(value);
    return parsed === null ? "—" : (parsed > 0 ? "+" : parsed < 0 ? "−" : "") + formatNumber(Math.abs(parsed), 2) + "٪";
  }
  function signedPercentOne(value) {
    var parsed = number(value);
    return parsed === null ? "—" : (parsed > 0 ? "+" : parsed < 0 ? "−" : "") + formatNumber(Math.abs(parsed), 1) + "٪";
  }
  function percentMarkup(value, digits) {
    var label = digits === 1 ? signedPercentOne(value) : signedPercent(value);
    return label === "—" ? label : "<strong>" + escapeHtml(label.slice(0, -1)) + "</strong> <span class=\"percent-unit\">٪</span>";
  }
  function signedScore(value) {
    var parsed = number(value);
    return parsed === null ? "—" : (parsed > 0 ? "+" : parsed < 0 ? "−" : "") + formatNumber(Math.abs(parsed), 2);
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[character];
    });
  }
  function sourceState(timestamp, now, maxAge, error) {
    if (error) return {kind: "error", label: "خطا در دریافت؛ آخرین داده حفظ شده"};
    if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return {kind: "error", label: "زمان منبع نامعتبر است"};
    return now - new Date(timestamp).getTime() > maxAge ? {kind: "stale", label: "داده قدیمی است"} : {kind: "fresh", label: "داده تازه"};
  }
  return {
    finite: finite, num: number, normalizeFa: normalizeFa, readStocks: readStocks,
    median: median, buildIndustries: buildIndustries, filterIndustries: filterIndustries,
    searchSelection: searchSelection, sortStocks: sortStocks, parseComparison: parseComparison,
    filterSummary: filterSummary, formatNumber: formatNumber, formatBillion: formatBillion,
    formatMillion: formatMillion, formatMillionBare: formatMillionBare, formatToman: function (value) { return number(value) === null ? "—" : formatBillion(value) + " میلیارد"; },
    signedPct: signedPercent, signedPct1: signedPercentOne, signedScore: signedScore,
    summaryColumns: SUMMARY_COLUMNS, operatorOptions: OPERATOR_OPTIONS,
    textOperatorOptions: TEXT_OPERATOR_OPTIONS,
    escapeHtml: escapeHtml, sourceState: sourceState
  };
});

if (typeof window !== "undefined") {
  (function () {
    var E = window.IndustryExplorer;
    var SUMMARY_COLUMNS = E.summaryColumns;
    var OPERATOR_OPTIONS = E.operatorOptions;
    var TEXT_OPERATOR_OPTIONS = E.textOperatorOptions;
    var state = {
      groups: [], visible: [], selected: null, direction: "desc", last: null, error: null,
      summaryKey: null, summaryDirection: "none", filters: {}
    };
    var $ = function (id) { return document.getElementById(id); };
    var text = function (element, value) { if (element) element.textContent = value; };
    SUMMARY_COLUMNS.forEach(function (column) { state.filters[column.key] = {operator: "", value: ""}; });

    function timeoutFetch(url, milliseconds) {
      return Promise.race([fetch(url), new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error("timeout")); }, milliseconds);
      })]);
    }
    function updateStatus(snapshot, error, loading) {
      var status = E.sourceState(snapshot && (snapshot.market && snapshot.market.timestamp || snapshot.generated_at), Date.now(), 60000, error);
      if (loading) status = {kind: "loading", label: "در حال دریافت داده…"};
      var element = $("sourceStatus");
      text(element, status.label + (snapshot && (snapshot.market && snapshot.market.timestamp || snapshot.generated_at) ? " · " + new Date(snapshot.market && snapshot.market.timestamp || snapshot.generated_at).toLocaleString("fa-IR") : ""));
      if (element) element.dataset.state = status.kind;
    }
    function operatorOptions(column) {
      var options = column.type === "text" ? TEXT_OPERATOR_OPTIONS : OPERATOR_OPTIONS;
      return options.map(function (option) { return "<option value=\"" + option.value + "\">" + option.label + "</option>"; }).join("");
    }
    function renderFilterRow() {
      var row = $("industrySummaryFilters");
      if (!row) return;
      row.innerHTML = SUMMARY_COLUMNS.map(function (column) {
        var placeholder = column.type === "text" ? "نام" : "عدد";
        return "<th><div class=\"industry-filter-control\"><select class=\"industry-filter-op\" data-filter-key=\"" + column.key + "\" aria-label=\"عملگر " + E.escapeHtml(column.label) + "\">" + operatorOptions(column) + "</select><input class=\"industry-filter-value\" data-filter-key=\"" + column.key + "\" type=\"text\" inputmode=\"decimal\" placeholder=\"" + placeholder + "\" aria-label=\"مقدار " + E.escapeHtml(column.label) + "\"></div></th>";
      }).join("");
      row.querySelectorAll(".industry-filter-op, .industry-filter-value").forEach(function (control) {
        control.addEventListener("input", updateFilters);
        control.addEventListener("change", updateFilters);
      });
    }
    function renderIndustryChoiceFilter() {
      var select = $("industrySelectFilter");
      if (!select) return;
      var selected = select.value;
      var names = state.groups.map(function (group) { return group.name; }).sort(function (a, b) { return a.localeCompare(b, "fa"); });
      select.innerHTML = "<option value=\"\">همه صنایع</option>" + names.map(function (name) { return "<option value=\"" + E.escapeHtml(name) + "\">" + E.escapeHtml(name) + "</option>"; }).join("");
      select.value = names.indexOf(selected) >= 0 ? selected : "";
    }
    function updateFilters(event) {
      var key = event.target.getAttribute("data-filter-key");
      var row = event.target.closest(".industry-filter-control");
      if (!key || !row) return;
      state.filters[key] = {
        operator: row.querySelector(".industry-filter-op").value,
        value: row.querySelector(".industry-filter-value").value
      };
      applyVisible();
    }
    function clearFilters() {
      SUMMARY_COLUMNS.forEach(function (column) { state.filters[column.key] = {operator: "", value: ""}; });
      var row = $("industrySummaryFilters");
      if (row) row.querySelectorAll("select, input").forEach(function (control) { control.value = ""; });
      applyVisible();
    }
    function metricCell(group, key, type) {
      var value = group.summary[key];
      var label = type === "billion" ? E.formatBillion(value) : type === "million" ? E.formatMillion(value) : type === "millionBare" ? E.formatMillionBare(value) : type === "percent" ? percentMarkup(value, 0) : type === "percent1" ? percentMarkup(value, 1) : type === "score" ? E.formatNumber(value, 1) : E.formatNumber(value, type === "power" ? 1 : 0);
      return "<td data-sort-value=\"" + (E.finite(value) ? E.escapeHtml(value) : "") + "\"><bdi>" + (label.indexOf("<") >= 0 ? label : E.escapeHtml(label)) + "</bdi></td>";
    }
    function summaryRows() {
      var result = state.visible.slice();
      if (state.summaryDirection !== "none") {
        result.sort(function (left, right) {
          var leftValue = state.summaryKey === "industry" ? left.name : E.finite(summaryValue(left, state.summaryKey)) ? summaryValue(left, state.summaryKey) : null;
          var rightValue = state.summaryKey === "industry" ? right.name : E.finite(summaryValue(right, state.summaryKey)) ? summaryValue(right, state.summaryKey) : null;
          if (leftValue === null && rightValue !== null) return 1;
          if (rightValue === null && leftValue !== null) return -1;
          if (leftValue === null && rightValue === null) return left.rank - right.rank;
          var comparison = typeof leftValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue), "fa", {numeric: true});
          return (state.summaryDirection === "desc" ? -comparison : comparison) || left.rank - right.rank;
        });
      }
      return result;
    }
    function summaryValue(group, key) {
      if (key === "industry") return group.name;
      if (key === "stock_count") return group.count;
      var column = SUMMARY_COLUMNS.find(function (item) { return item.key === key; });
      var value = E.num(group.summary[key]);
      return value === null ? null : value / (column && column.type === "billion" ? 1e9 : column && column.type === "million" ? 1e6 : 1);
    }
    function renderSummary() {
      var body = $("industrySummaryRows");
      if (!body) return;
      var rows = summaryRows();
      body.innerHTML = rows.length ? rows.map(function (group) {
        var name = E.escapeHtml(group.name);
        return "<tr><th scope=\"row\" class=\"industry-summary-name\"><a href=\"#selectedIndustry\" data-industry-link=\"" + name + "\">" + name + "</a></th><td>" + E.formatNumber(group.count, 0) + "</td>" +
          metricCell(group, "median_score", "score") + metricCell(group, "buy_queue_value_toman", "billion") + metricCell(group, "sell_queue_value_toman", "billion") +
          metricCell(group, "avg_last_pct", "percent") + metricCell(group, "avg_close_pct", "percent") + metricCell(group, "avg_last_close_diff_pct", "percent1") +
          metricCell(group, "avg_buy_per_capita_toman", "millionBare") + metricCell(group, "avg_sell_per_capita_toman", "million") + metricCell(group, "avg_power", "power") +
          metricCell(group, "trade_value_toman", "billion") + metricCell(group, "avg_trade_value_5d_toman", "billion") + metricCell(group, "avg_trade_value_10d_toman", "billion") + metricCell(group, "avg_trade_value_20d_toman", "billion") + "</tr>";
      }).join("") : "<tr><td colspan=\"15\" class=\"empty\">برای این فیلتر داده‌ای پیدا نشد.</td></tr>";
      body.querySelectorAll("[data-industry-link]").forEach(function (link) {
        link.addEventListener("click", function () { selectIndustry(link.getAttribute("data-industry-link"), true); });
      });
      var table = $("industrySummaryTable");
      if (table) table.querySelectorAll("[data-summary-sort]").forEach(function (header) {
        var active = header.getAttribute("data-summary-sort") === state.summaryKey && state.summaryDirection !== "none";
        header.setAttribute("aria-sort", active ? state.summaryDirection === "asc" ? "ascending" : "descending" : "none");
      });
    }
    function renderCards() {
      var host = $("industryCards");
      if (!host) return;
      host.innerHTML = state.visible.map(function (group) {
        return "<button class=\"industry-card " + (state.selected && state.selected.name === group.name ? "selected" : "") + "\" type=\"button\" data-industry=\"" + E.escapeHtml(group.name) + "\" aria-pressed=\"" + (state.selected && state.selected.name === group.name) + "\"><span class=\"card-rank\">رتبه " + E.formatNumber(group.rank, 0) + "</span><strong>" + E.escapeHtml(group.name) + "</strong><span class=\"card-score\">" + E.formatNumber(group.score, 1) + "</span><span class=\"card-meta\">" + E.formatNumber(group.count, 0) + " نماد</span></button>";
      }).join("") || "<div class=\"empty\">برای این جست‌وجو صنعتی پیدا نشد.</div>";
      host.querySelectorAll("[data-industry]").forEach(function (button) {
        button.addEventListener("click", function () { selectIndustry(button.getAttribute("data-industry"), true); });
      });
    }
    function renderStockTable() {
      var group = state.selected;
      var body = $("stockRows");
      if (!body) return;
      if (!group) { body.innerHTML = ""; return; }
      text($("selectedIndustry"), group.name);
      text($("industryCaption"), "میانه امتیاز " + E.formatNumber(group.score, 1) + " · " + E.formatNumber(group.count, 0) + " نماد");
      var rows = E.sortStocks(group.stocks, state.direction);
      body.innerHTML = rows.length ? rows.map(function (stock, index) {
        return "<tr><td>" + E.formatNumber(index + 1, 0) + "</td><th scope=\"row\"><a class=\"stock-symbol-link\" href=\"../symbols/?symbol=" + encodeURIComponent(stock.symbol) + "\">" + E.escapeHtml(stock.symbol) + "</a></th><td>" + E.formatNumber(stock.score, 1) + "</td><td class=\"" + (E.finite(stock.last_pct) && stock.last_pct >= 0 ? "up" : "down") + "\">" + percentMarkup(stock.last_pct, 0) + "</td><td>" + (E.finite(stock.trade_value_toman) ? E.formatBillion(stock.trade_value_toman) + " میلیارد" : "—") + "</td></tr>";
      }).join("") : "<tr><td colspan=\"5\" class=\"empty\">جزئیات سهام این صنعت در منبع فعلی موجود نیست.</td></tr>";
    }
    function render() {
      renderSummary(); renderCards(); renderStockTable();
      text($("resultCount"), E.formatNumber(state.visible.length, 0) + " صنعت");
    }
    function applyVisible() {
      var search = $("search");
      var choice = $("industrySelectFilter");
      var choiceText = $("industryTextFilter");
      var searched = E.filterIndustries(state.groups, choiceText && choiceText.value ? choiceText.value : search ? search.value : "");
      if (choice && choice.value) searched = searched.filter(function (group) { return group.name === choice.value; });
      state.visible = E.filterSummary(searched, state.filters);
      if (!state.selected || state.visible.indexOf(state.selected) < 0) state.selected = state.visible[0] || null;
      render();
    }
    function selectIndustry(name, scroll) {
      var group = state.groups.find(function (item) { return item.name === name; });
      if (!group) return;
      state.selected = group; render();
      if (scroll) {
        var detail = $("selectedIndustry");
        if (detail && detail.scrollIntoView) detail.scrollIntoView({behavior: "smooth", block: "start"});
      }
    }
    function load() {
      updateStatus(state.last, state.error, true);
      return timeoutFetch("../data/market.json", 10000).then(function (response) {
        if (!response.ok) throw new Error("http");
        return response.json();
      }).then(function (data) {
        state.last = data; state.error = null; state.groups = E.buildIndustries(data); renderIndustryChoiceFilter(); applyVisible(); updateStatus(data, null, false);
      }).catch(function (error) {
        state.error = error; updateStatus(state.last, error, false);
        if (!state.last) { state.groups = []; state.visible = []; state.selected = null; render(); }
      });
    }
    function setupSort() {
      var table = $("industrySummaryTable");
      if (!table) return;
      table.querySelectorAll("[data-summary-sort]").forEach(function (header) {
        header.tabIndex = 0; header.setAttribute("role", "button"); header.setAttribute("aria-sort", "none");
        header.title = "کلیک اول صعودی · کلیک دوم نزولی · کلیک سوم پیش‌فرض";
        function toggle() {
          var key = header.getAttribute("data-summary-sort");
          if (state.summaryKey !== key) { state.summaryKey = key; state.summaryDirection = "asc"; }
          else if (state.summaryDirection === "asc") state.summaryDirection = "desc";
          else { state.summaryKey = null; state.summaryDirection = "none"; }
          renderSummary();
        }
        header.addEventListener("click", toggle);
        header.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
      });
    }
    document.addEventListener("DOMContentLoaded", function () {
      renderFilterRow(); setupSort();
      var sort = $("sort"); if (sort) sort.addEventListener("change", function () { state.direction = sort.value; renderStockTable(); });
      var refresh = $("refresh"); if (refresh) refresh.addEventListener("click", load);
      var clear = $("clearIndustryFilters"); if (clear) clear.addEventListener("click", clearFilters);
      var search = $("search"); if (search) search.addEventListener("input", applyVisible);
      var choice = $("industrySelectFilter"); if (choice) choice.addEventListener("change", applyVisible);
      var choiceText = $("industryTextFilter"); if (choiceText) choiceText.addEventListener("input", applyVisible);
      load(); setInterval(load, 60000);
    });
    window.IndustryExplorerSelect = selectIndustry;
  })();
}
