"use strict";

(() => {
  const core = window.MarketCore;
  const portfolio = window.PortfolioCore;
  const $ = (selector) => document.querySelector(selector);
  const holdingRows = $("#holdingRows");
  const storageKey = "sorena-watch-portfolio-v1";
  let snapshot = null;
  let rowId = 0;

  const escapeHtml = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const money = (value) => { const parsed = portfolio.num(value); return parsed === null ? "—" : core.faDigits(Math.round(parsed).toLocaleString("fa-IR")); };
  const score = (value) => core.formatSigned(value, 1);
  const percent = (value) => { const parsed = portfolio.num(value); return parsed === null ? "—" : `${core.faDigits((parsed * 100).toLocaleString("fa-IR", {maximumFractionDigits: 1, minimumFractionDigits: 1}))}٪`; };
  const toast = (message) => { const node = $("#toast"); if (!node) return; node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2400); };

  function setStatus(message, kind = "normal") {
    const node = $("#sourceStatus"); if (node) node.textContent = message;
    const state = $("#state"); if (state) state.dataset.state = kind;
  }

  function makeRow(symbol = "", value = "") {
    rowId += 1;
    const row = document.createElement("div");
    row.className = "holding-row";
    row.dataset.rowId = String(rowId);
    row.innerHTML = `<label><span>نماد</span><input class="holding-symbol" list="portfolioSymbols" type="text" inputmode="text" placeholder="مثلاً فملی" value="${escapeHtml(symbol)}" autocomplete="off"></label><label><span>ارزش خرید <em>تومان</em></span><input class="holding-value" type="number" min="0" step="1000" inputmode="decimal" placeholder="مثلاً ۵۰۰۰۰۰۰۰۰" value="${escapeHtml(value)}"></label><button class="remove-holding" type="button" aria-label="حذف این نماد">×</button>`;
    row.querySelector(".remove-holding").addEventListener("click", () => { row.remove(); saveDraft(); });
    row.querySelectorAll("input").forEach((input) => input.addEventListener("input", saveDraft));
    holdingRows.appendChild(row);
  }

  function readDraft() {
    const rows = [...document.querySelectorAll(".holding-row")].map((row) => { const symbolInput = row.querySelector(".holding-symbol"); const valueInput = row.querySelector(".holding-value"); return { symbol: symbolInput ? symbolInput.value : "", value: valueInput ? valueInput.value : "" }; }).filter((row) => row.symbol || row.value);
    const cashInput = $("#cashValue");
    return { cash: cashInput ? cashInput.value : "", holdings: rows };
  }

  function saveDraft() { try { localStorage.setItem(storageKey, JSON.stringify(readDraft())); } catch (_) {} }

  function loadDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) {}
    const holdings = draft && Array.isArray(draft.holdings) ? draft.holdings : [{symbol: "", value: ""}];
    holdings.forEach((holding) => makeRow(holding.symbol, holding.value));
    if ($( "#cashValue")) $("#cashValue").value = draft && draft.cash ? draft.cash : "";
  }

  function setupSymbols(stocks) {
    const list = document.createElement("datalist"); list.id = "portfolioSymbols";
    const symbols = [...new Set((Array.isArray(stocks) ? stocks : []).map((row) => String(row.symbol || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fa"));
    list.innerHTML = symbols.map((symbol) => `<option value="${escapeHtml(symbol)}"></option>`).join("");
    document.body.appendChild(list);
  }

  function renderResult(result) {
    const total = $("#totalScore"), invested = $("#investedScore"), market = $("#marketMedian"), gap = $("#scoreGap");
    if (total) total.textContent = score(result.totalScore);
    if (invested) invested.textContent = score(result.investedScore);
    if (market) market.textContent = score(result.marketMedian);
    if (gap) gap.textContent = score(result.gap);
    const coverage = $("#coverageLabel"); if (coverage) coverage.textContent = `پوشش ${core.faDigits(result.coverage)} از ${core.faDigits(result.entered)} نماد`;
    const status = $("#resultStatus"); if (status) { status.textContent = result.totalScore === null ? "داده کافی نیست" : result.missing ? "با هشدار داده‌ای" : "محاسبه شد"; status.dataset.state = result.missing ? "warning" : "ready"; }
    const comparison = $("#comparisonText"); if (comparison) comparison.textContent = result.gap === null ? "برای مقایسه، امتیاز بازار یا ارزش معتبر سبد موجود نیست." : result.gap > 0 ? "امتیاز وزنی پرتفو بالاتر از میانه بازار است." : result.gap < 0 ? "امتیاز وزنی پرتفو پایین‌تر از میانه بازار است." : "امتیاز وزنی پرتفو با میانه بازار برابر است.";
    const summary = $("#resultSummary"); if (summary) summary.innerHTML = result.totalValue ? `<span>ارزش مبنای محاسبه: <b>${money(result.totalValue)} تومان</b></span><span>وزن نقد: <b>${percent(result.cashWeight)}</b></span>${result.missing ? `<span class="warning-text">${core.faDigits(result.missing)} نماد در snapshot فعلی قابل تطبیق نبود و در امتیاز لحاظ نشد.</span>` : ""}` : "<span>یک یا چند مبلغ معتبر وارد کن.</span>";
  }

  function renderRows(result) {
    const element = $("#portfolioRows"); if (!element) return;
    if (!result.holdings.length) { element.innerHTML = `<tr><td colspan="8" class="empty-row">دارایی‌ای برای نمایش وارد نشده است.</td></tr>`; return; }
    element.innerHTML = result.holdings.map((item) => {
      const row = item.row || {};
      const rank = item.rank ? `${core.faDigits(item.rank.rank)} از ${core.faDigits(item.rank.total)}` : "—";
      const status = item.status === "ready" ? "معتبر" : item.status === "untraded_zero" ? "بدون معامله · امتیاز ۰" : item.status === "missing_score" ? "امتیاز ناموجود" : "نماد پیدا نشد";
      const contribution = item.contribution === null ? "—" : score(item.contribution);
      return `<tr><td><b>${escapeHtml(item.symbol || "—")}</b></td><td>${escapeHtml(row.industry || "—")}</td><td dir="ltr">${money(item.value)}</td><td dir="ltr">${percent(item.weight)}</td><td dir="ltr">${score(item.score)}</td><td dir="ltr">${escapeHtml(rank)}</td><td dir="ltr">${contribution}</td><td><span class="row-status ${item.status}">${escapeHtml(status)}</span></td></tr>`;
    }).join("");
  }

  function calculate() {
    if (!snapshot) { toast("snapshot بازار هنوز آماده نیست"); return; }
    const draft = readDraft();
    const result = portfolio.calculatePortfolio({ holdings: draft.holdings, cash: draft.cash || 0, marketMedian: snapshot.market && snapshot.market.median, stocks: snapshot.stocks });
    renderResult(result); renderRows(result); saveDraft();
    if (result.totalScore !== null) toast("امتیاز پرتفو محاسبه شد");
  }

  async function loadSnapshot() {
    try {
      const response = await fetch("../data/market.json", {cache: "no-store"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      snapshot = await response.json();
      setupSymbols(snapshot.stocks);
      $("#marketDate").textContent = core.formatDate(core.sourceTimestamp(snapshot));
      setStatus(`snapshot به‌روز · ${core.formatDate(core.sourceTimestamp(snapshot))}`);
      $("#calculatePortfolio").disabled = false;
    } catch (error) {
      setStatus("دریافت snapshot ناموفق", "stale");
      toast("دریافت داده بازار انجام نشد");
    }
  }

  $("#addHolding").addEventListener("click", () => { makeRow(); saveDraft(); });
  $("#calculatePortfolio").addEventListener("click", calculate);
  $("#cashValue").addEventListener("input", saveDraft);
  $("#clearPortfolio").addEventListener("click", () => { localStorage.removeItem(storageKey); holdingRows.innerHTML = ""; makeRow(); $("#cashValue").value = ""; renderResult({totalScore:null, investedScore:null, marketMedian: snapshot && snapshot.market ? snapshot.market.median : null, gap:null, coverage:0, entered:0, missing:0, totalValue:0, cashWeight:null}); renderRows({holdings:[]}); toast("ورودی پرتفو پاک شد"); });
  loadDraft();
  $("#calculatePortfolio").disabled = true;
  void loadSnapshot();
})();
