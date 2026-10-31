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
function explanation(row){if(row.explanation&&typeof row.explanation.text==='string'&&row.explanation.text.trim())return row.explanation.text;if(row.category==='leader')return 'جزئیات دقیق تغییر امتیاز، بازه و شرط صدور ثبت نشده است. فاصله از میانگین علت صدور نیست.';return 'جزئیات ثبت‌شده در پیام (آستانه یا بازهٔ ذکرنشده قابل تأیید نیست):\n'+String(row.text||'جزئیات ثبت نشده است.');}
function feedUrl(host){return host==='mohammadtaghvaei74.github.io'?'https://94-101-184-98.sslip.io/market/data/signals.json':'../data/signals.json';}
const api={validate,timeLabel,select,explanation,feedUrl}; if(typeof module!=='undefined')module.exports=api;else root.SignalCore=api;
})(globalThis);
