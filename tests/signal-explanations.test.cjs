const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const core=require('../market/signals/core.js');
test('explicit explanation and honest legacy fallback',()=>{
 assert.equal(typeof core.explanation,'function');
 assert.equal(core.feedUrl('mohammadtaghvaei74.github.io'),'https://94-101-184-98.sslip.io/market/data/signals.json');
 assert.equal(core.feedUrl('localhost'),'../data/signals.json');
 assert.equal(core.explanation({explanation:{text:'شاهد ثبت‌شده'}}),'شاهد ثبت‌شده');
 assert.match(core.explanation({category:'leader',text:'نسبت به میانگین: ۲'}),/علت صدور نیست/);
 assert.match(core.explanation({category:'other',text:'کاهش صف ۴۰٪'}),/کاهش صف ۴۰٪/);
});
test('four wrapping columns, today filter and minute refresh survive',()=>{
 const html=fs.readFileSync('market/signals/index.html','utf8');const js=fs.readFileSync('market/signals/signals.js','utf8');const css=fs.readFileSync('market/signals/signals.css','utf8');
 assert.match(html,/>توضیحات<\/th>/);assert.match(js,/colspan="4"/);assert.match(js,/tdExplanation.textContent/);
 assert.match(js,/typeof window.ObservationSafety.accept/);
 assert.match(js,/ObservationSafety.todayEvents/);assert.match(js,/60000/);assert.match(css,/explanation-cell/);
});
