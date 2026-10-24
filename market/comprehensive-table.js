"use strict";

(() => {
  const table = document.querySelector("#comprehensiveTable");
  const body = document.querySelector("#comprehensiveRows");
  if (!table || !body) return;

  const columns = ["symbol", "industry", "score", "score_10d_total", "score_position_pct", "industry_score_position_pct", "avg_trade_value_toman", "last_close_diff_pct", "queue_value_toman", "buy_per_capita_toman", "buyer_power", "legal_buy_pct", "legal_sell_pct"];
  const filters = {};
  let rows = [];
  let defaultOrder = [];
  let sortKey = null;
  let sortDirection = "none";
  let lastRendered = [];
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  const esc = (value) => String(value == null ? "—" : value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = (value) => {
    if (value == null || value === "" || typeof value === "boolean") return null;
    const normalized = String(value).replace(/[۰-۹]/g, (d) => String(fa.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).replace(/[٬،,]/g, "").replace(/[٫]/g, ".").replace(/[٪%]/g, "").replace(/[−–]/g, "-").trim();
    const multiplier = /(?:b|bn|میلیارد|میلیون میلیارد|همت)/i.test(normalized) ? 1e9 : /(?:m|میلیون)/i.test(normalized) ? 1e6 : 1;
    const match = normalized.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    return match ? Number(match[0]) * multiplier : null;
  };
  const digits = (value) => String(value).replace(/[0-9]/g, (d) => fa[Number(d)]);
  const format = (value, digitsCount = 1) => {
    const parsed = num(value);
    return parsed == null ? "—" : digits(parsed.toLocaleString("fa-IR", {maximumFractionDigits: digitsCount, minimumFractionDigits: digitsCount}));
  };
  const formatBillion = (value) => { const parsed = num(value); return parsed == null ? "—" : digits(Math.round(parsed / 1e9).toLocaleString("fa-IR")); };
  const formatMillion = (value) => { const parsed = num(value); return parsed == null ? "—" : `${digits((parsed / 1e6).toLocaleString("fa-IR", {maximumFractionDigits: 1}))} میلیون`; };
  const signedPct = (value, fractionDigits) => { const parsed = num(value); return parsed == null ? "—" : `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${format(Math.abs(parsed), fractionDigits)}٪`; };
  const signedPctMarkup = (value, fractionDigits) => { const label = signedPct(value, fractionDigits); return label === "—" ? label : `<strong>${esc(label.slice(0, -1))}</strong> <span class="percent-unit">٪</span>`; };
  const signedScore = (value) => { const parsed = num(value); return parsed == null ? "—" : `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${format(Math.abs(parsed), 1)}`; };
  const cellValue = (row, key) => key === "symbol" ? String(row[key] || "") : num(row[key]);
  const positionPercent = (rank, total) => {
    const r = num(rank), t = num(total);
    return r == null || t == null || t <= 0 ? null : Math.ceil(r / t * 100);
  };
  const valueForKey = (row, key) => {
    if (key === "symbol" || key === "industry") return String(row[key] || "");
    if (key === "score_position_pct") return positionPercent(row.score_rank, row.score_rank_total);
    if (key === "industry_score_position_pct") return positionPercent(row.industry_score_rank, row.industry_score_rank_total);
    return num(row[key]);
  };

  function normalizeFilterValue(value) {
    return String(value || "").replace(/[۰-۹]/g, (d) => String(fa.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).trim().toLowerCase();
  }
  function parseFilter(operator, value, key) {
    const raw = normalizeFilterValue(value);
    if (!raw || !operator) return null;
    const unitMultiplier = key === "avg_trade_value_toman" || key === "queue_value_toman" ? 1e9 : key === "buy_per_capita_toman" ? 1e6 : 1;
    const parsed = num(raw);
    return {op: operator, value: parsed == null ? null : parsed * unitMultiplier};
  }
  function parseTextFilter(value) {
    const raw = normalizeFilterValue(value);
    return raw ? {op: "text", value: raw} : null;
  }
  function matches(row, key, parsed) {
    if (!parsed) return true;
    const value = valueForKey(row, key);
    if (parsed.op === "text") return String(value || "").toLowerCase().includes(parsed.value);
    if (value == null || parsed.value == null && parsed.op !== "range") return false;
    if (parsed.op === "range") return parsed.a != null && parsed.b != null && value >= Math.min(parsed.a, parsed.b) && value <= Math.max(parsed.a, parsed.b);
    if (parsed.op === ">") return value > parsed.value;
    if (parsed.op === ">=") return value >= parsed.value;
    if (parsed.op === "<") return value < parsed.value;
    if (parsed.op === "<=") return value <= parsed.value;
    return value === parsed.value;
  }
  function filteredRows() { return rows.filter((row) => columns.every((key) => { const state = filters[key] || {}; const conditions = Array.isArray(state.conditions) ? state.conditions : [{operator: state.operator, value: state.value}]; return conditions.every((condition) => matches(row, key, key === "symbol" || key === "industry" ? parseTextFilter(condition.value) : parseFilter(condition.operator, condition.value, key))); })); }
  function compare(a, b) {
    const av = valueForKey(a, sortKey), bv = valueForKey(b, sortKey);
    if (av == null && bv == null) return a._defaultIndex - b._defaultIndex;
    if (av == null) return 1;
    if (bv == null) return -1;
    const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "fa", {numeric: true});
    return (sortDirection === "asc" ? result : -result) || a._defaultIndex - b._defaultIndex;
  }
  function displayedRows() {
    const result = filteredRows();
    if (sortDirection !== "none") result.sort(compare);
    return result;
  }
  function metricCell(value, type, sortValue) {
    const label = type === "billion" ? formatBillion(value) : type === "million0" ? (num(value) == null ? "—" : digits(Math.round(num(value) / 1e6).toLocaleString("fa-IR"))) : type === "pct1" ? signedPctMarkup(value, 1) : type === "pct0" ? signedPctMarkup(value, 0) : type === "position" ? (num(value) == null ? "—" : `<strong>${digits(num(value))}</strong> <span class="percent-unit">٪</span>`) : type === "industry" ? (value || "—") : type === "score" ? signedScore(value) : format(value, type === "power" ? 1 : 1);
    return `<td data-sort-value="${sortValue == null ? "" : esc(sortValue)}"><bdi>${label.indexOf("<") >= 0 ? label : esc(label)}</bdi></td>`;
  }
  function render() {
    const display = displayedRows();
    lastRendered = display;
    body.innerHTML = display.map((row) => `<tr><td class="comprehensive-symbol"><a href="symbols/?symbol=${encodeURIComponent(row.symbol || "")}">${esc(row.symbol)}</a></td>${metricCell(row.industry, "industry", row.industry)}${metricCell(row.score, "score", row.score)}${metricCell(row.score_10d_total, "score", row.score_10d_total)}${metricCell(positionPercent(row.score_rank, row.score_rank_total), "position", positionPercent(row.score_rank, row.score_rank_total))}${metricCell(positionPercent(row.industry_score_rank, row.industry_score_rank_total), "position", positionPercent(row.industry_score_rank, row.industry_score_rank_total))}${metricCell(row.avg_trade_value_toman, "billion", row.avg_trade_value_toman)}${metricCell(row.last_close_diff_pct, "pct1", row.last_close_diff_pct)}${metricCell(row.queue_value_toman, "billion", row.queue_value_toman)}${metricCell(row.buy_per_capita_toman, "million0", row.buy_per_capita_toman)}${metricCell(row.buyer_power, "power", row.buyer_power)}${metricCell(row.legal_buy_pct, "pct0", row.legal_buy_pct)}${metricCell(row.legal_sell_pct, "pct0", row.legal_sell_pct)}</tr>`).join("") || `<tr><td colspan="13" class="comprehensive-empty">با این فیلتر داده‌ای پیدا نشد.</td></tr>`;
    const count = document.querySelector("#comprehensiveCount"); if (count) count.textContent = `${digits(display.length.toLocaleString("fa-IR"))} نماد از ${digits(rows.length.toLocaleString("fa-IR"))}`;
    table.querySelectorAll("thead tr:first-child th").forEach((header) => { const active = header.dataset.sortKey === sortKey && sortDirection !== "none"; header.setAttribute("aria-sort", active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"); header.dataset.sortState = active ? sortDirection : "none"; });
  }
  function sortBy(key) {
    if (sortKey !== key) { sortKey = key; sortDirection = "desc"; }
    else if (sortDirection === "desc") sortDirection = "asc";
    else { sortKey = null; sortDirection = "none"; }
    render();
  }
  function downloadXlsx() {
    const exportRows = lastRendered.map((row) => ({"نماد": row.symbol, "امتیاز": row.score, "مجموع امتیاز ۱۰ روز اخیر": row.score_10d_total, "میانگین ارزش (میلیارد تومان)": num(row.avg_trade_value_toman) == null ? null : num(row.avg_trade_value_toman) / 1e9, "اختلاف آخرین و پایانی (درصد)": row.last_close_diff_pct, "صف (میلیارد تومان)": num(row.queue_value_toman) == null ? null : num(row.queue_value_toman) / 1e9, "صنعت": row.industry, "سرانه خرید": num(row.buy_per_capita_toman) == null ? null : num(row.buy_per_capita_toman) / 1e6, "قدرت": row.buyer_power, "جایگاه بازار (درصد)": positionPercent(row.score_rank, row.score_rank_total), "جایگاه صنعت (درصد)": positionPercent(row.industry_score_rank, row.industry_score_rank_total), "خ حقوقی (درصد)": row.legal_buy_pct, "ف حقوقی (درصد)": row.legal_sell_pct}));
    if (!exportRows.length) return;
    if (window.XLSX) { const book = XLSX.utils.book_new(); const sheet = XLSX.utils.json_to_sheet(exportRows); XLSX.utils.book_append_sheet(book, sheet, "جدول جامع"); XLSX.writeFile(book, "جدول-جامع-بازار.xlsx"); return; }
    const headers = Object.keys(exportRows[0]); const html = `<html><meta charset="utf-8"><table><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${exportRows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`).join("")}</table></html>`; const blob = new Blob(["\ufeff", html], {type: "application/vnd.ms-excel"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "جدول-جامع-بازار.xls"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  table.querySelectorAll("thead tr:first-child th").forEach((header) => { header.tabIndex = 0; header.setAttribute("role", "button"); header.setAttribute("aria-sort", "none"); header.title = "کلیک: نزولی · دوباره: صعودی · سوم: پیش‌فرض"; header.addEventListener("click", () => sortBy(header.dataset.sortKey)); header.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sortBy(header.dataset.sortKey); } }); });
  const filterKeys = ["symbol", "industry", "score", "score_10d_total", "score_position_pct", "industry_score_position_pct", "avg_trade_value_toman", "last_close_diff_pct", "queue_value_toman", "buy_per_capita_toman", "buyer_power", "legal_buy_pct", "legal_sell_pct"];
  const filterText = new Set(["symbol", "industry"]);
  const filterRow = table.querySelector(".comprehensive-filter-row");
  if (filterRow) filterRow.innerHTML = filterKeys.map((key) => filterText.has(key) ? `<th><input class="column-filter" data-filter-key="${key}" type="search" placeholder="${key === "industry" ? "صنعت" : "نماد"}" aria-label="فیلتر ${key}"></th>` : `<th><span class="filter-pair" dir="ltr"><select class="filter-operator" data-filter-key="${key}" aria-label="عملگر فیلتر"><option value="">شرط</option><option value=">=">≥</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option><option value="=">=</option></select><input class="column-filter" data-filter-key="${key}" inputmode="decimal" placeholder="عدد" aria-label="عدد فیلتر"></span></th>`).join("");

  function addConditionControl(key, host) {
    const pair = document.createElement("span"); pair.className = "filter-pair extra-filter-pair"; pair.dir = "ltr";
    pair.innerHTML = `<select class="filter-operator" data-filter-key="${key}" aria-label="عملگر شرط دوم"><option value="">شرط</option><option value=">=">≥</option><option value=">">&gt;</option><option value="<=">≤</option><option value="<">&lt;</option><option value="=">=</option></select><input class="column-filter" data-filter-key="${key}" inputmode="decimal" placeholder="عدد" aria-label="عدد شرط دوم"><button type="button" class="remove-filter" aria-label="حذف شرط">×</button>`;
    host.appendChild(pair);
    pair.querySelector("input").addEventListener("input", syncFilters);
    pair.querySelector("select").addEventListener("change", syncFilters);
    pair.querySelector(".remove-filter").addEventListener("click", () => { pair.remove(); syncFilters(); });
  }
  function syncFilters() {
    table.querySelectorAll(".comprehensive-filter-row th").forEach((th) => { const key = th.dataset.filterKey; if (!key) return; filters[key] = {conditions: Array.from(th.querySelectorAll(".filter-pair")).map((pair) => { const select = pair.querySelector("select"); const input = pair.querySelector("input"); return {operator: select ? select.value : "", value: input ? input.value : ""}; })}; });
    render();
  }
  table.querySelectorAll(".comprehensive-filter-row th").forEach((th) => {
    const keyElement = th.querySelector("[data-filter-key]"); const key = keyElement ? keyElement.dataset.filterKey : ""; if (!key) return; th.dataset.filterKey = key;
    th.querySelectorAll(".column-filter,.filter-operator").forEach((control) => control.addEventListener(control.classList.contains("column-filter") ? "input" : "change", syncFilters));
    const add = document.createElement("button"); add.type = "button"; add.className = "add-filter"; add.textContent = "+ شرط"; add.setAttribute("aria-label", "اضافه کردن شرط"); add.addEventListener("click", () => addConditionControl(key, th)); th.appendChild(add);
  });
  const clearButton = document.querySelector("#clearComprehensiveFilters");
  if (clearButton) clearButton.addEventListener("click", () => { table.querySelectorAll(".column-filter").forEach((input) => { input.value = ""; }); table.querySelectorAll(".filter-operator").forEach((select) => { select.value = ""; }); table.querySelectorAll(".extra-filter-pair").forEach((pair) => pair.remove()); Object.keys(filters).forEach((key) => { filters[key] = {conditions: [{operator: "", value: ""}]}; }); render(); });
  const downloadButton = document.querySelector("#downloadComprehensiveXlsx");
  if (downloadButton) downloadButton.addEventListener("click", downloadXlsx);
  window.addEventListener("market:snapshot", (event) => { const detail = event && event.detail ? event.detail : {}; rows = Array.isArray(detail.comprehensive_stocks) ? detail.comprehensive_stocks : []; const ranked = rows.filter((row) => num(row.score) != null).sort((a, b) => num(b.score) - num(a.score) || String(a.symbol || "").localeCompare(String(b.symbol || ""), "fa")); const groups = new Map(); ranked.forEach((row, index) => { if (row.score_rank == null) row.score_rank = index + 1; if (row.score_rank_total == null) row.score_rank_total = ranked.length; const industry = String(row.industry || ""); if (industry) { if (!groups.has(industry)) groups.set(industry, []); groups.get(industry).push(row); } }); groups.forEach((members) => members.forEach((row, index) => { if (row.industry_score_rank == null) row.industry_score_rank = index + 1; if (row.industry_score_rank_total == null) row.industry_score_rank_total = members.length; })); defaultOrder = rows.slice(); rows.forEach((row, index) => { row._defaultIndex = index; }); const meta = detail.comprehensive_meta || {}; const coverage = document.querySelector("#comprehensiveCoverage"); if (coverage) coverage.textContent = `${digits((meta.days || []).length)} روز کامل · ${digits(meta.complete_symbol_count || 0)} نماد با پوشش کامل ${digits(meta.expected_samples || 0)} نمونه · نزدیک‌ترین نمونه در بازه ±۵ دقیقه پذیرفته شده است.`; render(); });
})();
