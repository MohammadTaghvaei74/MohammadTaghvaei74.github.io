(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IndustryExplorer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var FA = "۰۱۲۳۴۵۶۷۸۹";
  function finite(v) { return v !== null && v !== undefined && v !== "" && !(typeof v === "string" && v.trim() === "") && typeof v !== "boolean" && typeof v !== "object" && Number.isFinite(typeof v === "number" ? v : Number(v)); }
  function num(v) { return finite(v) ? Number(v) : null; }
  function normalizeFa(v) { return String(v == null ? "" : v).replace(/[\u064A\u0649]/g, "ی").replace(/[\u0643]/g, "ک").replace(/[\u200c\u200f\u0640]/g, "").replace(/[\s\-–—_]+/g, "").replace(/[ًٌٍَُِّْ]/g, "").toLocaleLowerCase("fa-IR"); }
  function median(values) { var a = values.filter(finite).map(Number).sort(function(a,b){return a-b;}); if (!a.length) return null; var m=Math.floor(a.length/2); return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
  function readStocks(snapshot) { if (!snapshot || !Array.isArray(snapshot.stocks)) throw new Error("فیلد stocks در snapshot وجود ندارد."); return snapshot.stocks.map(function (row) { if (!row || typeof row !== "object" || !row.symbol || !row.industry || (row.score !== null && row.score !== undefined && !finite(row.score))) throw new Error("ردیف سهام ناقص یا دارای عدد نامعتبر است."); return Object.assign({}, row, { score: num(row.score) }); }); }
  function buildIndustries(snapshot) {
    var groups = new Map();
    readStocks(snapshot).forEach(function (stock) {
      var key = normalizeFa(stock.industry); if (!key) return;
      if (!groups.has(key)) groups.set(key, { name: String(stock.industry), stocks: [] });
      groups.get(key).stocks.push(stock);
    });
    var result = Array.from(groups.values()).map(function (group) {
      group.stocks.sort(function(a,b){ return (b.score === null ? -Infinity : b.score) - (a.score === null ? -Infinity : a.score) || String(a.symbol).localeCompare(String(b.symbol), "fa"); });
      var scores = group.stocks.map(function(s){return s.score;});
      return { name: group.name, score: median(scores), count: group.stocks.length, stocks: group.stocks, best: group.stocks[0] || null };
    }).sort(function(a,b){ return b.score-a.score || normalizeFa(a.name).localeCompare(normalizeFa(b.name), "fa"); });
    result.forEach(function (g,i) { g.rank=i+1; });
    return result;
  }
  function filterIndustries(groups, query) { var q=normalizeFa(query); if(!q) return groups.slice(); return groups.filter(function(g){return normalizeFa(g.name).indexOf(q)>=0 || g.stocks.some(function(s){return normalizeFa(s.symbol).indexOf(q)>=0;});}); }
  function searchSelection(groups, query, fallback) {
    var visible=filterIndustries(groups, query);
    return {visible:visible, selected:visible.includes(fallback) ? fallback : visible[0] || null};
  }
  function sortStocks(stocks, direction) { return stocks.slice().sort(function(a,b){ var av=a.score===null?-Infinity:a.score, bv=b.score===null?-Infinity:b.score; return (direction === "asc" ? av-bv : bv-av) || String(a.symbol).localeCompare(String(b.symbol), "fa"); }); }
  function faDigits(v) { return String(v).replace(/[0-9]/g, function(d){return FA[d];}); }
  function formatToman(value) { var n=num(value); if(n===null) return "—"; return faDigits((n/1e9).toLocaleString("fa-IR",{maximumFractionDigits:1,minimumFractionDigits:1}))+" B"; }
  function formatNumber(value, digits) { var n=num(value); return n===null ? "—" : faDigits(n.toLocaleString("fa-IR",{maximumFractionDigits:digits == null ? 2 : digits,minimumFractionDigits:digits == null ? 0 : digits})); }
  function rankPercent(value,total) { var n=num(value),t=num(total); return n===null||t===null||t<=0 ? "—" : faDigits(Math.ceil(n/t*100))+"٪"; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"})[c];}); }
  function sourceState(timestamp, now, maxAge, error) { if(error) return {kind:"error", label:"خطا در دریافت؛ آخرین داده حفظ شده"}; if(!timestamp || Number.isNaN(new Date(timestamp).getTime())) return {kind:"error",label:"زمان منبع نامعتبر است"}; return now-new Date(timestamp).getTime() > maxAge ? {kind:"stale",label:"داده قدیمی است"} : {kind:"fresh",label:"داده تازه"}; }
  return { searchSelection:searchSelection, finite:finite, normalizeFa:normalizeFa, median:median, readStocks:readStocks, buildIndustries:buildIndustries, filterIndustries:filterIndustries, sortStocks:sortStocks, formatToman:formatToman, formatNumber:formatNumber, rankPercent:rankPercent, escapeHtml:escapeHtml, sourceState:sourceState };
});

/* istanbul ignore next */
if (typeof window !== "undefined") {
(function () {
  var E=window.IndustryExplorer, state={groups:[], visible:[], selected:null, direction:"desc", last:null, error:null};
  var $=function(id){return document.getElementById(id);};
  var text=function(el,value){if(el)el.textContent=value;};
  function timeoutFetch(url,ms){return Promise.race([fetch(url),new Promise(function(_,reject){setTimeout(function(){reject(new Error("timeout"));},ms);})]);}
  function renderStatus(snapshot, error, loading) { var status=E.sourceState(snapshot && (snapshot.market && snapshot.market.timestamp || snapshot.generated_at), Date.now(), 60000, error); if(loading) status={kind:"loading",label:"در حال دریافت داده…"}; var el=$("sourceStatus"); text(el,status.label+(snapshot && (snapshot.market&&snapshot.market.timestamp||snapshot.generated_at)?" · "+new Date(snapshot.market&&snapshot.market.timestamp||snapshot.generated_at).toLocaleString("fa-IR"):"")); if(el)el.dataset.state=status.kind; var retry=$("retry"); if(retry)retry.hidden=!error; }
  function renderCards(){var host=$("industryCards"); if(!state.visible.length){host.innerHTML='<div class="empty" role="status">برای این جست‌وجو صنعتی پیدا نشد.</div>';return;} host.innerHTML=state.visible.map(function(g){var best=g.best;return '<button class="industry-card '+(state.selected&&state.selected.name===g.name?'selected':'')+'" type="button" data-industry="'+E.escapeHtml(g.name)+'" aria-pressed="'+(state.selected&&state.selected.name===g.name)+'"><span class="card-rank">جایگاه '+E.rankPercent(g.rank,state.groups.length)+'</span><strong>'+E.escapeHtml(g.name)+'</strong><span class="card-score">'+E.formatNumber(g.score,1)+'</span><span class="card-meta">'+E.formatNumber(g.count,0)+' نماد · برترین: <b>'+E.escapeHtml(best&&best.symbol||"—")+'</b></span></button>';}).join(""); host.querySelectorAll("[data-industry]").forEach(function(b){b.addEventListener("click",function(){state.selected=state.groups.find(function(g){return g.name===b.dataset.industry;});render();});});}
  function renderTable(){var g=state.selected, body=$("stockRows"); if(!g){body.innerHTML="";text($("#selectedIndustry"),"انتخاب صنعت");return;} text($("#selectedIndustry"),g.name); text($("#industryCaption"),"جایگاه اصلی "+E.rankPercent(g.rank,state.groups.length)+" · "+E.formatNumber(g.count,0)+" نماد"); var rows=E.sortStocks(g.stocks,state.direction); body.innerHTML=rows.map(function(s,i){var href='../symbols/?symbol='+encodeURIComponent(s.symbol);return '<tr><td>'+E.rankPercent(i+1,rows.length)+'</td><th scope="row"><a class="stock-symbol-link" href="'+href+'" aria-label="مشاهده جزئیات '+E.escapeHtml(s.symbol)+'">'+E.escapeHtml(s.symbol)+'</a></th><td>'+E.formatNumber(s.score,1)+'</td><td class="'+(E.finite(s.last_pct)&&s.last_pct>=0?'up':'down')+'">'+(E.finite(s.last_pct)?E.formatNumber(s.last_pct,2)+'٪':'—')+'</td><td>'+E.formatToman(s.trade_value_toman)+'</td></tr>';}).join("");}
  function render(){renderCards();renderTable();text($("resultCount"),E.formatNumber(state.visible.length,0)+" صنعت");}
  function applySearch(){var found=E.searchSelection(state.groups,$("search").value,state.selected);state.visible=found.visible;state.selected=found.selected;render();}
  function load(){renderStatus(state.last,state.error,true); return timeoutFetch("../data/market.json",10000).then(function(r){if(!r.ok)throw new Error("http");return r.json();}).then(function(data){state.last=data;state.error=null;state.groups=E.buildIndustries(data);state.visible=state.groups.slice();var requested=new URLSearchParams(window.location.search).get("industry");state.selected=(requested&&state.groups.find(function(g){return g.name===requested;}))||state.selected&&state.groups.find(function(g){return g.name===state.selected.name;})||state.groups[0]||null;renderStatus(data,null,false);render();}).catch(function(err){state.error=err;renderStatus(state.last,err,false);if(!state.last){state.groups=[];state.visible=[];state.selected=null;render();} });}
  document.addEventListener("DOMContentLoaded",function(){ $("search").addEventListener("input",applySearch);$("sort").addEventListener("change",function(){state.direction=$("sort").value;renderTable();});var retry=$("retry");if(retry)retry.addEventListener("click",load);$("refresh").addEventListener("click",load);load();setInterval(load,60000); });
})();
}
