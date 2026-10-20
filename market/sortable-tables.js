(function () {
  "use strict";

  var tableStates = new WeakMap();
  var faDigits = "۰۱۲۳۴۵۶۷۸۹";
  var arDigits = "٠١٢٣٤٥٦٧٨٩";

  function normalizeDigits(value) {
    return String(value == null ? "" : value)
      .replace(/[۰-۹]/g, function (d) { return String(faDigits.indexOf(d)); })
      .replace(/[٠-٩]/g, function (d) { return String(arDigits.indexOf(d)); });
  }

  function parsedValue(cell) {
    var raw = cell && cell.dataset && cell.dataset.sortValue != null ? cell.dataset.sortValue : (cell ? cell.textContent : "");
    var text = normalizeDigits(raw).trim().replace(/[٬،,]/g, "").replace(/[٪%]/g, "").replace(/[٫]/g, ".").replace(/[−–]/g, "-");
    if (!text || text === "—" || text === "-") return { missing: true, text: "" };
    var numeric = text.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
    if (numeric && numeric[0] && numeric[0].length >= text.replace(/[^0-9.]/g, "").length * 0.6) {
      return { missing: false, number: Number(numeric[0]), text: text };
    }
    return { missing: false, text: text.toLocaleLowerCase("fa-IR") };
  }

  function compareRows(a, b, column, direction) {
    var av = parsedValue(a.cells[column]);
    var bv = parsedValue(b.cells[column]);
    if (av.missing && bv.missing) return a._defaultIndex - b._defaultIndex;
    if (av.missing) return 1;
    if (bv.missing) return -1;
    var result;
    if (av.number !== undefined && bv.number !== undefined) result = av.number - bv.number;
    else if (av.number !== undefined) result = -1;
    else if (bv.number !== undefined) result = 1;
    else result = av.text.localeCompare(bv.text, "fa", { numeric: true, sensitivity: "base" });
    return (direction === "desc" ? -result : result) || (a._defaultIndex - b._defaultIndex);
  }

  function rowsOf(table) {
    var body = table.tBodies && table.tBodies[0];
    return body ? Array.prototype.slice.call(body.rows) : [];
  }

  function setRank(table, rows, state) {
    var rankHeader = table.querySelector("thead th[data-rank-column]");
    if (!rankHeader) return;
    var rankColumn = rankHeader.cellIndex;
    rows.forEach(function (row, index) {
      var cell = row.cells[rankColumn];
      if (cell && !cell.dataset.originalValue) cell.dataset.originalValue = cell.innerHTML;
      if (cell) cell.innerHTML = String(index + 1).replace(/[0-9]/g, function (d) { return faDigits[Number(d)]; });
    });
  }

  function apply(table, state) {
    var rows = rowsOf(table);
    if (!rows.length) return;
    if (!state.defaultOrder.length || state.defaultOrder.some(function (row) { return !row.isConnected || row.parentNode !== table.tBodies[0]; })) {
      state.defaultOrder = rows.slice();
      state.defaultOrder.forEach(function (row, index) { row._defaultIndex = index; });
    }
    var ordered = state.direction === "none" ? state.defaultOrder.slice() : rows.slice().sort(function (a, b) { return compareRows(a, b, state.column, state.direction); });
    var body = table.tBodies[0];
    state.applying = true;
    state.ignoreNextMutation = true;
    ordered.forEach(function (row) { body.appendChild(row); });
    setRank(table, ordered, state);
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (header) {
      var active = header.cellIndex === state.column && state.direction !== "none";
      header.setAttribute("aria-sort", active ? (state.direction === "asc" ? "ascending" : "descending") : "none");
      header.dataset.sortState = active ? state.direction : "none";
    });
    state.applying = false;
  }

  function setup(table) {
    if (table.dataset && table.dataset.customSort === "true") return;
    if (tableStates.has(table)) return;
    var headers = table.tHead && table.tHead.rows[0] ? Array.prototype.slice.call(table.tHead.rows[0].cells) : [];
    if (!headers.length || !table.tBodies.length) return;
    var state = { column: -1, direction: "none", defaultOrder: rowsOf(table), applying: false, ignoreNextMutation: false };
    state.defaultOrder.forEach(function (row, index) { row._defaultIndex = index; });
    tableStates.set(table, state);
    headers.forEach(function (header, index) {
      header.tabIndex = 0;
      header.setAttribute("role", "button");
      header.setAttribute("aria-sort", "none");
      header.dataset.sortState = "none";
      header.title = "کلیک: نزولی · کلیک دوباره: صعودی · کلیک سوم: حالت پیش‌فرض";
      function toggle() {
        if (state.column !== index) { state.column = index; state.direction = "desc"; }
        else if (state.direction === "desc") state.direction = "asc";
        else { state.column = -1; state.direction = "none"; }
        apply(table, state);
      }
      header.addEventListener("click", toggle);
      header.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
      });
    });
    var body = table.tBodies[0];
    new MutationObserver(function () {
      if (state.applying) return;
      if (state.ignoreNextMutation) { state.ignoreNextMutation = false; return; }
      var current = rowsOf(table);
      if (state.direction === "none") {
        state.defaultOrder = current;
        state.defaultOrder.forEach(function (row, index) { row._defaultIndex = index; });
      } else {
        current.forEach(function (row, index) { row._defaultIndex = index; });
        apply(table, state);
      }
    }).observe(body, { childList: true });
  }

  function scan(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll("table"), setup);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeDigits: normalizeDigits, parsedValue: parsedValue, compareRows: compareRows };
    return;
  }

  document.addEventListener("DOMContentLoaded", function () {
    scan(document);
    new MutationObserver(function () { scan(document); }).observe(document.body, { childList: true, subtree: true });
  });
})();
