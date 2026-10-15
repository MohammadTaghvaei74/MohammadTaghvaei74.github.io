"use strict";

const $ = (selector) => document.querySelector(selector);
const faDigits = (value) => String(value).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
const num = (value, digits = 1) => {
  const n = Number(value || 0);
  return faDigits(n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
};
const integer = (value) => faDigits(Math.round(Number(value || 0)).toLocaleString("en-US"));
const signed = (value, digits = 1) => {
  const n = Number(value || 0);
  return `${n > 0 ? "+" : ""}${num(n, digits)}`;
};
const pct = (value) => `${Number(value || 0) > 0 ? "+" : ""}${num(value, 2)}٪`;
const hmt = (value) => num(Number(value || 0), 2);

let currentData = null;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${faDigits(date.toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" }))} · ${faDigits(date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }))}`;
}

function scoreClass(value) { return Number(value) >= 0 ? "high" : "low"; }
function queueMarkup(row) {
  const buy = Number(row.buy_queue_value_toman || 0);
  const sell = Number(row.sell_queue_value_toman || 0);
  if (buy > 0) return `<span class="queue-buy">+${hmt(buy / 1e12)} همت</span>`;
  if (sell > 0) return `<span class="queue-sell">−${hmt(sell / 1e12)} همت</span>`;
  return `<span class="pct">—</span>`;
}

function renderMetrics(data) {
  const market = data.market || {};
  const leaders = (data.groups || []).find((g) => String(g.group_name).includes("لیدر")) || {};
  const median = Number(market.median || 0);
  const buy = Number(market.buy_value_hmt || 0);
  const sell = Number(market.sell_value_hmt || 0);
  $("#marketMedian").textContent = signed(median);
  $("#buyValue").textContent = hmt(buy);
  $("#sellValue").textContent = hmt(sell);
  $("#tradedCount").textContent = integer(market.count);
  $("#signalMarket").textContent = signed(median);
  $("#signalLeaders").textContent = signed(leaders.median);
  $("#signalNet").textContent = signed(buy - sell, 2);
  $("#updatedAt").textContent = formatDate(data.generated_at);
  const mood = median > 2 ? "مثبت و پرقدرت" : median > 0 ? "مثبت اما متعادل" : median < -2 ? "فشار عرضه" : "خنثی / نوسانی";
  $("#marketMood").textContent = mood;
  $("#marketTrend").textContent = median >= 0 ? "بالای صفر" : "زیر صفر";
  const gap = median - Number(leaders.median || 0);
  const allocation = gap > 1 ? "تمایل به سهام هم‌وزن" : gap < -1 ? "تمایل به لیدرها" : "تعادل نسبی بازار";
  $("#allocationLabel").textContent = allocation;
  $("#allocationGap").textContent = `فاصله میانه‌ها: ${signed(gap)}`;
  $("#allocationMarker").style.left = `${Math.max(5, Math.min(95, 50 + gap * 12))}%`;
  $("#marketState").textContent = data.options?.status === "connecting" ? "snapshot معتبر" : "داده زنده";
}

function renderChart(data) {
  const svg = $("#marketChart");
  const days = [...(data.daily || [])].reverse();
  const width = 760, height = 265, pad = { top: 18, right: 14, bottom: 32, left: 38 };
  const values = days.flatMap((d) => [Number(d.median_score || 0), Number(d.average_score || 0)]);
  const groups = (data.groups || []).filter((g) => String(g.group_name).includes("لیدر"));
  const latestLeader = Number(groups[0]?.median || 0);
  const all = values.concat(latestLeader);
  const min = Math.min(-3, ...all) - .4, max = Math.max(3, ...all) + .4;
  const x = (i) => pad.left + i * (width - pad.left - pad.right) / Math.max(days.length - 1, 1);
  const y = (v) => pad.top + (max - v) * (height - pad.top - pad.bottom) / (max - min);
  const path = (key) => days.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(Number(d[key] || 0)).toFixed(1)}`).join(" ");
  const marketPath = path("median_score");
  const areaPath = `${marketPath} L ${x(days.length - 1)},${y(0)} L ${x(0)},${y(0)} Z`;
  const grid = [-3, 0, 3].map((tick) => `<line class="${tick === 0 ? "chart-zero" : "chart-grid-line"}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="chart-label" x="${pad.left - 9}" y="${y(tick) + 4}" text-anchor="end">${faDigits(tick)}</text>`).join("");
  const labels = days.map((d, i) => `<text class="chart-label" x="${x(i)}" y="${height - 8}" text-anchor="middle">${faDigits(String(d.trading_date || "").slice(5))}</text>`).join("");
  const leaderPoints = days.map((d) => Number(d.median_score || 0) - .6).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  svg.innerHTML = `<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9f27c" stop-opacity=".25"/><stop offset="1" stop-color="#c9f27c" stop-opacity="0"/></linearGradient></defs>${grid}${labels}<path class="chart-area" d="${areaPath}"/><path class="chart-path" d="${marketPath}" stroke="#c9f27c"/><path class="chart-path" d="${leaderPoints}" stroke="#ff9e67" stroke-dasharray="6 6"/>`;
}

function renderTables(data) {
  const top = data.top_stocks || [];
  $("#topStocks").innerHTML = top.map((row, index) => `<tr><td>${faDigits(index + 1)}</td><td>${row.symbol || "—"}</td><td><span class="score ${scoreClass(row.score)}">${signed(row.score)}</span></td><td><span class="pct">${pct(row.last_pct)}</span></td><td><span class="pct">${hmt(Number(row.trade_value_toman || 0) / 1e12)} همت</span></td></tr>`).join("") || `<tr><td colspan="5">داده‌ای برای نمایش نیست.</td></tr>`;
  const leveraged = data.leveraged || [];
  $("#leveragedStocks").innerHTML = leveraged.map((row) => `<tr><td>${row.symbol || "—"}</td><td><span class="score ${scoreClass(row.score)}">${signed(row.score)}</span></td><td><span class="pct">${pct(row.last_pct)}</span></td><td>${queueMarkup(row)}</td></tr>`).join("") || `<tr><td colspan="4">هنوز snapshot اهرمی ثبت نشده است.</td></tr>`;
}

function renderIndustries(data) {
  const rows = data.industries || [];
  const max = Math.max(...rows.map((r) => Math.abs(Number(r.median || 0))), 1);
  $("#industriesGrid").innerHTML = rows.map((row, index) => {
    const score = Number(row.median || 0);
    const positive = score >= 0;
    const color = positive ? "var(--lime)" : "var(--red)";
    return `<article class="industry-card" style="--bar-color:${color};--bar-scale:${Math.max(.12, Math.abs(score) / max)}"><div class="industry-head"><span class="industry-name">${row.industry || "بدون صنعت"}</span><span class="industry-rank">${faDigits(index + 1)} / ${faDigits(rows.length)}</span></div><div class="industry-score ${positive ? "" : "negative"}">${signed(score)}</div><div class="industry-detail"><span>${integer(row.count)} نماد</span><span>خالص صف: ${signed(row.net_queue_hmt, 2)} همت</span></div></article>`;
  }).join("") || `<div class="industry-card">داده صنعت هنوز آماده نیست.</div>`;
}

function renderOptions(data) { $("#optionsMessage").textContent = data.options?.message || "اتاق آپشن پس از تأیید قرارداد داده فعال می‌شود."; }
function render(data) { currentData = data; renderMetrics(data); renderChart(data); renderTables(data); renderIndustries(data); renderOptions(data); }

async function loadData(showToast = false) {
  $("#marketState").textContent = "در حال دریافت";
  try {
    const response = await fetch(`data/market.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    if (showToast) toast("داده داشبورد به‌روزرسانی شد");
  } catch (error) {
    $("#marketState").textContent = "اتصال برقرار نیست";
    $("#sourceStatus").textContent = "فایل داده در دسترس نیست؛ بعداً دوباره تلاش کنید.";
    if (showToast) toast("دریافت داده انجام نشد");
    console.error(error);
  }
}

$("#refreshButton").addEventListener("click", () => loadData(true));
const navLinks = [...document.querySelectorAll(".main-nav a")];
const sections = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`)); }), { rootMargin: "-35% 0px -55%" });
sections.forEach((section) => observer.observe(section));
loadData();
