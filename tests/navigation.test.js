const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = require('node:path').join(__dirname, '..');
const routes = ['', 'symbols/', 'signals/', 'industries/', 'options/', 'history/', 'portfolio/'];
function links(route) {
 const html=fs.readFileSync(`${root}/market/${route}index.html`,'utf8');
 const nav=html.match(/<nav class="main-nav[^"\n]*"[^>]*>([\s\S]*?)<\/nav>/)[1];
 return [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m=>[m[2],new URL(m[1],`https://example.org/market/${route}`).pathname+new URL(m[1],`https://example.org/market/${route}`).hash]);
}
test('all market headers retain the same complete ordered navigation and destinations',()=>{
const expected=links('');
assert.equal(expected.length,10);
for(const route of routes) assert.deepEqual(links(route),expected,route||'overview');
});

test('median history route declares the shared favicon instead of falling back to /favicon.ico',()=>{
const html=fs.readFileSync(`${root}/market/median-history/index.html`,'utf8');
assert.match(html,/rel="icon"[^>]+href="\.\.\/\.\.\/assets\/market-pulse\.svg"/);
});

