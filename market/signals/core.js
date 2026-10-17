(function(root){
'use strict';
function validate(data){
 if(!data||data.schema_version!==1||!['ok','unavailable'].includes(data.status)||!Array.isArray(data.items)||data.count!==data.items.length||typeof data.has_more!=='boolean')throw Error('Invalid signal feed');
 const ids=new Set();
 for(const row of data.items){
  if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||typeof row.text!=='string'||typeof row.experimental!=='boolean'||typeof row.timestamp!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(row.timestamp)||!Number.isFinite(Date.parse(row.timestamp)))throw Error('Invalid signal item');
  ids.add(row.id);
 }
 return data;
}
function timeLabel(row, now=Date.now()){return now-Date.parse(row.timestamp)>36*60*60*1000?'هشدار تاریخی':'هشدار ثبت‌شده';}
function select(rows, query='', category='all'){const q=String(query||'').trim();return rows.filter(r=>(category==='all'||r.category===category)&&(!q||String(r.text||'').includes(q)));}
const api={validate,timeLabel,select}; if(typeof module!=='undefined')module.exports=api;else root.SignalCore=api;
})(globalThis);
