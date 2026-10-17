const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
test('missing and mismatched signal feeds are rejected, not empty healthy feeds',()=>{
 const p=path.join(__dirname,'../market/signals/core.js');assert.ok(fs.existsSync(p),'signal validator missing');
 const c=require(p);assert.throws(()=>c.validate({}));assert.throws(()=>c.validate({schema_version:1,status:'ok',items:[],count:1}));
 assert.equal(c.validate({schema_version:1,status:'ok',items:[],count:0,has_more:false}).count,0);
});
test('old signals are historical and search/category preserve distinct events',()=>{
 const c=require('../market/signals/core.js');
 const rows=[{id:'a',timestamp:'2026-10-14T10:00:00+03:30',text:'وبملت تقاضا',category:'leader',experimental:false},{id:'b',timestamp:'2026-10-14T11:00:00+03:30',text:'وضعیت بازار',category:'market',experimental:true}];
 assert.equal(c.timeLabel(rows[0],Date.parse('2026-10-16T10:00:00+03:30')),'هشدار تاریخی');
 assert.equal(c.timeLabel(rows[0],Date.parse('2026-10-14T10:01:00+03:30')),'هشدار ثبت‌شده');
 assert.deepEqual(c.select(rows,'وبملت','leader').map(r=>r.id),['a']);
 assert.deepEqual(c.select(rows,'','market').map(r=>r.id),['b']);
 assert.deepEqual(c.select(rows,'ناموجود','all'),[]);
});
