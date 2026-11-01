/* Read-only overview summary of the exact accepted market snapshot. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else { root.SorenaMarketSummary=api; api.mount(root); }
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 function number(v){return (typeof v==='number'||(typeof v==='string'&&v.trim()!==''))&&Number.isFinite(Number(v))?Number(v):null;}
 function model(d){
  d=d||{};const m=d.market||{};
  return {median:number(m.median),buy:number(m.buy_value_hmt),sell:number(m.sell_value_hmt),observation:d.observed_at||d.timestamp||null};
 }
 function mount(win){
  if(!win||!win.document||win.__sorenaSummaryMounted)return;
  win.__sorenaSummaryMounted=true;
  const doc=win.document;let host=null,last=null;
  function render(){
   if(!host)return;
   const m=model(last),fmt=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2});
   ['median','buy','sell'].forEach(k=>{
    const e=host.querySelector('[data-summary-value="'+k+'"]');
    e.textContent=m[k]===null?'ناموجود':fmt.format(m[k]);
    e.dataset.available=String(m[k]!==null);
   });
   // The authoritative section clocks remain visible in the existing chart cards.
   const stamp=host.querySelector('.market-summary-source');
   stamp.textContent=last?'منبع: دادهٔ پذیرفته‌شدهٔ بازار؛ زمان و کیفیت در نشان وضعیت نمودارهای همین بخش.':'در انتظار دریافت دادهٔ بازار؛ مقادیر هنوز قابل تأیید نیستند.';
   host.dataset.state=last?'received':'loading';
  }
  function boot(){
   const overview=doc.querySelector('#overview'),pair=doc.querySelector('.daily-overview-pair');
   if(!overview||!pair)return;
   host=doc.querySelector('#market-summary');if(host)return;
   host=doc.createElement('section');host.id='market-summary';host.className='market-summary';host.setAttribute('aria-label','خلاصه بازار');
   const dl=doc.createElement('dl');
   [['median','میانه امتیاز بازار'],['buy','ارزش صف خرید · همت'],['sell','ارزش صف فروش · همت']].forEach(([key,label])=>{
    const item=doc.createElement('div'),dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.dataset.summaryValue=key;item.append(dt,dd);dl.append(item);
   });
   const note=doc.createElement('p');note.className='market-summary-source';
   host.append(dl,note);pair.before(host);render();
  }
  win.addEventListener('market:snapshot',e=>{if(e.detail&&e.detail.market){last=e.detail;render();}});
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
 }
 return {model,mount};
});
