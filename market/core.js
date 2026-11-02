"use strict";

const TEHRAN_TIME_ZONE = "Asia/Tehran";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function number(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function faDigits(value) { return String(value).replace(/[0-9]/g, (digit) => FA_DIGITS[digit]); }
function formatNumber(value, digits = 1) {
  const parsed = number(value);
  return parsed === null ? "—" : faDigits(parsed.toLocaleString("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: digits }));
}
function formatInteger(value) {
  const parsed = number(value);
  return parsed === null ? "—" : faDigits(Math.round(parsed).toLocaleString("fa-IR"));
}
function formatSigned(value, digits = 1) {
  const parsed = number(value);
  if (parsed === null) return "—";
  return `${parsed > 0 ? "+" : parsed < 0 ? "−" : ""}${formatNumber(Math.abs(parsed), digits)}`;
}
function formatPercent(value, digits = 2) {
  const parsed = number(value);
  return parsed === null ? "—" : `${formatSigned(parsed, digits)}٪`;
}
function formatScore(value) { return formatSigned(value, 1); }
function formatMillion(value, suffix = " M", digits = 1) {
  const parsed = number(value);
  return parsed === null ? "—" : `${formatNumber(parsed / 1e6, digits)}${suffix}`;
}
function formatBillion(value, suffix = " B", digits = 1) {
  const parsed = number(value);
  return parsed === null ? "—" : `${formatNumber(parsed / 1e9, digits)}${suffix}`;
}
function formatMillionToman(value) { return formatMillion(value, " M", 1); }
function formatBillionToman(value) { return formatBillion(value, " B", 0); }
function closePercent(closePrice, yesterdayPrice) {
  const close = number(closePrice), yesterday = number(yesterdayPrice);
  return close === null || yesterday === null || yesterday === 0 ? null : ((close - yesterday) / yesterday) * 100;
}
function formatQueueBillion(value) {
  const parsed = number(value);
  return parsed === null || parsed <= 0 ? "—" : formatBillion(parsed, "", 0);
}
function sourceTimestamp(data) {
  if (!data || typeof data !== "object") return null;
  const market = data.market;
  return market && typeof market === "object" && market.timestamp
    ? market.timestamp
    : data.generated_at || null;
}
function formatDate(value, includeSeconds = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const datePart = new Intl.DateTimeFormat("fa-IR", { timeZone: TEHRAN_TIME_ZONE, year: "numeric", month: "short", day: "numeric" }).format(date);
  const timePart = new Intl.DateTimeFormat("fa-IR", { timeZone: TEHRAN_TIME_ZONE, hour: "2-digit", minute: "2-digit", ...(includeSeconds ? { second: "2-digit" } : {}) }).format(date);
  return `${datePart} · ${timePart}`;
}
function findLeaders(data) { return (Array.isArray(data && data.groups) ? data.groups : []).find((group) => String(group.group_name || "").includes("لیدر")) || null; }
function allocation(marketMedian, leaderMedian) {
  const market = number(marketMedian), leaders = number(leaderMedian);
  if (market === null || leaders === null) return { key: "none", label: "داده تخصیص کافی نیست", gap: null };
  const gap = market - leaders;
  if (gap > 1) return { key: "strong-broad", label: "تمایل قوی به هم‌وزن", gap };
  if (gap >= 0.5) return { key: "broad", label: "تمایل به هم‌وزن", gap };
  if (gap < -1) return { key: "strong-leaders", label: "تمایل قوی به لیدرها", gap };
  if (gap <= -0.5) return { key: "leaders", label: "تمایل به لیدرها", gap };
  return { key: "none", label: "بدون تمایل مشخص", gap };
}
function validateSnapshot(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("ساختار snapshot نامعتبر است.");
  for (const key of ["schema_version", "source", "generated_at", "market"]) if (!(key in data)) throw new Error(`فیلد الزامی «${key}» وجود ندارد.`);
  if (!data.market || typeof data.market !== "object" || Array.isArray(data.market)) throw new Error("ساختار market نامعتبر است.");
  const requiredArrays = ["groups", "top_stocks", "leveraged", "industries", "daily"];
  if (number(data.schema_version) >= 2) requiredArrays.push("stocks", "top_buy_queue", "intraday", "queue_intraday");
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) throw new Error(`فیلد «${key}» باید آرایه باشد.`);
    if (data[key].some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error(`ساختار ردیف «${key}» نامعتبر است.`);
  }
  if (![1, 2].includes(number(data.schema_version)) || !data.source || !data.generated_at) throw new Error("نسخه یا متادیتای snapshot نامعتبر است.");
  if (!sourceTimestamp(data) || Number.isNaN(new Date(sourceTimestamp(data)).getTime())) throw new Error("timestamp منبع نامعتبر است.");
  return data;
}
const SCORE_LIMIT = 20;
function chartScore(value) {
  const parsed = number(value);
  // Scores outside the contract range are corrupt/outlier samples. Keep the
  // date on the x-axis, but do not let one bad value flatten the whole chart.
  return parsed !== null && Math.abs(parsed) <= SCORE_LIMIT ? parsed : null;
}
function chartSeries(data) {
  const daily = Array.isArray(data && data.daily) ? [...data.daily].reverse() : [];
  return {
    market: daily.map((row) => chartScore(row.median_score)),
    leaders: daily.map((row) => chartScore(row.leader_median_score)),
    rest: daily.map((row) => chartScore(row.rest_median_score)),
  };
}
function chartExtrema(values) {
  const valid = (Array.isArray(values) ? values : []).map(number).filter((value) => value !== null);
  return valid.length ? { min: Math.min(...valid), max: Math.max(...valid) } : { min: null, max: null };
}
function integerNiceTicks(minValue, maxValue, targetCount = 5) {
  let lo = Number(minValue), hi = Number(maxValue);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const normalized = raw / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, nice * magnitude);
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  return Array.from({ length: Math.round((last - first) / step) + 1 }, (_, index) => Math.round(first + index * step));
}
function chartScale(...series) {
  const extrema = chartExtrema(series.flat());
  if (extrema.min === null) return { min: -3, max: 3, ticks: [-3, -2, -1, 0, 1, 2, 3] };
  const min = Math.min(-3, Math.floor(extrema.min));
  const max = Math.max(3, Math.ceil(extrema.max));
  return { min, max, ticks: Array.from({ length: max - min + 1 }, (_, index) => min + index) };
}

const api = { TEHRAN_TIME_ZONE, number, faDigits, formatNumber, formatInteger, formatSigned, formatPercent, formatScore, formatMillion, formatBillion, formatMillionToman, formatBillionToman, closePercent, formatQueueBillion, sourceTimestamp, formatDate, findLeaders, allocation, validateSnapshot, chartSeries, chartExtrema, integerNiceTicks, chartScale };
if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.MarketCore = api;
