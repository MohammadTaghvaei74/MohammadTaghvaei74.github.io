"use strict";

const $ = (selector) => document.querySelector(selector);
const faDigits = (value) => String(value).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const number = (value, digits = 2) => faDigits(Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const integer = (value) => faDigits(Math.round(Number(value || 0)).toLocaleString("en-US"));
const csvCell = (value) => `"${String(value === null || value === undefined ? "" : value).replace(/"/g, '""')}"`;
let archive = null;
let selectedRows = [];

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}
function symbolRows(symbol) { return ((archive && archive.rows) || []).filter((row) => row.symbol === symbol).sort((a, b) => a.day.localeCompare(b.day)); }
function preferredSymbol() { return ["فولاد", "فملی", "خودرو", "شستا"].find((symbol) => archive.symbols.includes(symbol)) || archive.symbols[0]; }
function displayDay(day) { return faDigits(new Date(`${day}T12:00:00Z`).toLocaleDateString("fa-IR", { month: "short", day: "numeric" })); }
function displayFullDay(day) { return faDigits(new Date(`${day}T12:00:00Z`).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" })); }

function linePath(rows, key, x, y) { return rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(Number(row[key] || 0)).toFixed(1)}`).join(" "); }
function renderChart(rows) {
  const svg = $("#historyChart");
  const width = 900, height = 280, pad = { top: 15, right: 15, bottom: 34, left: 42 };
  const vals = rows.flatMap((row) => [Number(row.mean || 0), Number(row.median || 0), Number(row.last || 0)]);
  const min = Math.min(-5, ...vals) - .5, max = Math.max(5, ...vals) + .5;
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(rows.length - 1, 1);
  const y = (v) => pad.top + (max - v) * (height - pad.top - pad.bottom) / (max - min);
  const grid = [-5, 0, 5].map((tick) => `<line class="${tick === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end">${faDigits(tick)}</text>`).join("");
  const labels = rows.map((row, i) => `<text class="chart-label" x="${x(i)}" y="${height - 8}" text-anchor="middle">${displayDay(row.day)}</text>`).join("");
  svg.innerHTML = `${grid}${labels}<path class="history-line" d="${linePath(rows, "mean", x, y)}" stroke="#73c8ea"/><path class="history-line" d="${linePath(rows, "median", x, y)}" stroke="#c9f27c"/><path class="history-line" d="${linePath(rows, "last", x, y)}" stroke="#ff9e67" stroke-dasharray="5 5"/>`;
}

function renderTable(rows) {
  const review = rows.filter((row) => row.quality === "review").length;
  $("#rowQualityNote").textContent = `${faDigits(rows.length)} روز برای این نماد${review ? ` · ${faDigits(review)} مورد نیازمند بررسی` : " · همه در دامنه عادی"}`;
  $("#historyRows").innerHTML = rows.map((row) => `<tr><td>${displayFullDay(row.day)}</td><td>${integer(row.count)}</td><td class="score">${number(row.mean)}</td><td class="score">${number(row.median)}</td><td class="score low">${number(row.min)}</td><td class="score high">${number(row.max)}</td><td class="score">${number(row.last)}</td><td class="${row.quality === "review" ? "quality-review" : "quality-ok"}">${row.quality === "review" ? "نیازمند بررسی" : "معتبر"}</td></tr>`).join("") || `<tr><td colspan="8">برای این نماد داده‌ای پیدا نشد.</td></tr>`;
}
function renderSelected(symbol) {
  selectedRows = symbolRows(symbol);
  $("#selectedSymbol").textContent = symbol || "—";
  $("#selectedMeta").textContent = selectedRows.length ? `${faDigits(selectedRows.length)} روز داده · آخرین روز ${displayFullDay(selectedRows[selectedRows.length - 1].day)}` : "نماد در آرشیو پیدا نشد";
  $("#selectionStatus").textContent = selectedRows.length ? `${faDigits(selectedRows.length)} ردیف آماده دانلود است.` : "نماد دیگری را امتحان کن.";
  renderChart(selectedRows); renderTable(selectedRows);
  if (window.renderScoreCandles) window.renderScoreCandles(symbol);
}
function renderDays() {
  $("#daysCountLabel").textContent = `${faDigits(archive.valid_day_count)} روز`;
  $("#daysList").innerHTML = archive.valid_days.map((day) => `<div class="day-row"><b>${displayFullDay(day.day)}</b><span>✓ کامل</span></div>`).join("");
}
function renderArchive() {
  $("#validDayCount").textContent = faDigits(archive.valid_day_count);
  $("#symbolCount").textContent = integer(archive.symbols.length);
  $("#rowCount").textContent = integer(archive.row_count);
  $("#lastDay").textContent = displayFullDay(archive.generated_at);
  $("#generatedAt").textContent = `آخرین استخراج: ${displayFullDay(archive.generated_at)}`;
  $("#symbolInput").value = preferredSymbol();
  $("#symbolList").innerHTML = archive.symbols.map((symbol) => `<option value="${symbol}"></option>`).join("");
  renderDays(); renderSelected($("#symbolInput").value);
 }

function rowsForExport() { return selectedRows.map((row) => ({ "تاریخ": row.day, "نماد": row.symbol, "تعداد نمونه": row.count, "میانگین امتیاز": row.mean, "میانه امتیاز": row.median, "کمینه": row.min, "بیشینه": row.max, "آخرین امتیاز": row.last, "کیفیت": row.quality === "review" ? "review" : "valid" })); }
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function downloadCsv() { if (!selectedRows.length) return toast("برای این نماد داده‌ای وجود ندارد"); const headers = ["day","symbol","count","mean","median","min","max","last","quality"]; const lines = [headers.join(","), ...selectedRows.map((row) => [row.day,row.symbol,row.count,row.mean,row.median,row.min,row.max,row.last,row.quality].map(csvCell).join(","))]; downloadBlob(new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${selectedRows[0].symbol}-score-history.csv`); toast("فایل CSV آماده دانلود شد"); }
function downloadXlsx() { if (!selectedRows.length) return toast("برای این نماد داده‌ای وجود ندارد"); if (!window.XLSX) return toast("ماژول Excel هنوز بارگذاری نشده است؛ CSV را امتحان کن"); const book = XLSX.utils.book_new(); const sheet = XLSX.utils.json_to_sheet(rowsForExport()); sheet["!cols"] = [{ wch: 14 },{ wch: 16 },{ wch: 12 },{ wch: 16 },{ wch: 16 },{ wch: 14 },{ wch: 14 },{ wch: 16 },{ wch: 14 }]; XLSX.utils.book_append_sheet(book, sheet, "Score History"); XLSX.writeFile(book, `${selectedRows[0].symbol}-score-history.xlsx`); toast("فایل Excel آماده دانلود شد"); }
async function copyJson() { if (!selectedRows.length) return; try { await navigator.clipboard.writeText(JSON.stringify(selectedRows, null, 2)); toast("JSON تاریخچه کپی شد"); } catch (error) { toast("کپی در این مرورگر مجاز نیست"); } }

$("#symbolInput").addEventListener("input", (event) => { const value = event.target.value.trim(); if (archive.symbols.includes(value)) renderSelected(value); });
$("#symbolInput").addEventListener("change", (event) => renderSelected(event.target.value.trim()));
$("#clearSymbol").addEventListener("click", () => { $("#symbolInput").value = ""; renderSelected(""); $("#symbolInput").focus(); });
$("#downloadCsv").addEventListener("click", downloadCsv); $("#downloadXlsx").addEventListener("click", downloadXlsx); $("#copyJson").addEventListener("click", copyJson); $("#downloadAllXlsx").addEventListener("click", () => { window.location.href = "data/market-score-history.xlsx"; toast("فایل کامل آرشیو آماده دانلود شد"); });
fetch(`data/history.json?ts=${Date.now()}`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then((data) => { archive = data; renderArchive(); }).catch((error) => { console.error(error); $("#selectionStatus").textContent = "دریافت آرشیو انجام نشد."; toast("فایل آرشیو در دسترس نیست"); });
