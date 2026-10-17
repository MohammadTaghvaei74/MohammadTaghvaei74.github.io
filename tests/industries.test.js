"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modulePath = path.join(__dirname, "../market/industries/industries.js");
const Explorer = fs.existsSync(modulePath) ? require(modulePath) : {};
const stocks = [
  { symbol: "ب", industry: "بانک‌ها", score: 8, last_pct: 1, trade_value_toman: 2 },
  { symbol: "الف", industry: "بانک‌ها", score: 8, last_pct: null, trade_value_toman: null },
  { symbol: "ج", industry: "فلزات", score: 4, last_pct: -1, trade_value_toman: 1000000000 },
  { symbol: "د", industry: "فلزات", score: 6, last_pct: 2, trade_value_toman: 3000000000 },
  { symbol: "پرت", industry: "فلزات", score: 100 },
];
test("groups every stock, ranks by median not mean, previews best with stable symbol ties", () => {
  assert.equal(typeof Explorer.buildIndustries, "function", "industry grouping must exist");
  const result = Explorer.buildIndustries({ stocks, industries: [{industry: "legacy"}] });
  assert.deepEqual(result.map(x => x.name), ["بانک‌ها", "فلزات"]);
  assert.equal(result[0].score, 8);
  assert.deepEqual(result[0].stocks.map(x => x.symbol), ["الف", "ب"]);
  assert.equal(result[0].best.symbol, "الف");
  assert.equal(result[1].score, 6);
  assert.equal(result[1].rank, 2);
});
