"use strict";

(() => {
  const core = window.MarketCore;
  const portfolio = window.PortfolioCore;
  const $ = (selector) => document.querySelector(selector);
  const holdingRows = $("#holdingRows");
  const storageKey = "sorena-watch-portfolio-v2";
  const legacyStorageKey = "sorena-watch-portfolio-v1";
  let snapshot = null;
  let catalog = [];
  let rowId = 0;
  let calculateTimer = 0;

  const escapeHtml = (value) => String(value === null || value === undefined ? "—" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const money = (value) => { const parsed = portfolio.num(value); return parsed === null ? "—" : core.faDigits(parsed.toLocaleString("fa-IR", {maximumFractionDigits: 2, minimumFractionDigits: 0})); };
  const score = (value) => core.formatSigned(value, 1);
  const percent = (value) => { const parsed = portfolio.num(value); return parsed === null ? "—" : `${core.faDigits((parsed * 100).toLocaleString("fa-IR", {maximumFractionDigits: 1, minimumFractionDigits: 1}))}٪`; };
  const rankMarkup = (rank) => rank ? `<bdi class="rank-value" dir="ltr">${core.faDigits(rank.rank)} از ${core.faDigits(rank.total)}</bdi>` : "—";
  const toast = (message) => { const node = $("#toast"); if (!node) return; node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2400); };

  function setStatus(message, kind = "normal") {
    const node = $("#sourceStatus"); if (node) node.textContent = message;
    const state = $("#state"); if (state) state.dataset.state = kind;
  }

  function addCatalogItem(map, symbol, meta) {
    const clean = portfolio.cleanSymbol(symbol);
    if (!clean) return;
    const existing = map.get(clean);
    if (!existing || meta.priority < existing.priority) map.set(clean, {symbol: clean, label: meta.label || "", kind: meta.kind || "catalog", priority: meta.priority || 9});
  }

  function buildCatalog(snapshotData, manifestData, fundsData) {
    const map = new Map();
    (snapshotData && Array.isArray(snapshotData.stocks) ? snapshotData.stocks : []).forEach((row) => addCatalogItem(map, row.symbol, {label: row.industry, kind: "current", priority: 1}));
    (snapshotData && Array.isArray(snapshotData.leveraged) ? snapshotData.leveraged : []).forEach((row) => addCatalogItem(map, row.symbol, {label: "صندوق اهرمی · snapshot امروز", kind: "current", priority: 1}));
    Object.keys(manifestData && manifestData.symbols ? manifestData.symbols : {}).forEach((symbol) => addCatalogItem(map, symbol, {label: "در فهرست تاریخچه نمادها", kind: "history", priority: 2}));
    (fundsData && Array.isArray(fundsData.rows) ? fundsData.rows : []).forEach((row) => addCatalogItem(map, row.symbol, {label: row.description || "صندوق", kind: "fund", priority: 3}));
    return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol, "fa"));
  }

  function catalogMatch(query) {
    const wanted = portfolio.cleanSymbol(query);
    if (!wanted) return [];
    return catalog.filter((item) => portfolio.cleanSymbol(item.symbol).includes(wanted) || portfolio.cleanSymbol(item.label).includes(wanted)).slice(0, 8);
  }

  function suggestionLabel(item) {
    if (item.kind === "current") return `${item.symbol} · snapshot امروز`;
    if (item.kind === "fund") return `${item.symbol} · ${item.label || "صندوق"}`;
    return `${item.symbol} · ${item.label || "فهرست تاریخچه"}`;
  }

  function hideSuggestions(input) {
    const box = input.parentElement.querySelector(".symbol-suggestions");
    if (box) { box.innerHTML = ""; box.hidden = true; }
  }

  function renderSuggestions(input) {
    const box = input.parentElement.querySelector(".symbol-suggestions");
    if (!box) return;
    const matches = catalogMatch(input.value);
    if (!portfolio.cleanSymbol(input.value) || !matches.length) { hideSuggestions(input); return; }
    box.innerHTML = matches.map((item) => `<button type="button" role="option" data-symbol="${escapeHtml(item.symbol)}"><b>${escapeHtml(item.symbol)}</b><small>${escapeHtml(suggestionLabel(item).replace(`${item.symbol} · `, ""))}</small></button>`).join("");
    box.hidden = false;
    box.querySelectorAll("button").forEach((button) => button.addEventListener("mousedown", (event) => event.preventDefault()));
    box.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      input.value = button.dataset.symbol || "";
      hideSuggestions(input);
      input.dispatchEvent(new Event("input", {bubbles: true}));
      input.focus();
    }));
  }

  function makeRow(symbol = "", value = "", existingId = "") {
    rowId += 1;
    const id = existingId || String(rowId);
    const row = document.createElement("div");
    row.className = "holding-row";
    row.dataset.rowId = id;
    row.innerHTML = `<label><span>نماد</span><div class="symbol-field"><input class="holding-symbol" list="portfolioSymbols" type="text" inputmode="text" placeholder="مثلاً فملی" value="${escapeHtml(symbol)}" autocomplete="off"><div class="symbol-suggestions" role="listbox" hidden></div></div></label><label><span>ارزش خرید <em>میلیون تومان</em></span><input class="holding-value" type="number" min="0" step="0.1" inputmode="decimal" placeholder="مثلاً ۳۰۰" value="${escapeHtml(value)}"></label><button class="remove-holding" type="button" aria-label="حذف این نماد">×</button>`;
    row.querySelector(".remove-holding").addEventListener("click", () => { row.remove(); saveDraft(); });
    const symbolInput = row.querySelector(".holding-symbol");
    symbolInput.addEventListener("input", () => { renderSuggestions(symbolInput); saveDraft(); });
    symbolInput.addEventListener("focus", () => renderSuggestions(symbolInput));
    symbolInput.addEventListener("blur", () => setTimeout(() => hideSuggestions(symbolInput), 120));
    row.querySelector(".holding-value").addEventListener("input", saveDraft);
    holdingRows.appendChild(row);
  }

  function readDraft() {
    const rows = Array.from(document.querySelectorAll(".holding-row")).map((row) => {
      const symbolInput = row.querySelector(".holding-symbol");
      const valueInput = row.querySelector(".holding-value");
      return {rowId: row.dataset.rowId || "", symbol: symbolInput ? symbolInput.value : "", value: valueInput ? valueInput.value : ""};
    }).filter((row) => row.symbol || row.value);
    const cashInput = $("#cashValue");
    return {cash: cashInput ? cashInput.value : "", holdings: rows};
  }

  function saveDraft() { try { localStorage.setItem(storageKey, JSON.stringify(readDraft())); } catch (_) {} }

  function loadDraft() {
    let draft = null;
    let migrated = false;
    try { draft = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) {}
    if (!draft) {
      try { draft = JSON.parse(localStorage.getItem(legacyStorageKey) || "null"); migrated = Boolean(draft); } catch (_) {}
    }
    if (migrated && draft) {
      const toMillions = (value) => {
        const parsed = portfolio.num(value);
        return parsed === null ? "" : String(parsed / 1000000);
      };
      draft = {cash: toMillions(draft.cash), holdings: Array.isArray(draft.holdings) ? draft.holdings.map((holding) => ({...holding, value: toMillions(holding.value)})) : []};
      try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch (_) {}
    }
    const holdings = draft && Array.isArray(draft.holdings) && draft.holdings.length ? draft.holdings : [{symbol: "", value: ""}];
    holdings.forEach((holding) => makeRow(holding.symbol, holding.value, holding.rowId));
    if ($("#cashValue")) $("#cashValue").value = draft && draft.cash ? draft.cash : "";
  }

  function setupSymbols() {
    const list = document.createElement("datalist"); list.id = "portfolioSymbols";
    list.innerHTML = catalog.map((item) => `<option value="${escapeHtml(item.symbol)}" label="${escapeHtml(suggestionLabel(item))}"></option>`).join("");
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
    const comparison = $("#comparisonText"); if (comparison) comparison.textContent = result.gap === null ? "برای مقایسه، باید همه نمادهای دارای ارزش در snapshot امروز وضعیت معتبر داشته باشند." : result.gap > 0 ? "امتیاز وزنی پرتفو بالاتر از میانه بازار است." : result.gap < 0 ? "امتیاز وزنی پرتفو پایین‌تر از میانه بازار است." : "امتیاز وزنی پرتفو با میانه بازار برابر است.";
    const summary = $("#resultSummary");
    if (summary) {
      const missingSymbols = result.holdings.filter((item) => item.status === "snapshot_missing" || item.status === "not_found").map((item) => item.symbol).filter(Boolean);
      const missingText = missingSymbols.length ? `<span class="warning-text">${escapeHtml(missingSymbols.join("، "))} در snapshot امروز امتیاز ندارد؛ صفر فرض نشده است.</span>` : "";
      summary.innerHTML = result.totalValue ? `<span>ارزش مبنای محاسبه: <b>${money(result.totalValue)} میلیون تومان</b></span><span>وزن نقد: <b>${percent(result.cashWeight)}</b></span>${missingText}` : "<span>یک یا چند مبلغ معتبر وارد کن.</span>";
    }
  }

  function findTopRow(rowId) {
    return Array.from(document.querySelectorAll(".holding-row")).find((row) => row.dataset.rowId === String(rowId)) || null;
  }

  function syncTableEdit(input) {
    const topRow = findTopRow(input.dataset.rowId);
    if (!topRow) return;
    const selector = input.classList.contains("table-symbol-edit") ? ".holding-symbol" : ".holding-value";
    const target = topRow.querySelector(selector);
    if (target) target.value = input.value;
    saveDraft();
    clearTimeout(calculateTimer);
    calculateTimer = setTimeout(calculate, 180);
  }

  function renderRows(result) {
    const element = $("#portfolioRows"); if (!element) return;
    if (!result.holdings.length) { element.innerHTML = `<tr><td colspan="8" class="empty-row">دارایی‌ای برای نمایش وارد نشده است.</td></tr>`; return; }
    element.innerHTML = result.holdings.map((item) => {
      const row = item.row || {};
      const rank = rankMarkup(item.rank);
      const status = item.status === "ready" ? "معتبر" : item.status === "untraded_zero" ? "بدون معامله · امتیاز ۰" : item.status === "missing_score" ? "امتیاز ناموجود" : item.status === "snapshot_missing" ? "در snapshot امروز نیست" : "در فهرست داده نیست";
      const contribution = item.contribution === null ? "—" : score(item.contribution);
      const industry = row.industry || (item.status === "snapshot_missing" ? "داده جاری موجود نیست" : "—");
      return `<tr><td><input class="table-symbol-edit" list="portfolioSymbols" data-row-id="${escapeHtml(item.rowId || "")}" value="${escapeHtml(item.symbol || "")}" aria-label="ویرایش نماد"></td><td>${escapeHtml(industry)}</td><td><div class="table-value-editor"><input class="table-value-edit" data-row-id="${escapeHtml(item.rowId || "")}" type="number" min="0" step="0.1" value="${escapeHtml(item.value)}" aria-label="ویرایش ارزش خرید"><small>میلیون</small></div></td><td dir="ltr">${percent(item.weight)}</td><td dir="ltr">${escapeHtml(score(item.score))}</td><td dir="ltr">${rank}</td><td dir="ltr">${escapeHtml(contribution)}</td><td><span class="row-status ${item.status}">${escapeHtml(status)}</span></td></tr>`;
    }).join("");
    element.querySelectorAll(".table-symbol-edit,.table-value-edit").forEach((input) => input.addEventListener("input", () => syncTableEdit(input)));
  }

  function calculate() {
    if (!snapshot) { toast("snapshot بازار هنوز آماده نیست"); return; }
    const draft = readDraft();
    const result = portfolio.calculatePortfolio({holdings: draft.holdings, cash: draft.cash || 0, marketMedian: snapshot.market && snapshot.market.median, stocks: snapshot.stocks, catalog});
    renderResult(result); renderRows(result); saveDraft();
    if (result.totalScore !== null) toast("امتیاز پرتفو محاسبه شد");
  }

  async function fetchJson(url) {
    const response = await fetch(url, {cache: "no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function loadSnapshot() {
    try {
      const marketData = await fetchJson("../data/market.json");
      const optional = await Promise.all([
        fetchJson("../symbols/data/history-manifest.json").catch(() => ({symbols: {}})),
        fetchJson("../data/funds.json").catch(() => ({rows: []})),
      ]);
      snapshot = marketData;
      catalog = buildCatalog(marketData, optional[0], optional[1]);
      setupSymbols();
      $("#marketDate").textContent = core.formatDate(core.sourceTimestamp(snapshot));
      setStatus(`snapshot به‌روز · ${core.formatDate(core.sourceTimestamp(snapshot))} · ${core.faDigits(catalog.length)} نماد قابل جست‌وجو`);
      $("#calculatePortfolio").disabled = false;
    } catch (error) {
      setStatus("دریافت snapshot ناموفق", "stale");
      toast("دریافت داده بازار انجام نشد");
    }
  }

  $("#addHolding").addEventListener("click", () => { makeRow(); saveDraft(); });
  $("#calculatePortfolio").addEventListener("click", calculate);
  $("#cashValue").addEventListener("input", saveDraft);
  $("#clearPortfolio").addEventListener("click", () => { localStorage.removeItem(storageKey); holdingRows.innerHTML = ""; makeRow(); $("#cashValue").value = ""; renderResult({totalScore: null, investedScore: null, marketMedian: snapshot && snapshot.market ? snapshot.market.median : null, gap: null, coverage: 0, entered: 0, missing: 0, totalValue: 0, cashWeight: null, holdings: []}); renderRows({holdings: []}); toast("ورودی پرتفو پاک شد"); });
  loadDraft();
  $("#calculatePortfolio").disabled = true;
  void loadSnapshot();
})();
