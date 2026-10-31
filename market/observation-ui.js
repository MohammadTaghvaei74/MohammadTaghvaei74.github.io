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
   // Only verified live endpoints; archives and unavailable signal endpoints stay on their own origin.
   if (/^\/market\/data\/(market|comprehensive)\.json$/.test(url.pathname) && /^(mohammadtaghvaei74\.github\.io|94-101-184-98\.sslip\.io)$/.test(location.hostname)) {
     url.protocol='https:';url.host='94-101-184-98.sslip.io';url.searchParams.set('observation',Date.now());
     args[0]=url.href;args[1]={...(args[1]||{}),cache:'no-store'};
   }
   const response=await originalFetch.apply(this,args);
   if (/\.json$/.test(url.pathname)) {
     const parse=response.json.bind(response);
     response.json=async function () { const data=await parse(); if(data&&typeof data==='object')pending.set(data,url.pathname); return data; };
   }
   return response;
 };
 function feed(suffix) { const key=Object.keys(feeds).find(k=>k.endsWith(suffix)); return key?feeds[key]:null; }
 function selectedSymbol() { return new URLSearchParams(location.search).get('symbol') || document.querySelector('#selectedSymbol')?.textContent || document.querySelector('#dossier h2')?.textContent; }
 function description(element) {
   const m=feed('/data/market.json')||{}, symbol=selectedSymbol(), current=rows(m.stocks).find(r=>r.symbol===symbol);
   const base={r:unknown(),name:'منبع این بخش',archive:false,note:''};
   const within=s=>element.matches(s)||!!element.closest(s);
   if (within('#queueChart')) return {...base,r:range(m.queue_intraday),series:true,name:'نمونه‌های صف'};
   if (within('#marketChart')) return {...base,r:range(m.intraday),series:true,name:'نمونه‌های امتیاز'};
   if (within('#queueCountChart')) return {...base,r:range(m.queue_count_intraday),series:true,name:'نمونه‌های تعداد صف'};
   if (within('#priceDistributionChart')) return {...base,r:range(m.stocks),name:'معاملات سهام'};
   if (within('#funds')) return {...base,r:range((feed('/data/funds.json')||m.fund_report||{}).rows),name:'تابلو / NAV / امتیاز صندوق',note:'زمان مشاهده هر ورودی باید مستقل تأیید شود؛ تاریخ پرتفو، تاریخ گزارش ماهانه است نه قیمت امروز.'};
   if (element.querySelector('#leveragedStocks')) return {...base,r:range(m.leveraged),name:'تابلو اهرمی‌ها'};
   if (element.querySelector('#leaderStocks')) return {...base,r:range(rows(m.stocks).filter(r=>Array.from(document.querySelectorAll('#leaderStocks a')).some(a=>a.textContent.trim()===r.symbol))),name:'لیدرها'};
   if (within('#comprehensive-table')) return {...base,r:range((feed('/data/comprehensive.json')||{}).rows),name:'تابلو جدول جامع',note:'حقیقی/حقوقی: '+dateRange(rows((feed('/data/comprehensive.json')||{}).rows).map(r=>r.client_type_date))+'؛ میانگین‌ها تاریخی‌اند؛ زمان مستقل میانگین در منبع اعلام نشده.'};
   if (within('#industries,.industry-summary-section,.detail-section,.map-section')) return {...base,r:range(m.stocks),name:'سهام مبنای صنعت',note:'میانگین ۱۵روزه تاریخی است؛ پایان بازه مستقل در منبع باید بررسی شود.'};
   if (within('.metric-group')) { const behavior=element.textContent.includes('رفتار معامله');return {...base,r:behavior?range(current?[{timestamp:current.client_type_date}]:[]):range(current?[current]:[]),name:behavior?'حقیقی/حقوقی سهم':'نمونه سهم',note:behavior?'تاریخ داده معامله‌گران، نه زمان دریافت فایل':'میانگین‌های چندروزه تاریخی؛ زمان مستقل آن‌ها اعلام نشده'}; }
   if (within('#scoreChart')) {
     const info=(feed('/symbols/data/history-manifest.json')||{}).symbols?.[symbol];
     const payload=info?feed('/symbols/data/'+info.file):null;
     const frame=document.querySelector('[data-score-timeframe].active')?.dataset.scoreTimeframe || '15m';
     const day=document.querySelector('#scoreDay')?.value;
     const points=rows(payload?.candles?.[frame]).filter(r=>!day||r.day===day);
     return {...base,r:F.range(points,r=>r.last_timestamp||r.day),archive:true,name:'آرشیو نمودار سهم',note:'زمان واقعی آخرین نمونه هر کندل؛ اگر ساعت منبع موجود نباشد فقط روز داده نمایش داده می‌شود.'};
   }
   if (within('#scoreCandleChart')) return {...base,r:F.range(rows((feed('/history/data/score-candles.json')||{}).rows).filter(r=>r.symbol===symbol),r=>r.last_timestamp||r.day),archive:true,name:'آرشیو کندل همین سهم'};
   if (within('.archive-strip')) return {...base,r:range(rows((feed('/history/data/history.json')||{}).rows),true),archive:true,name:'آرشیو روزانه'};
   if (within('.archive-stats,.rows-panel,.history-aside,#selectedData')) {
     const h=feed('/history/data/history.json')||{}, selected=rows(h.rows).filter(r=>r.symbol===symbol);
     return {...base,r:range(selected.length?selected:rows(h.rows),true),archive:true,name:'آرشیو ردیف‌های روزانه',note:'تاریخ روز داده؛ ساعت مشاهده در این خروجی موجود نیست. آرشیو، داده امروز نیست.'};
   }
   if (location.pathname.includes('/signals/')) return {...base,r:range((feed('/data/signals.json')||{}).items),archive:true,name:'منبع رویدادها (نمایش فقط امروز)',note:'زمان رویداد، نه سلامت لحظه‌ای بازار؛ موارد قدیمی سیگنال امروز نیستند.'};
   if (location.pathname.includes('/options/')) return {...base,r:range([feed('/data/options.json')||{}]),name:'سرخط آپشن'};
   if (location.pathname.includes('/portfolio/')) return {...base,r:element.querySelector('#marketMedian')?range([m.market||{}]):range(F.portfolioRows),name:'ورودی‌های واقعی نتیجه پرتفو',note:'چندمنبعی: صندوق / دارایی ویژه / تاریخچه ممکن است زمان دیگری داشته باشند؛ زمان همه ورودی‌های نتیجه تأیید نشده.'};
   if (location.pathname.includes('/symbols/')) return {...base,r:range(m.stocks),name:'فهرست سهام',note:'آرشیو و تابلو منابع جدا دارند.'};
   return base;
 }
 function dateRange(values) { const v=[...new Set(values.filter(Boolean))].sort();return v.length?v[0]+(v.length>1?' تا '+v[v.length-1]:''):'نامعلوم'; }
 function format(v) { if (!v) return 'نامعلوم';const d=new Date(v);return d.toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'})+(String(v).includes('T')?' '+d.toLocaleTimeString('fa-IR',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',second:'2-digit'}):' (بدون ساعت)'); }
 function status(d) { return d.r.unknown?'unknown':d.archive||d.series?F.state(d.r.last):F.rangeState(d.r); }
 function paint() {
   scheduled=false;observer.disconnect();
   document.querySelectorAll('main table,main svg[role="img"],.metric-group,.score-card,.archive-stats,#list,#options,.archive-strip,#scoreChart').forEach(el=>{
     let host=el;
     if (el.tagName==='TABLE') host=el.closest('.table-scroll')||el.parentElement;
     if (el.tagName.toLowerCase()==='svg') host=el.parentElement;
     const d=description(el), s=status(d);
     host.dataset.observationStatus=s;
     let badge=Array.from(host.children).find(x=>x.classList.contains('observation-clock'));
     if (!badge) { badge=document.createElement('small');badge.className='observation-clock';host.prepend(badge); }
     badge.dataset.status=s;
     const label=d.archive?'آرشیو — ':s==='fresh'?'مشاهده منبع — ':s==='stale'?'⚠ داده قدیمی؛ تحلیل امروز ناموجود — ':'⚠ زمان منبع نامعلوم؛ تحلیل امروز ناموجود — ';
     badge.textContent=label+d.name+': '+format(d.r.first)+(d.r.last&&d.r.last!==d.r.first?' تا '+format(d.r.last):'')+(d.r.unknown&&d.r.first?'؛ بخشی نامعلوم':'')+' · تهران';
     badge.title=(d.note?d.note+' · ':'')+'زمان مشاهده داده، نه انتشار فایل یا بارگذاری صفحه. اعتبار تحلیل لحظه‌ای حداکثر ۲ دقیقه و فقط روز جاری تهران است.';
   });
   const m=feed('/data/market.json')||{}, mr=range(m.stocks), marketSafe=F.rangeState(mr)==='fresh';
   document.querySelectorAll('[data-industry-preset],[data-comprehensive-preset]').forEach(button=>{
     const comprehensive=button.hasAttribute('data-comprehensive-preset');
     const r=comprehensive?range((feed('/data/comprehensive.json')||{}).rows):mr;
     const safe=F.rangeState(r)==='fresh';
     button.disabled=!safe;button.setAttribute('aria-disabled',String(!safe));
     button.title=safe?'داده مشاهده‌شده در ۲ دقیقه اخیر':'ناموجود: داده قدیمی یا زمان منبع نامعلوم؛ این پریست برای امروز قابل استفاده نیست';
     if (!safe) button.setAttribute('aria-pressed','false');
   });
   // A preset already selected before expiry must not leave a recommendation visible.
   ['#industriesGrid','#comprehensiveRows'].forEach(sel=>{
     const body=document.querySelector(sel);if(!body)return;
     const section=body.closest('section'), unavailable=section?.querySelector('[data-industry-preset]:disabled,[data-comprehensive-preset]:disabled');
     body.dataset.observationStatus=unavailable?'stale':'fresh';
     body.classList.toggle('observation-blocked',!!unavailable);
     const download=section?.querySelector('#downloadComprehensiveXlsx');if(download){download.disabled=!!unavailable;download.title=unavailable?'دریافت تحلیل قدیمی یا نامعلوم مسدود است':'';}
   });
   document.querySelectorAll('.market-state').forEach(el=>{el.dataset.observationHealth=marketSafe?'fresh':'stale';});
   const state=document.querySelector('#marketState');if(state&&!marketSafe) state.textContent='داده قدیمی یا نامعلوم — تحلیل لحظه‌ای ناموجود';
   if(location.pathname.includes('/portfolio/') && window.enforcePortfolioObservation) window.enforcePortfolioObservation();
   document.querySelectorAll('#sourceStatus,#availability').forEach(el=>{if(!marketSafe)el.textContent='داده قدیمی یا نامعلوم · '+format(F.observation(m.market));});
   observer.observe(document.body,{childList:true,subtree:true});
 }
 function schedule() {if(!scheduled){scheduled=true;setTimeout(paint,0);}}
 const observer=new MutationObserver(schedule);
 document.addEventListener('click',event=>{const b=event.target.closest('[data-industry-preset],[data-comprehensive-preset]');if(b&&b.disabled){event.preventDefault();event.stopImmediatePropagation();}},true);
 function start(){schedule();setInterval(schedule,15000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
