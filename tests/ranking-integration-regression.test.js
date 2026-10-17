const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const app=fs.readFileSync('market/app.js','utf8');
test('dashboard does not overwrite ranking-managed table',()=>{assert.match(app,/rankingManaged/);assert.match(app,/topElement\s*&&\s*!rankingManaged/);});
