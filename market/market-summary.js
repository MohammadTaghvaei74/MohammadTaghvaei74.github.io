/* Read-only overview summary and market-risk indicator for the accepted snapshot. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else { root.SorenaMarketSummary=api; api.mount(root); }
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 function number(v){return (typeof v==='number'||(typeof v==='string'&&v.trim()!==''))&&Number.isFinite(Number(v))?Number(v):null;}
 function model(d){d=d||{};const m=d.market||{};return {median:number(m.median),buy:number(m.buy_value_hmt),sell:number(m.sell_value_hmt),observation:d.observed_at||d.timestamp||null};}
 function riskModel(d){
  const m=d&&d.market||{},intraday=Array.isArray(d&&d.intraday)?d.intraday:[],daily=Array.isArray(d&&d.daily)?d.daily:[],qRows=Array.isArray(d&&d.queue_intraday)?d.queue_intraday:[];
  const n=number,bucket=(v,t)=>{if(v===null)return null;for(let i=0;i<t.length;i++)if(t[i](v))return i+1;return t.length+1},normalize=(r,max)=>r===null?null:(r-1)/(max-1);
  const medianRank=bucket(n(m.median),[v=>v>3,v=>v>1,v=>v>-1,v=>v>-2,v=>v>-3]);
  const recent=intraday.map(x=>n(x.median_score)).filter(x=>x!==null),sma=(a,k)=>a.length<k?null:a.slice(-k).reduce((s,v)=>s+v,0)/k;
  const s5=sma(recent,5),s20=sma(recent,Math.min(20,recent.length)),trendRank=bucket(s5!==null&&s20!==null?s5-s20:null,[v=>v>.15,v=>v>-.15]);
  const today=String(m.timestamp||(d&&d.generated_at)||'').slice(0,10),complete=daily.filter(x=>x&&x.complete&&x.trading_date&&x.trading_date!==today&&n(x.final_turnover_toman)!==null),vals=complete.map(x=>n(x.final_turnover_toman));
  const baselineDays=Math.min(vals.length,5),baseline20Days=Math.min(vals.length,20);
  const ma5=baselineDays?vals.slice(0,baselineDays).reduce((s,v)=>s+v,0)/baselineDays:null;
  const ma20=baseline20Days?vals.slice(0,baseline20Days).reduce((s,v)=>s+v,0)/baseline20Days:null;
  const currentTurnover=(Array.isArray(d&&d.stocks)?d.stocks:[]).map(x=>n(x&&x.trade_value_toman)).filter(x=>x!==null).reduce((s,v)=>s+v,0);
  const turnoverRatio=currentTurnover>0&&ma20>0?currentTurnover/ma20:null;
  const turnoverRank=bucket(turnoverRatio,[v=>v>1.2,v=>v>1,v=>v>.8]);
  const q=qRows.length?qRows[qRows.length-1]:null,queueRatio=q&&ma5&&ma5>0?(n(q.buy_value_hmt)-n(q.sell_value_hmt))/(ma5/1e12):null,queueRank=bucket(queueRatio,[v=>v>.20,v=>v>.05,v=>v>-.05,v=>v>-.20]);
  if([medianRank,trendRank,turnoverRank,queueRank].some(x=>x===null))return {value:null,status:`پوشش ناکافی؛ ${vals.length} روز معتبر از ۵ روز لازم`};
  const value=Math.max(0,Math.min(100,28*normalize(medianRank,6)+24*normalize(trendRank,3)+24*normalize(turnoverRank,4)+24*normalize(queueRank,5)));
  const coverage=vals.length<5?` · پوشش ${vals.length} روز معتبر از ۵ روز لازم`:'';
  return {value,status:(value<=30?'پایین':value<=65?'متوسط':'بالا')+coverage,components:{median:medianRank,trend:trendRank,turnover:turnoverRank,queue:queueRank,coverage_days:vals.length}};
 }
 function mount(win){
  if(!win||!win.document||win.__sorenaSummaryMounted)return;win.__sorenaSummaryMounted=true;
  const doc=win.document;let host=null,last=null;
  function render(){
   if(!host)return;const m=model(last),risk=riskModel(last),fmt=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2}),state=risk.value===null?'loading':risk.value<=30?'low':risk.value<=65?'medium':'high';
   const riskHost=doc.querySelector('#marketRisk');if(riskHost){riskHost.dataset.state=state;riskHost.querySelector('[data-market-risk-value]').textContent=risk.value===null?'—':fmt.format(risk.value);riskHost.querySelector('[data-market-risk-status]').textContent=risk.status;}
   const meter=doc.querySelector('#marketRiskMeter');if(meter){meter.dataset.state=state;const marker=meter.querySelector('[data-risk-marker]'),value=meter.querySelector('[data-risk-meter-value]');marker.style.right='auto';marker.style.left=risk.value===null?'0%':risk.value+'%';value.textContent=risk.value===null?'—':fmt.format(risk.value);}
   ['median','buy','sell'].forEach(k=>{const e=host.querySelector('[data-summary-value="'+k+'"]');e.textContent=m[k]===null?'ناموجود':fmt.format(m[k]);e.dataset.available=String(m[k]!==null);});
   host.querySelector('.market-summary-source').textContent=last?'منبع: دادهٔ پذیرفته‌شدهٔ بازار؛ زمان و کیفیت در نشان وضعیت نمودارهای همین بخش.':'در انتظار دریافت دادهٔ بازار؛ مقادیر هنوز قابل تأیید نیستند.';host.dataset.state=last?'received':'loading';
  }
  function boot(){
   const overview=doc.querySelector('#overview'),pair=doc.querySelector('.daily-overview-pair');if(!overview||!pair)return;host=doc.querySelector('#market-summary');if(host)return;
   host=doc.createElement('section');host.id='market-summary';host.className='market-summary';host.setAttribute('aria-label','خلاصه بازار');const dl=doc.createElement('dl');
   [['median','میانه امتیاز بازار'],['buy','ارزش صف خرید · همت'],['sell','ارزش صف فروش · همت']].forEach(([key,label])=>{const item=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.dataset.summaryValue=key;item.append(dt,dd);dl.append(item);});
   const meter=doc.createElement('div');meter.id='marketRiskMeter';meter.className='market-risk-meter';meter.setAttribute('aria-label','مقیاس ریسک بازار از صفر تا صد');meter.innerHTML='<div class="market-risk-meter-heading"><span>ریسک بازار</span><strong data-risk-meter-value>—</strong><em>صفر مساعدترین · ۱۰۰ نامساعدترین</em></div><div class="market-risk-track"><span class="market-risk-marker" data-risk-marker></span></div><div class="market-risk-scale"><span>۱۰۰ · بالا</span><span>۵۰ · متوسط</span><span>۰ · پایین</span></div>';
   const note=doc.createElement('p');note.className='market-summary-source';host.append(dl,meter,note);pair.before(host);render();
  }
  win.addEventListener('market:snapshot',e=>{if(e.detail&&e.detail.market){last=e.detail;render();}});if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
 }
 return {model,riskModel,mount};
});
