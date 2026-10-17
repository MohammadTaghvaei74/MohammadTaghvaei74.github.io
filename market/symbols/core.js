'use strict';
const DIGITS='۰۱۲۳۴۵۶۷۸۹';
function number(v){if(v===null||v===undefined||typeof v==='boolean'||typeof v==='object'||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null}
function text(v){return (v===null||v===undefined||typeof v==='boolean'||typeof v==='object')?'':String(v)}
function normalize(v){return text(v).normalize('NFKC').replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[ۀة]/g,'ه').replace(/[\u064B-\u065F\u0670]/g,'').replace(/ـ/g,'').replace(/\u200c/g,'').replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g,'').toLowerCase()}
function digits(v){return text(v).replace(/[0-9]/g,d=>DIGITS[d])}
function format(v,d=2){const n=number(v);return n===null?'—':digits(n.toLocaleString('en-US',{maximumFractionDigits:d}))}
function integer(v){const n=number(v);return n===null?'—':digits(Math.round(n).toLocaleString('en-US'))}
function indexHistory(history){const m=new Map();for(const row of Array.isArray(history&&history.rows)?history.rows:[]){if(!row||!text(row.symbol))continue;if(!m.has(row.symbol))m.set(row.symbol,[]);m.get(row.symbol).push(row)}for(const rows of m.values())rows.sort((a,b)=>text(a.day).localeCompare(text(b.day)));return m}
function chartSeries(rows){return ['mean','median','last'].map(key=>({key,values:rows.map(r=>{const n=number(r&&r[key]);return n!==null&&Math.abs(n)<=20?n:null})}))}
function buildUniverse(market,history){const hm=indexHistory(history), src=Array.isArray(market&&market.stocks)?market.stocks:[]; const all=new Map(); src.forEach(current=>{if(current&&text(current.symbol))all.set(current.symbol,{symbol:current.symbol,current,history:hm.get(current.symbol)||[]})}); for(const [symbol,rows] of hm)if(!all.has(symbol))all.set(symbol,{symbol,current:null,history:rows}); const ranked=[...all.values()].filter(x=>number(x.current&&x.current.score)!==null).sort((a,b)=>number(b.current.score)-number(a.current.score)); let last=null; ranked.forEach((x,i)=>{if(number(x.current.score)!==last){last=number(x.current.score);x.rank=i+1}else x.rank=ranked.find(y=>number(y.current.score)===last).rank}); all.forEach(x=>{if(!('rank' in x))x.rank=null}); return {bySymbol:all,rankedCount:ranked.length};}
function thresholdRows(stocks){return [3,-3,4,-4].map(t=>({threshold:t,rows:stocks.filter(s=>number(s&&s.last_pct)!==null&&Math.abs(number(s.last_pct))>=Math.abs(t))}))}
function csvEscape(v){const s=text(v);return /^[=+\-@]/.test(s)?`'${s}`:s}
function csv(rows){return rows.map(r=>r.map(v=>`"${csvEscape(v).replace(/"/g,'""')}"`).join(',')).join('\r\n')}
const api={buildUniverse,number,text,normalize,digits,format,integer,indexHistory,chartSeries,thresholdRows,csvEscape,csv};
if(typeof module!=='undefined')module.exports=api;if(typeof window!=='undefined')window.SymbolCore=api;
