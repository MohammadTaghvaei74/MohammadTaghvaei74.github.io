const assert = require('assert');
const fs = require('fs');
const ui = fs.readFileSync('market/observation-ui.js', 'utf8');
// Regression: after the exchange closes, a same-session snapshot is still
// fresh under the session-aware freshness contract, so the preset must remain clickable.
assert.match(ui, /const safe=F\.freshness\(r\)\.status==='fresh'/,
  'industry preset gate must use session-aware freshness, not rangeState');
assert.match(ui, /button\.disabled=blocksPreset/);
assert.match(fs.readFileSync('market/observation-safety.js','utf8'), /expected\.live \? now-parsed<=60000 : parsed>=expected\.expected-60000/,
  'stale-data session-close protection must remain intact');
console.log('money-where preset regression: PASS');
