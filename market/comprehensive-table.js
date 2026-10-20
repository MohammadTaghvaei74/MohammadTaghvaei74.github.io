"use strict";

(() => {
  const table = document.querySelector("#comprehensiveTable");
  const body = document.querySelector("#comprehensiveRows");
  if (!table || !body) return;

  const columns = ["symbol", "score", "score_10d_total", "avg_trade_value_toman", "last_close_diff_pct", "queue_value_toman", "buy_per_capita_toman", "buyer_power", "legal_buy_pct", "legal_sell_pct"];
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
  const formatBillion = (value) => { const parsed = num(value); return parsed == null ? "—" : `${digits((parsed / 1e9).toLocaleString("fa-IR", {maximumFractionDigits: 1}))} میلیارد`; };
  const formatMillion = (value) => { const parsed = num(value); return parsed == null ? "—" : `${digits((parsed / 1e6).toLocaleString("fa-IR", {maximumFractionDigits: 1}))} میلیون`; };
  const signedPct = (value) => { const parsed = num(value); return parsed == null ? "—" : `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${format(Math.abs(parsed), 2)}٪`; };
  const signedScore = (value) => { const parsed = num(value); return parsed == null ? "—" : `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${format(Math.abs(parsed), 2)}`; };
  const cellValue = (row, key) => key === "symbol" ? String(row[key] || "") : num(row[key]);

  function parseFilter(value) {
    const raw = String(value || "").replace(/[۰-۹]/g, (d) => String(fa.indexOf(d))).replace(/[٠-٩]/g, (d) => String(ar.indexOf(d))).trim().toLowerCase();
    if (!raw) return null;
    const range = raw.match(/^\s*([+-]?[\d.]+)\s*(?:\.\.|-|تا)\s*([+-]?[\d.]+)\s*$/);
    if (range) return {op: "range", a: num(range[1]), b: num(range[2])};
    const comparison = raw.match(/^\s*(>=|<=|>|<|=)?\s*([+-]?[\d.]+)\s*(b|bn|m|میلیارد|میلیون|همت)?\s*$/);
    if (comparison) return {op: comparison[1] || "=", value: num(`${comparison[2]}${comparison[3] || ""}`)};
    return {op: "text", value: raw};
  }
  function matches(row, key, parsed) {
    if (!parsed) return true;
    const value = cellValue(row, key);
    if (parsed.op === "text") return String(value || "").toLowerCase().includes(parsed.value);
    if (value == null || parsed.value == null && parsed.op !== "range") return false;
    if (parsed.op === "range") return parsed.a != null && parsed.b != null && value >= Math.min(parsed.a, parsed.b) && value <= Math.max(parsed.a, parsed.b);
    if (parsed.op === ">") return value > parsed.value;
    if (parsed.op === ">=") return value >= parsed.value;
    if (parsed.op === "<") return value < parsed.value;
    if (parsed.op === "<=") return value <= parsed.value;
    return value === parsed.value;
  }
  function filteredRows() { return rows.filter((row) => columns.every((key) => matches(row, key, parseFilter(filters[key])))); }
  function compare(a, b) {
    const av = cellValue(a, sortKey), bv = cellValue(b, sortKey);
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
    const label = type === "billion" ? formatBillion(value) : type === "million" ? formatMillion(value) : type === "pct" ? signedPct(value) : type === "score" ? signedScore(value) : format(value, type === "power" ? 2 : 1);
    return `<td data-sort-value="${sortValue == null ? "" : esc(sortValue)}"><bdi>${esc(label)}</bdi></td>`;
  }
  function render() {
    const display = displayedRows();
    lastRendered = display;
    body.innerHTML = display.map((row) => `<tr><td class="comprehensive-symbol"><a href="symbols/?symbol=${encodeURIComponent(row.symbol || "")}">${esc(row.symbol)}</a></td>${metricCell(row.score, "score", row.score)}${metricCell(row.score_10d_total, "score", row.score_10d_total)}${metricCell(row.avg_trade_value_toman, "billion", row.avg_trade_value_toman)}${metricCell(row.last_close_diff_pct, "pct", row.last_close_diff_pct)}${metricCell(row.queue_value_toman, "billion", row.queue_value_toman)}${metricCell(row.buy_per_capita_toman, "million", row.buy_per_capita_toman)}${metricCell(row.buyer_power, "power", row.buyer_power)}${metricCell(row.legal_buy_pct, "pct", row.legal_buy_pct)}${metricCell(row.legal_sell_pct, "pct", row.legal_sell_pct)}</tr>`).join("") || `<tr><td colspan="10" class="comprehensive-empty">با این فیلتر داده‌ای پیدا نشد.</td></tr>`;
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
    const exportRows = lastRendered.map((row) => ({"نماد": row.symbol, "امتیاز": row.score, "مجموع امتیاز ۱۰ روز اخیر": row.score_10d_total, "میانگین ارزش (میلیارد تومان)": num(row.avg_trade_value_toman) == null ? null : num(row.avg_trade_value_toman) / 1e9, "اختلاف آخرین و پایانی (درصد)": row.last_close_diff_pct, "صف (میلیارد تومان)": num(row.queue_value_toman) == null ? null : num(row.queue_value_toman) / 1e9, "سرانه خرید (میلیون تومان)": num(row.buy_per_capita_toman) == null ? null : num(row.buy_per_capita_toman) / 1e6, "قدرت": row.buyer_power, "خ حقوقی (درصد)": row.legal_buy_pct, "ف حقوقی (درصد)": row.legal_sell_pct}));
    if (!exportRows.length) return;
    if (window.XLSX) { const book = XLSX.utils.book_new(); const sheet = XLSX.utils.json_to_sheet(exportRows); XLSX.utils.book_append_sheet(book, sheet, "جدول جامع"); XLSX.writeFile(book, "جدول-جامع-بازار.xlsx"); return; }
    const headers = Object.keys(exportRows[0]); const html = `<html><meta charset="utf-8"><table><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${exportRows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join("")}</tr>`).join("")}</table></html>`; const blob = new Blob(["\ufeff", html], {type: "application/vnd.ms-excel"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "جدول-جامع-بازار.xls"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  table.querySelectorAll("thead tr:first-child th").forEach((header) => { header.tabIndex = 0; header.setAttribute("role", "button"); header.setAttribute("aria-sort", "none"); header.title = "کلیک: نزولی · دوباره: صعودی · سوم: پیش‌فرض"; header.addEventListener("click", () => sortBy(header.dataset.sortKey)); header.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sortBy(header.dataset.sortKey); } }); });
  table.querySelectorAll(".column-filter").forEach((input) => input.addEventListener("input", () => { filters[input.dataset.filterKey] = input.value; render(); }));
  const clearButton = document.querySelector("#clearComprehensiveFilters");
  if (clearButton) clearButton.addEventListener("click", () => { table.querySelectorAll(".column-filter").forEach((input) => { input.value = ""; filters[input.dataset.filterKey] = ""; }); render(); });
  const downloadButton = document.querySelector("#downloadComprehensiveXlsx");
  if (downloadButton) downloadButton.addEventListener("click", downloadXlsx);
  window.addEventListener("market:snapshot", (event) => { const detail = event && event.detail ? event.detail : {}; rows = Array.isArray(detail.comprehensive_stocks) ? detail.comprehensive_stocks : []; defaultOrder = rows.slice(); rows.forEach((row, index) => { row._defaultIndex = index; }); const meta = detail.comprehensive_meta || {}; const coverage = document.querySelector("#comprehensiveCoverage"); if (coverage) coverage.textContent = `${digits((meta.days || []).length)} روز کامل · ${digits(meta.complete_symbol_count || 0)} نماد با پوشش کامل ${digits(meta.expected_samples || 0)} نمونه · نزدیک‌ترین نمونه در بازه ±۵ دقیقه پذیرفته شده است.`; render(); });
})();
