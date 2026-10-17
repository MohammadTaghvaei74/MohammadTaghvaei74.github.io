'use strict';
(function(root){
function number(v){if(v===null||v===undefined||typeof v==='boolean'||typeof v==='object'||String(v).trim()==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
function text(v){return v===null||v===undefined||typeof v==='boolean'||typeof v==='object'?'':String(v);}
function normalize(v){return text(v).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[ۀة]/g,'ه').replace(/[\u064B-\u065F\u0670ـ\u200c\s]/g,'').replace(/[۰-۹]/g,function(d){return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d));}).replace(/[٠-٩]/g,function(d){return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));}).toLowerCase();}
function digits(v){return text(v).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d];});}
function format(v,d){var n=number(v);return n===null?'—':n.toLocaleString('fa-IR',{maximumFractionDigits:d===undefined?2:d});}
function integer(v){return format(v,0);}
function indexHistory(h){var m=new Map();(Array.isArray(h&&h.rows)?h.rows:[]).forEach(function(r){if(!r||!text(r.symbol))return;if(!m.has(r.symbol))m.set(r.symbol,[]);m.get(r.symbol).push(r);});m.forEach(function(rows){rows.sort(function(a,b){return text(a.day).localeCompare(text(b.day));});});return m;}
function buildUniverse(market,h){var hm=indexHistory(h),full=Array.isArray(market&&market.stocks),src=full?market.stocks:(Array.isArray(market&&market.top_stocks)?market.top_stocks:[]),all=new Map();src.forEach(function(r){if(r&&typeof r.symbol==='string'&&r.symbol.trim())all.set(r.symbol,{symbol:r.symbol,current:r,history:hm.get(r.symbol)||[]});});(Array.isArray(h&&h.symbols)?h.symbols:[]).concat(Array.from(hm.keys())).forEach(function(s){if(typeof s==='string'&&s.trim()&&!all.has(s))all.set(s,{symbol:s,current:null,history:hm.get(s)||[]});});var ranked=Array.from(all.values()).filter(function(x){return number(x.current&&x.current.score)!==null;}).sort(function(a,b){return number(b.current.score)-number(a.current.score)||a.symbol.localeCompare(b.symbol,'fa');}),last=null,rank=null;ranked.forEach(function(x,i){if(number(x.current.score)!==last){last=number(x.current.score);rank=i+1;}x.rank=rank;});all.forEach(function(x){if(!('rank' in x))x.rank=null;});return {bySymbol:all,rankedCount:ranked.length,partial:!full};}
function chartSeries(rows){return ['mean','median','last'].map(function(key){return {key:key,values:rows.map(function(r){var n=number(r&&r[key]);return n!==null&&Math.abs(n)<=20?n:null;})};});}
function path(values,x,y){var open=false;return values.map(function(v,i){if(number(v)===null){open=false;return '';}var s=(open?'L':'M')+x(i)+','+y(v);open=true;return s;}).filter(Boolean).join(' ');}
function thresholds(values,leveraged){var t=leveraged?4:3,ns=values.map(number).filter(function(v){return v!==null;});return [t,-t].filter(function(v){return ns.some(function(n){return v>0?n>=v:n<=v;});});}
function csvEscape(v){var s=text(v);return typeof v==='string'&&/^[\s]*[=+\-@\t\r]/.test(s)?"'"+s:s;}
function csv(rows){return rows.map(function(r){return r.map(function(v){return '"'+csvEscape(v).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');}
var api={number:number,text:text,normalize:normalize,digits:digits,format:format,integer:integer,indexHistory:indexHistory,buildUniverse:buildUniverse,chartSeries:chartSeries,path:path,thresholds:thresholds,csvEscape:csvEscape,csv:csv};
if(typeof module!=='undefined')module.exports=api;if(root)root.SymbolCore=api;
})(typeof window!=='undefined'?window:null);
