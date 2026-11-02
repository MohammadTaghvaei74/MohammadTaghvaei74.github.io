/* Runs before page loaders; observes the exact consumed response, never a second fetch. */
(function () {
 'use strict';
 const F=window.ObservationSafety, feeds={}, ranges=new WeakMap(), pending=new WeakMap();
 F.accept=function(data){const path=data&&pending.get(data);if(path){feeds[path]=data;pending.delete(data);schedule();}};
 const originalFetch=window.fetch;
 let scheduled=false;
 const unknown=()=>({first:null,last:null,unknown:true});
 const rows=(data)=>Array.isArray(data)?data:[];
 function range(data, historical=false) {
   if (!Array.isArray(data)) return unknown();
   if (!ranges.has(data)) ranges.set(data,{});
   const cache=ranges.get(data), key=historical?'history':'live';
   if (!cache[key]) cache[key]=F.range(data,r=>historical?(r.timestamp||r.day||r.trading_date):F.observation(r));
   return cache[key];
 }
 window.fetch=async function (...args) {
   const url=new URL(typeof args[0]==='string'||args[0] instanceof URL?String(args[0]):args[0].url,location.href);
   // mobile-bootstrap-v1: network policy is shared by every data consumer.
   // Never recursively call the wrapped fetch: fallback must stay same-origin.
   const liveFeed=/^\/market\/data\/(market|comprehensive|funds|options|signals|portfolio-special)\.json$/.test(url.pathname);
   let response;
   if (liveFeed) {
     const local=new URL(url.pathname+url.search,location.origin);
     const live=new URL(local.href);live.protocol='https:';live.host='94-101-184-98.sslip.io';
     live.searchParams.set('observation',Date.now());
     const request=async(target,ms)=>{
       const controller=new AbortController();
       const timer=setTimeout(()=>controller.abort(),ms);
       const signal=args[1] && args[1].signal;
       const abort=()=>controller.abort();
       if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}
       try {
         const res=await originalFetch.call(window,target.href,{...(args[1]||{}),cache:'no-store',signal:controller.signal});
         if(!res.ok)throw new Error('HTTP '+res.status);
         const data=await res.clone().json();
         if(!data||typeof data!=='object')throw new Error('Invalid snapshot');
         if(url.pathname.endsWith('/market.json')&&(!Array.isArray(data.stocks)||!data.stocks.length))throw new Error('Empty market');
         if(url.pathname.endsWith('/comprehensive.json')&&(!Array.isArray(data.rows)||!data.rows.length))throw new Error('Empty comprehensive');
         return {res,data};
       } finally {clearTimeout(timer);if(signal)signal.removeEventListener('abort',abort);}
     };
     try {
       let result, fallback=false;
       try {result=await request(live,2000);} catch(error) {fallback=true;result=await request(local,7000);}
       response=result.res;
       if(url.pathname.endsWith('/market.json'))transportStatus(fallback?'fallback':'live',result.data);
     } catch(error) {
       if(url.pathname.endsWith('/market.json'))transportStatus('error');
       throw error;
     }
   } else response=await originalFetch.apply(this,args);
   if (/\.json$/.test(url.pathname)) {
     const parse=response.json.bind(response);
     response.json=async function () { const data=await parse(); if(data&&typeof data==='object')pending.set(data,url.pathname); return data; };
   }
   return response;
 };
 function transportStatus(state,data) {
   let el=document.getElementById('dataTransportStatus');
   if(!el){el=document.createElement('div');el.id='dataTransportStatus';el.setAttribute('role','status');el.style.cssText='padding:12px;margin:8px;border:1px solid #b98b36;border-radius:8px;line-height:1.8';(document.querySelector('main')||document.body).prepend(el);}
   el.dataset.state=state;
   const snapshotAt=data && data.market && data.market.timestamp || data && data.timestamp || data && data.generated_at || '';
   const age=snapshotAt?`؛ سن snapshot: ${format(snapshotAt)}`:'';
   el.textContent=state==='error'?'دریافت داده ناموفق بود؛ اتصال را بررسی کنید و دوباره به‌روزرسانی کنید.':state==='fallback'?`نمایش نسخه ذخیره‌شده سایت${age}؛ تازگی داده در هر بخش مشخص است.`:'اتصال زنده برقرار است؛ تازگی داده در هر بخش مشخص است.';
 }
 function feed(suffix) { const key=Object.keys(feeds).find(k=>k.endsWith(suffix)); return key?feeds[key]:null; }
 function selectedSymbol() { const selected=document.querySelector('#selectedSymbol'), dossier=document.querySelector('#dossier h2'); return new URLSearchParams(location.search).get('symbol') || selected && selected.textContent || dossier && dossier.textContent; }
 function description(element) {
   const m=feed('/data/market.json')||{}, symbol=selectedSymbol(), current=rows(m.stocks).find(r=>r.symbol===symbol);
   const base={r:unknown(),name:'منبع این بخش',archive:false,note:''};
   const within=s=>element.matches(s)||!!element.closest(s);
   if (within('#turnoverChart')) return {...base,r:F.dailyRange(rows(m.daily)),series:true,daily:true,name:'ارزش معاملات و میانگین‌های ۵ و ۲۰ روزه',note:'نوبت روزانه پس از پایان بازار؛ زمان از منبع تأییدشده ثبت نهایی است. میانگین‌ها تاریخی و منتهی به آخرین روز نمایش‌داده‌شده‌اند.'};
   if (within('#queueChart')) return {...base,r:range(m.queue_intraday),series:true,name:'نمونه‌های صف'};
   if (within('#marketChart')) return {...base,r:range(m.intraday),series:true,name:'نمونه‌های امتیاز'};
   if (within('#queueCountChart')) return {...base,r:range(m.queue_count_intraday),series:true,name:'نمونه‌های تعداد صف'};
   if (within('#priceDistributionChart')) return {...base,r:range(m.stocks),name:'معاملات سهام'};
   if(location.pathname.includes('/funds/')) {
        const report=document.querySelector('#reportDate'); const reportDate=report ? report.textContent : 'تاریخ اعلام نشده';
        return {...base,r:unknown(),archive:true,name:'گزارش ماهانه پرتفو ('+reportDate+')',note:'ترکیب دارایی و NAV این بخش گزارش ماهانه است، نه قیمت یا تحلیل لحظه‌ای؛ ساعت مشاهدهٔ ردیف‌ها در منبع اعلام نشده.'};
      }
   if (within('#funds')) return {...base,r:unknown(),archive:true,name:'گزارش ماهانه پرتفو',note:'ترکیب دارایی و NAV این بخش گزارش ماهانه است، نه قیمت یا تحلیل لحظه‌ای؛ ساعت مشاهدهٔ ردیف‌ها در منبع اعلام نشده.'};
   if (element.querySelector('#leveragedStocks')) return {...base,r:range(m.leveraged),name:'تابلو اهرمی‌ها'};
   if (element.querySelector('#leaderStocks')) return {...base,r:range(rows(m.stocks).filter(r=>Array.from(document.querySelectorAll('#leaderStocks a')).some(a=>a.textContent.trim()===r.symbol))),name:'لیدرها'};
   if (within('#comprehensive-table')) return {...base,r:range((feed('/data/comprehensive.json')||{}).rows),name:'تابلو جدول جامع',note:'حقیقی/حقوقی: '+dateRange(rows((feed('/data/comprehensive.json')||{}).rows).map(r=>r.client_type_date))+'؛ میانگین‌ها تاریخی‌اند؛ زمان مستقل میانگین در منبع اعلام نشده.'};
   if (within('#industries,.industry-summary-section,.detail-section,.map-section')) return {...base,r:range(m.stocks),name:'سهام مبنای صنعت',note:'میانگین ۱۵روزه تاریخی است؛ پایان بازه مستقل در منبع باید بررسی شود.'};
   if (within('.metric-group')) { const behavior=element.textContent.includes('رفتار معامله');return {...base,r:behavior?range(current?[{timestamp:current.client_type_date}]:[]):range(current?[current]:[]),name:behavior?'حقیقی/حقوقی سهم':'نمونه سهم',note:behavior?'تاریخ داده معامله‌گران، نه زمان دریافت فایل':'میانگین‌های چندروزه تاریخی؛ زمان مستقل آن‌ها اعلام نشده'}; }
   if (within('#scoreChart')) {
     const manifest=feed('/symbols/data/history-manifest.json')||{}, info=manifest.symbols && manifest.symbols[symbol];
     const payload=info?feed('/symbols/data/'+info.file):null;
     const frameNode=document.querySelector('[data-score-timeframe].active'), dayNode=document.querySelector('#scoreDay');
     const frame=frameNode && frameNode.dataset.scoreTimeframe || '15m';
     const day=dayNode && dayNode.value;
     const points=rows(payload && payload.candles && payload.candles[frame]).filter(r=>!day||r.day===day);
     return {...base,r:F.range(points,r=>r.last_timestamp||r.day),archive:true,name:'آرشیو نمودار سهم',note:'زمان واقعی آخرین نمونه هر کندل؛ اگر ساعت منبع موجود نباشد فقط روز داده نمایش داده می‌شود.'};
   }
   if (within('#scoreCandleChart')) return {...base,r:F.range(rows((feed('/history/data/score-candles.json')||{}).rows).filter(r=>r.symbol===symbol),r=>r.last_timestamp||r.day),archive:true,name:'آرشیو کندل همین سهم'};
   if (within('.archive-strip')) return {...base,r:range(rows((feed('/history/data/history.json')||{}).rows),true),archive:true,name:'آرشیو روزانه'};
   if (within('.archive-stats,.rows-panel,.history-aside,#selectedData')) {
     const h=feed('/history/data/history.json')||{}, selected=rows(h.rows).filter(r=>r.symbol===symbol);
     return {...base,r:range(selected.length?selected:rows(h.rows),true),archive:true,name:'آرشیو ردیف‌های روزانه',note:'تاریخ روز داده؛ ساعت مشاهده در این خروجی موجود نیست. آرشیو، داده امروز نیست.'};
   }
   if (location.pathname.includes('/signals/')) return {...base,r:range((feed('/data/signals.json')||{}).items),archive:true,name:'منبع رویدادها (نمایش فقط امروز)',note:'زمان رویداد، نه سلامت لحظه‌ای بازار؛ موارد قدیمی سیگنال امروز نیستند.'};
   if (location.pathname.includes('/options/')) { const options=feed('/data/options.json')||{}; return {...base,r:range([{timestamp:options.source_at||options.timestamp||null}]),name:'سرخط آپشن',note:'تازگی بر اساس زمان منبع TSETMC سنجیده می‌شود؛ زمان تولید فایل معیار نیست.'}; }
   if (location.pathname.includes('/portfolio/')) return {...base,r:element.querySelector('#marketMedian')?range([m.market||{}]):range(F.portfolioRows),name:'ورودی‌های واقعی نتیجه پرتفو',note:'چندمنبعی: صندوق / دارایی ویژه / تاریخچه ممکن است زمان دیگری داشته باشند؛ زمان همه ورودی‌های نتیجه تأیید نشده.'};
   if (location.pathname.includes('/symbols/')) return {...base,r:range(m.stocks),name:'فهرست سهام',note:'آرشیو و تابلو منابع جدا دارند.'};
   return base;
 }
 function dateRange(values) { const v=[...new Set(values.filter(Boolean))].sort();return v.length?v[0]+(v.length>1?' تا '+v[v.length-1]:''):'نامعلوم'; }
 function format(v) { if (!v) return 'نامعلوم';const d=new Date(v);return d.toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'})+(String(v).includes('T')?' '+d.toLocaleTimeString('fa-IR',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',second:'2-digit'}):' (بدون ساعت)'); }
 function status(d) { return F.freshness(d.r,d); }
 function clock(v) { if (!v) return ''; return new Date(v).toLocaleTimeString('en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit'}); }
 function message(d,result) {
   const s=result.status, stamp=result.timestamp;
   const time=clock(stamp);
   if(s==='archive')return 'آرشیو تاریخی — '+d.name+(time?'؛ آخرین داده: '+time:'؛ ساعت مشاهده در منبع اعلام نشده')+' · تهران';
   if(s==='unknown')return 'دیتای آخرین اپدیت نامشخص';
   return s==='fresh'?'دیتا به روز '+time:'دیتای آخرین اپدیت '+time;
 }
 function paint() {
   scheduled=false;observer.disconnect();
   document.querySelectorAll('main table,main svg[role="img"],.metric-group,.score-card,.archive-stats,#list,#options,.archive-strip,#scoreChart').forEach(el=>{
     let host=el;
     if (el.tagName==='TABLE') host=el.closest('.table-scroll')||el.parentElement;
     if (el.tagName.toLowerCase()==='svg') host=el.parentElement;
     const d=description(el), result=status(d), s=result.status;
     host.dataset.observationStatus=s;
     let badge=Array.from(host.children).find(x=>x.classList.contains('observation-clock'));
     if (!badge) { badge=document.createElement('small');badge.className='observation-clock';host.prepend(badge); }
     badge.dataset.status=s;
     badge.dataset.sourceAt=result.timestamp||'';
     badge.textContent=message(d,result);
     badge.title=(d.note?d.note+' · ':'')+'زمان واقعی منبع؛ بازار باز: حداکثر ۶۰ ثانیه؛ بسته: پایان آخرین جلسه معاملاتی. تازگی داده به معنی اعتبار توصیه لحظه‌ای نیست.';
   });
   const m=feed('/data/market.json')||{}, mr=range(m.stocks), marketSafe=F.rangeState(mr)==='fresh';
   document.querySelectorAll('[data-industry-preset],[data-comprehensive-preset]').forEach(button=>{
     const comprehensive=button.hasAttribute('data-comprehensive-preset');
     const r=comprehensive?range((feed('/data/comprehensive.json')||{}).rows):mr;
     const safe=F.freshness(r).status==='fresh';
     // money-where-session-gate-1: use the same session clock as the industry badge.
     // Live: <=60s. Closed: last expected close (60s tolerance). Unknown/future/old stays blocked.
     // Comprehensive presets remain local filters; their separate analysis gates are unchanged.
     const blocksPreset=!comprehensive && !safe;
     button.disabled=blocksPreset;button.setAttribute('aria-disabled',String(blocksPreset));
     button.title=safe?'فیلتر روی داده معتبر آخرین جلسه؛ زمان منبع: '+format(r.first)+'؛ توصیه لحظه‌ای نیست':comprehensive?'داده قدیمی/نامعلوم؛ فیلتر روی داده موجود اعمال می‌شود':'ناموجود: داده قدیمی یا زمان منبع نامعلوم؛ این پریست برای امروز قابل استفاده نیست';
     // money-where-expiry-reset-1: the renderer owns selection AND filter state.
     const wasSelected=button.getAttribute('aria-pressed')==='true';
     if (blocksPreset && wasSelected) button.dispatchEvent(new CustomEvent('observation:preset-unavailable'));
   });
   // A preset already selected before expiry must not leave a recommendation visible.
   ['#industriesGrid','#comprehensiveRows'].forEach(sel=>{
     const body=document.querySelector(sel);if(!body)return;
     const section=body.closest('section'), unavailable=section && section.querySelector('[data-industry-preset]:disabled[aria-pressed="true"],[data-comprehensive-preset]:disabled[aria-pressed="true"]');
     body.dataset.observationStatus=sel==='#industriesGrid'?F.freshness(mr).status:unavailable?'stale':'fresh';
     if(sel==='#industriesGrid') {
       let notice=section.querySelector('[data-industry-preset-status]');
       if(!notice){notice=document.createElement('p');notice.dataset.industryPresetStatus='';notice.setAttribute('role','status');body.closest('table').before(notice);}
       notice.hidden=F.freshness(mr).status==='fresh';
       notice.textContent='پریست ناموجود: داده قدیمی یا زمان منبع نامعلوم است؛ نتایج پریست لغو شده و جدول صرفاً داده موجود را نشان می‌دهد.';
     }
     body.classList.remove('observation-blocked'); // stale recommendations are blocked at the preset control, never the current data table
     const download=section && section.querySelector('#downloadComprehensiveXlsx');if(download){download.disabled=!!unavailable;download.title=unavailable?'دریافت تحلیل قدیمی یا نامعلوم مسدود است':'';}
   });
   const summary={r:mr,name:'تابلو سهام'}, health=status(summary);
   document.querySelectorAll('.market-state').forEach(el=>{el.dataset.observationHealth=health.status;});
   const state=document.querySelector('#marketState');if(state) state.textContent=message(summary,health);
   if(location.pathname.includes('/portfolio/') && window.enforcePortfolioObservation) window.enforcePortfolioObservation();
   document.querySelectorAll('#sourceStatus,#availability').forEach(el=>{el.textContent=message(summary,health);el.dataset.observationStatus=health.status;});
   observer.observe(document.body,{childList:true,subtree:true});
 }
 function schedule() {if(!scheduled){scheduled=true;setTimeout(paint,0);}}
 const observer=new MutationObserver(schedule);
 document.addEventListener('click',event=>{const b=event.target.closest('[data-industry-preset],[data-comprehensive-preset]');if(b&&b.disabled){event.preventDefault();event.stopImmediatePropagation();}},true);
 function start(){schedule();setInterval(schedule,15000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
