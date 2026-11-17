const assert = require('assert');
const fs = require('fs');
const ui = fs.readFileSync('market/observation-ui.js', 'utf8');
const app = fs.readFileSync('market/app.js', 'utf8');
const comprehensive = fs.readFileSync('market/comprehensive-table.js', 'utf8');
// Same-session snapshots remain usable after close, while genuinely stale data blocks the preset.
assert.match(ui, /const safe=F\.freshness\(r\)\.status==='fresh'/,
  'industry preset gate must use session-aware freshness, not rangeState');
assert.match(ui, /const wasSelected=button\.getAttribute\('aria-pressed'\)==='true'/,
  'expiry gate must capture selected state before changing aria state');
assert.match(ui, /observation:preset-unavailable/,
  'expiry gate must ask the renderer to clear selected preset filters');
assert.match(ui, /button\.disabled=blocksPreset/);
assert.match(app, /observation:preset-unavailable/,
  'renderer must handle expiry reset events');
assert.match(comprehensive, /activePreset === name/,
  'clicking an active comprehensive preset must reset it');
assert.match(comprehensive, /activePreset = null; syncFilters\(true\)/,
  'comprehensive preset reset must clear filters and rerender');
assert.match(fs.readFileSync('market/observation-safety.js','utf8'), /expected\.live \? now-parsed<=60000 : parsed>=expected\.expected-60000/,
  'stale-data session-close protection must remain intact');
console.log('money-where preset regression: PASS');
