const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const C=require('../market/symbols/core.js');const source=fs.readFileSync('market/symbols/symbols.js','utf8');
test('universe rejects non-string symbols before locale sorting',()=>{const u=C.buildUniverse({stocks:[{symbol:123,score:2},{symbol:'ABC',score:1}]},{rows:[]});assert.deepEqual([...u.bySymbol.keys()],['ABC']);});
test('loader feature-detects AbortController and wraps synchronous fetch setup',()=>{assert.match(source,/typeof AbortController|typeof window\.AbortController/);assert.match(source,/Promise\.resolve\(\)\.then/);});
test('leveraged membership guards malformed entries',()=>{assert.match(source,/r&&r\.symbol===item\.symbol/);});
