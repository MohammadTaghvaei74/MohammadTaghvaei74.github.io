"use strict";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const fa = (value, digits = 0) => value === null || value === undefined || value === "" || Number.isNaN(Number(value)) ? "—" : Number(value).toLocaleString("fa-IR", {maximumFractionDigits: digits, minimumFractionDigits: digits});
  const esc = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const typeLabel = (type) => type === "call" ? "کال" : type === "put" ? "پوت" : "—";
  const qualityLabel = (row) => {
    const q = row.data_quality || {};
    if (q.usable_for_analysis) return '<span class="quality-badge fresh">قابل استفاده</span>';
    if (q.quote === "fresh") return '<span class="quality-badge partial">ناقص</span>';
    return '<span class="quality-badge stale">قدیمی</span>';
  };
  let feed = null;
  let selectedUnderlying = "";
  let selectedExpiry = "";

  function setText(id, value) { const node = $(id); if (node) node.textContent = value; }
  function sourceAge(timestamp) { const parsed = Date.parse(timestamp || ""); return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null; }
  function dateText(value) { return value ? new Date(value).toLocaleString("fa-IR", {dateStyle:"short", timeStyle:"short"}) : "—"; }
  function allContracts() { return Array.isArray(feed && feed.contracts) ? feed.contracts : []; }
  function allChains() { return Array.isArray(feed && feed.chains) ? feed.chains : []; }

  function renderStatus() {
    const status = feed && feed.status;
    const stale = sourceAge(feed && feed.source_at) !== null && sourceAge(feed.source_at) > 120000;
    const label = stale || status === "stale" ? "داده قدیمی" : status === "ready" ? "داده معتبر آماده است" : status === "unavailable" ? "داده در دسترس نیست" : "داده ناقص";
    setText("#chainStatus", label);
    setText("#chainMessage", stale ? "آخرین snapshot فقط برای مشاهده است؛ مبنای ورود یا سیگنال نیست." : (feed && feed.message) || "—");
    setText("#chainUpdated", `آخرین داده: ${dateText(feed && feed.source_at)}`);
    const top = $("#optionsTopStatus");
    if (top) { top.dataset.state = stale || status === "stale" ? "stale" : status === "ready" ? "ready" : "unknown"; top.querySelector("span").textContent = label; }
    const counts = feed && feed.counts || {};
    setText("#metricContracts", fa(counts.contracts)); setText("#metricUnderlyings", fa(counts.underlyings)); setText("#metricCalls", fa(counts.calls)); setText("#metricPuts", fa(counts.puts)); setText("#metricFresh", fa(counts.fresh_contracts));
    setText("#qualityNote", (feed && feed.freshness_note) || "داده‌های قدیمی برای مشاهده نگه داشته می‌شوند، اما مبنای ورود یا سیگنال نیستند.");
    const diagnostics = Array.isArray(feed && feed.diagnostics) ? feed.diagnostics : [];
    $("#qualityDiagnostics").innerHTML = diagnostics.length ? diagnostics.map((item) => `<span>${esc(item.label)}: <b>${fa(item.count)}</b></span>`).join("") : "هیچ هشدار داده‌ای ثبت نشده است.";
  }

  function populateSelectors() {
    const underlyings = Array.isArray(feed && feed.underlyings) ? feed.underlyings : [];
    const u = $("#watchUnderlying"); const c = $("#chainUnderlying");
    const selectedWatch = u.value; const selectedChain = selectedUnderlying;
    const options = underlyings.map((row) => `<option value="${esc(row.symbol)}">${esc(row.symbol)} · ${fa(row.contract_count)} قرارداد</option>`).join("");
    u.innerHTML = '<option value="">همه نمادها</option>' + options; u.value = underlyings.some((row) => row.symbol === selectedWatch) ? selectedWatch : "";
    c.innerHTML = '<option value="">انتخاب نماد پایه</option>' + options; c.value = underlyings.some((row) => row.symbol === selectedChain) ? selectedChain : "";
    const expiries = [...new Set(allContracts().filter((row) => !selectedUnderlying || row.underlying === selectedUnderlying).map((row) => row.expiry))].sort();
    const e = $("#watchExpiry"); const chainE = $("#chainExpiry"); const oldWatch = e.value;
    e.innerHTML = '<option value="">همه سررسیدها</option>' + expiries.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join(""); e.value = expiries.includes(oldWatch) ? oldWatch : "";
    chainE.innerHTML = '<option value="">انتخاب سررسید</option>' + expiries.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join(""); chainE.value = expiries.includes(selectedExpiry) ? selectedExpiry : "";
  }

  function renderWatch() {
    const query = String($("#watchSearch").value || "").trim().toLocaleLowerCase("fa");
    const underlying = $("#watchUnderlying").value; const type = $("#watchType").value; const expiry = $("#watchExpiry").value; const quality = $("#watchQuality").value;
    const rows = allContracts().filter((row) => {
      const q = row.data_quality || {};
      return (!query || `${row.symbol} ${row.underlying}`.toLocaleLowerCase("fa").includes(query)) && (!underlying || row.underlying === underlying) && (!type || row.option_type === type) && (!expiry || row.expiry === expiry) && (!quality || (quality === "fresh" ? q.quote === "fresh" : quality === "usable" ? q.usable_for_analysis : !q.usable_for_analysis));
    }).sort((a,b) => String(a.underlying).localeCompare(String(b.underlying), "fa") || String(a.expiry).localeCompare(String(b.expiry)) || (Number(a.strike_toman) || 0) - (Number(b.strike_toman) || 0) || String(a.option_type).localeCompare(String(b.option_type)));
    setText("#watchCount", `${fa(rows.length)} از ${fa(allContracts().length)}`);
    const body = $("#watchRows");
    body.innerHTML = rows.length ? rows.map((row) => `<tr class="${row.data_quality && row.data_quality.usable_for_analysis ? "" : "is-incomplete"}"><td><bdi dir="ltr">${esc(row.symbol)}</bdi></td><td><a href="../symbols/?symbol=${encodeURIComponent(row.underlying)}">${esc(row.underlying)}</a></td><td><span class="option-type ${esc(row.option_type)}">${typeLabel(row.option_type)}</span></td><td><bdi dir="ltr">${esc(row.expiry)}</bdi><small>${fa(row.dte)} روز</small></td><td><bdi dir="ltr">${fa(row.strike_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.last_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.bid_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.ask_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.trade_volume)}</bdi></td><td><bdi dir="ltr">${fa(row.trade_value_toman)}</bdi></td><td><bdi dir="ltr">${fa(row.open_interest)}</bdi></td><td>${qualityLabel(row)}</td></tr>`).join("") : '<tr><td colspan="12" class="options-empty">قراردادی با این فیلترها پیدا نشد.</td></tr>';
  }

  function renderChain() {
    const chain = allChains().find((row) => row.underlying === selectedUnderlying && row.expiry === selectedExpiry);
    const body = $("#chainRows");
    if (!chain) { body.innerHTML = '<tr><td colspan="9" class="options-empty">نماد پایه و سررسید را انتخاب کنید.</td></tr>'; setText("#chainCount", "—"); setText("#chainNote", "برای دیدن زنجیره، نماد پایه و سررسید را انتخاب کنید."); return; }
    setText("#chainCount", `${fa(chain.rows.length)} ردیف`); setText("#chainNote", `قیمت پایه: ${fa(chain.underlying_last_toman, 1)} تومان · ${fa(chain.dte)} روز تا سررسید · کال ${fa(chain.calls_count)} · پوت ${fa(chain.puts_count)}`);
    const rowCell = (row, side) => {
      if (!row) return '<td>—</td><td>—</td><td>—</td><td>—</td>';
      const cells = `<td><bdi dir="ltr">${esc(row.symbol)}</bdi><small>${qualityLabel(row)}</small></td><td><bdi dir="ltr">${fa(row.bid_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.ask_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.open_interest)}</bdi></td>`;
      return side === "put" ? `<td><bdi dir="ltr">${fa(row.open_interest)}</bdi></td><td><bdi dir="ltr">${fa(row.bid_toman, 1)}</bdi></td><td><bdi dir="ltr">${fa(row.ask_toman, 1)}</bdi></td><td><bdi dir="ltr">${esc(row.symbol)}</bdi><small>${qualityLabel(row)}</small></td>` : cells;
    };
    body.innerHTML = chain.rows.map((row) => `<tr class="${row.moneyness === "atm" ? "atm-row" : ""}">${rowCell(row.call, "call")}<th class="strike-cell"><bdi dir="ltr">${fa(row.strike_toman, 1)}</bdi>${row.moneyness === "atm" ? '<small>ATM</small>' : ""}</th>${rowCell(row.put, "put")}</tr>`).join("");
    const u = (feed.underlyings || []).find((item) => item.symbol === selectedUnderlying); setText("#underlyingSummary", u ? `${u.symbol} · قیمت ${fa(u.last_toman, 1)} · ${fa(u.contract_count)} قرارداد · ${fa(u.expiries.length)} سررسید` : "—");
  }

  function bind() {
    ["#watchSearch", "#watchUnderlying", "#watchType", "#watchExpiry", "#watchQuality"].forEach((selector) => { $(selector).addEventListener("input", renderWatch); $(selector).addEventListener("change", renderWatch); });
    $("#watchClear").addEventListener("click", () => { ["#watchSearch", "#watchUnderlying", "#watchType", "#watchExpiry", "#watchQuality"].forEach((selector) => { $(selector).value = ""; }); populateSelectors(); renderWatch(); });
    $("#chainUnderlying").addEventListener("change", (event) => { selectedUnderlying = event.target.value; selectedExpiry = ""; populateSelectors(); renderChain(); });
    $("#chainExpiry").addEventListener("change", (event) => { selectedExpiry = event.target.value; renderChain(); });
    $("#optionsRefresh").addEventListener("click", () => load(true));
  }

  async function load(showStatus = false) {
    if (showStatus) setText("#chainStatus", "در حال به‌روزرسانی");
    try { const response = await fetch(`../data/options-chain.json?ts=${Date.now()}`, {cache:"no-store"}); if (!response.ok) throw new Error(`HTTP ${response.status}`); feed = await response.json(); populateSelectors(); renderStatus(); renderWatch(); renderChain(); }
    catch (error) { feed = {status:"unavailable",message:"دریافت فید زنجیره انجام نشد.",counts:{},contracts:[],chains:[],underlyings:[],diagnostics:[{label:String(error.message),count:1}]}; renderStatus(); renderWatch(); renderChain(); }
  }
  bind(); load();
})();

