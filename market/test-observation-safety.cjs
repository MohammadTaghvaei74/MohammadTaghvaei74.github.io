const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('old replay events never appear as todays signals', () => {
 const F=require(modulePath), now=Date.parse('2026-10-31T10:00:00+03:30');
 assert.deepEqual(F.todayEvents([{timestamp:'2026-10-28T12:20:00+03:30'}],now),[]);
 assert.equal(F.todayEvents([{timestamp:'2026-10-31T09:20:00+03:30'}],now).length,1);
});
test('portfolio gate checks actual positive-value holdings, not unrelated stale catalog',()=>{
 const F=require(modulePath), now=Date.parse('2026-10-31T10:00:00+03:30');
 assert.equal(F.portfolioSafe([{value:1,row:{timestamp:'2026-10-31T09:59:30+03:30'}}],now),true);
 assert.equal(F.portfolioSafe([{value:1,row:{historyTimestamp:'2026-10-28T12:30:00+03:30'}}],now),false);
 assert.equal(F.portfolioSafe([{value:1,row:{score:5}}],now),false);
});
test('mixed future rows cannot enable an aggregate',()=>{
 const F=require(modulePath),now=Date.parse('2026-10-31T10:00:00+03:30');
 assert.notEqual(F.rangeState(F.range([{timestamp:'2026-10-31T09:59:30+03:30'},{timestamp:'2026-11-01T10:00:00+03:30'}]),now),'fresh');
});
const modulePath = path.join(__dirname, 'observation-safety.js');
test('publication time cannot make an unknown observation fresh', () => {
  assert.ok(fs.existsSync(modulePath), 'observation safety module must exist');
  const F = require(modulePath);
  assert.equal(F.observation({generated_at:'2026-10-31T10:00:00+03:30'}), null);
  assert.equal(F.state(null, Date.parse('2026-10-31T10:00:00+03:30')), 'unknown');
});
test('old day, intraday stall, future and mixed/unknown rows fail closed', () => {
 const F = require(modulePath), now = Date.parse('2026-10-31T10:00:00+03:30');
 assert.equal(F.state('2026-10-28T12:30:00+03:30', now), 'stale');
 assert.equal(F.state('2026-10-31T09:57:59+03:30', now), 'stale');
 assert.equal(F.state('2026-10-31T09:59:30+03:30', now), 'fresh');
 assert.equal(F.state('2026-10-31T10:01:00+03:30', now), 'unknown');
 assert.equal(F.range([{timestamp:'2026-10-31T09:59:30+03:30'},{}]).unknown, true);
 assert.equal(F.range([{timestamp:'2026-10-28T12:30:00+03:30'},{timestamp:'2026-10-31T09:59:30+03:30'}]).first, '2026-10-28T12:30:00+03:30');
});
