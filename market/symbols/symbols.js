'use strict';
(function(){
var C=window.SymbolCore,M=window.MarketCore,$=function(s){return document.querySelector(s);};
var market=null,archive=null,candlesArchive=null,candleIndex=new Map(),universe=null,items=[],selected=null;
var esc=function(v){return C.text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var fmt=C.format,scoreFmt=function(v){var n=C.number(v);return n===null?'—':C.format(n,1);};
function money(v){var n=C.number(v);return n===null?'—':C.integer(n)+' تومان';}
function million(v){var n=C.number(v);return n===null?'—':C.format(n/1e6,1)+' M';}
function billion(v){var n=C.number(v);return n===null?'—':C.format(n/1e9,1)+' B';}
function hmt(v){var n=C.number(v);return n===null?'—':n.toLocaleString('fa-IR',{minimumFractionDigits:1,maximumFractionDigits:1})+' همت';}
function signed(v,d){var n=C.number(v);return n===null?'—':(n>0?'+':n<0?'−':'')+C.format(Math.abs(n),d===undefined?2:d);}
function queue(v){var n=C.number(v);return n===null||n<=0?'—':billion(n);}
function field(label,value,extra){return '<div class="field '+(extra||'')+'"><span>'+esc(label)+'</span><b><bdi>'+esc(value===null||value===undefined||value===''?'—':value)+'</bdi></b></div>';}
function compare(label,leftLabel,leftValue,rightLabel,rightValue){return '<div class="field compare-field"><span>'+esc(label)+'</span><b><div>'+esc(leftLabel+' : '+leftValue)+'</div><div>'+esc(rightLabel+' : '+rightValue)+'</div></b></div>';}
function rankedMetric(label,value,rankLabel,rankValue,extra){return '<div class="field '+(extra||'')+'"><span>'+esc(label)+'</span><b><div>'+esc(label+' : '+value)+'</div><div>'+esc(rankLabel+' : '+rankValue)+'</div></b></div>';}
function rank(value,total){var n=C.number(value),t=C.number(total);return n===null||t===null||t<=0?'—':C.digits(Math.ceil(n/t*100))+'٪';}
function group(title,fields,extra){return '<section class="metric-group '+(extra||'')+'"><h3>'+esc(title)+'</h3><div class="fields">'+fields.join('')+'</div></section>';}
function stamp(v){return M.formatDate(v);}
var solarDate=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'});
function faDate(day){var date=new Date(String(day)+'T12:00:00Z');return Number.isNaN(date.getTime())?'—':solarDate.format(date);}
function niceTicks(min,max){
 var rough=Math.max(1,(max-min)/5),power=Math.pow(10,Math.floor(Math.log10(rough))),unit=rough/power;
 var step=(unit<=1?1:unit<=2?2:unit<=5?5:10)*power,ticks=[];
 for(var v=Math.floor(min/step)*step,end=Math.ceil(max/step)*step;v<=end;v+=step)ticks.push(v);
 return ticks;
}
function bindChartTooltip(){
 var host=$('.candle-stage');if(!host)return;
 var tip=host.querySelector('.candle-tooltip');
 function hide(){tip.hidden=true;}
 host.querySelectorAll('.score-candle').forEach(function(candle){
  function show(event){
   var d=candle.dataset;
   tip.innerHTML='<strong>'+esc(faDate(d.day))+'</strong>'+[['باز شدن',d.open],['بیشترین',d.high],['کمترین',d.low],['بسته شدن',d.close]].map(function(row){return '<div><span>'+row[0]+'</span><bdi>'+esc(scoreFmt(row[1]))+'</bdi></div>';}).join('');
   tip.innerHTML+='<div><span>اولین نمونه (تهران)</span><bdi>'+esc(d.first?new Date(d.first).toLocaleTimeString('fa-IR',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—')+'</bdi></div>';
   tip.hidden=false;
   var box=host.getBoundingClientRect(),anchor=candle.getBoundingClientRect(),px=event.clientX||anchor.x+anchor.width/2,py=event.clientY||anchor.y;
   tip.style.left=Math.max(4,Math.min(px-box.left+14,box.width-tip.offsetWidth-4))+'px';
   tip.style.top=Math.max(4,Math.min(py-box.top+14,box.height-tip.offsetHeight-4))+'px';
  }
  candle.addEventListener('pointerenter',show);candle.addEventListener('pointermove',show);candle.addEventListener('pointerleave',hide);
  candle.addEventListener('focus',show);candle.addEventListener('blur',hide);candle.addEventListener('click',show);
  candle.addEventListener('keydown',function(event){if(event.key==='Escape')hide();});
 });
}
function load(url){return Promise.resolve().then(function(){var Controller=typeof window!=='undefined'&&typeof window.AbortController==='function'?window.AbortController:null,ac=Controller?new Controller():null,timer=ac?setTimeout(function(){ac.abort();},12000):null,opts={cache:'no-store'};if(ac)opts.signal=ac.signal;return fetch(url+'?ts='+Date.now(),opts).then(function(r){if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(function(data){if(timer)clearTimeout(timer);return data;},function(){if(timer)clearTimeout(timer);return null;});});}
function render(){
 var q=C.normalize($('#q').value),key=$('#sort').value;
 var list=items.filter(function(x){return !q||C.normalize(x.symbol+' '+(x.current&&x.current.industry||'')).indexOf(q)>=0;});
 list.sort(function(a,b){if(key==='symbol')return a.symbol.localeCompare(b.symbol,'fa');var k=key==='pct'?'last_pct':'score',av=key==='history'?a.history.length:C.number(a.current&&a.current[k]),bv=key==='history'?b.history.length:C.number(b.current&&b.current[k]);if(av===null&&bv===null)return a.symbol.localeCompare(b.symbol,'fa');if(av===null)return 1;if(bv===null)return -1;return bv-av;});
 $('#shown').textContent=C.integer(list.length)+' نماد';
 $('#list').innerHTML=list.map(function(x){return '<button type="button" class="row '+(x.symbol===selected?'sel':'')+'" data-symbol="'+esc(x.symbol)+'"><span><b>'+esc(x.symbol)+'</b><small>'+esc(x.current&&x.current.industry||'فقط آرشیو تاریخی')+'</small></span><strong>'+esc(x.current?scoreFmt(x.current.score):C.integer(x.history.length)+' روز')+'</strong></button>';}).join('')||'<p class="empty">نمادی پیدا نشد.</p>';
 $('#list').querySelectorAll('button').forEach(function(el){el.onclick=function(){select(el.dataset.symbol,true);};});
}
function chart(item){
 var rows=(candleIndex.get(item.symbol)||[]).slice().sort(function(a,b){return String(a.day||'').localeCompare(String(b.day||''));});
 if(!rows.length)return '<p class="meta">کندل‌های روزانه برای این نماد هنوز منتشر نشده است.</p>';
 var valid=rows.filter(function(r){
  var o=C.number(r.open),h=C.number(r.high),l=C.number(r.low),c=C.number(r.close);
  return [o,h,l,c].every(function(n){return n!==null;})&&h>=Math.max(o,c)&&l<=Math.min(o,c)&&h>=l;
 });
 if(!valid.length)return '<p class="meta">مقادیر معتبر کندل برای نمودار یافت نشد؛ جدول داده را بررسی کنید.</p>';
 var values=[];valid.forEach(function(r){values.push(r.open,r.high,r.low,r.close);});
 var leverage=Array.isArray(market&&market.leveraged)&&market.leveraged.some(function(r){return r&&r.symbol===item.symbol;});
 var thresholds=C.thresholds([item.current&&item.current.score].concat(values),leverage),lo=Math.min.apply(Math,[0].concat(values,thresholds))-1,hi=Math.max.apply(Math,[0].concat(values,thresholds))+1;
 var ticks=niceTicks(lo,hi);lo=ticks[0];hi=ticks[ticks.length-1];
 var mobile=window.matchMedia('(max-width:800px)').matches,w=Math.max(240,Math.round(($('#dossier').clientWidth||866)-68)),h=mobile?360:460,left=48,right=w-20,topPad=30,bottomPad=48;
 var step=(right-left)/Math.max(1,valid.length-1),body=Math.max(3,Math.min(18,step*0.62)),x=function(i){return Math.round(left+i*step);},y=function(v){return Math.round(h-bottomPad-(v-lo)*(h-bottomPad-topPad)/(hi-lo));};
 var lines=ticks.map(function(v){return '<line x1="'+left+'" x2="'+right+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#d8e3db"/><text class="y-tick" data-value="'+v+'" x="'+(left-10)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(C.integer(v))+'</text>';}).join('');
 lines+=thresholds.map(function(v,index){return '<line class="threshold" x1="'+left+'" x2="'+right+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#b46a40" stroke-dasharray="5 5"/><text x="'+right+'" y="'+(topPad+12+index*18)+'" text-anchor="end">آستانه '+esc(scoreFmt(v))+'</text>';}).join('');
 var plots=valid.map(function(r,j){var open=C.number(r.open),high=C.number(r.high),low=C.number(r.low),close=C.number(r.close),cx=x(j),top=y(Math.max(open,close)),bottom=y(Math.min(open,close)),height=Math.max(2,bottom-top),dir=close>=open?'up':'down';return '<g tabindex="0" role="graphics-symbol" aria-label="'+esc(faDate(r.day)+'؛ باز شدن '+fmt(open)+'؛ بیشترین '+fmt(high)+'؛ کمترین '+fmt(low)+'؛ بسته شدن '+fmt(close))+'" class="score-candle '+dir+'" data-first="'+esc(r.first_timestamp||'')+'" data-day="'+esc(r.day)+'" data-open="'+open+'" data-high="'+high+'" data-low="'+low+'" data-close="'+close+'"><line class="candle-wick" x1="'+cx+'" x2="'+cx+'" y1="'+y(high)+'" y2="'+y(low)+'"/><rect class="candle-body" x="'+(cx-body/2)+'" y="'+top+'" width="'+body+'" height="'+height+'" rx="2"/><rect class="candle-hit" x="'+(cx-Math.max(body,step*.9)/2)+'" y="'+topPad+'" width="'+Math.max(body,step*.9)+'" height="'+(h-topPad-bottomPad)+'" fill="transparent"/></g>';}).join('');
 var labels=(mobile?[0,valid.length-1]:[0,Math.floor((valid.length-1)/2),valid.length-1]).filter(function(v,i,a){return a.indexOf(v)===i;}).map(function(i,index,all){return '<text class="x-date" x="'+x(i)+'" y="'+(h-15)+'" text-anchor="'+(index===0?'start':index===all.length-1?'end':'middle')+'">'+esc(faDate(valid[i].day))+'</text>';}).join('');
 return '<div class="candle-stage"><svg class="chart candle-chart" viewBox="0 '+w+' '+h+'" role="group" aria-label="کندل استیک روزانه امتیاز '+esc(item.symbol)+'">'+lines+plots+labels+'</svg><div class="candle-tooltip" role="tooltip" hidden></div></div>';
}
function priceSlider(item){
 var c=item.current||{},base=C.number(c.yesterday_price),closePrice=C.number(c.close_price),last=C.number(c.last_price);
 var openPrice=C.number(c.open_price);if(openPrice===null){var history=item.history||[],first=history.length?history[0]:null;openPrice=C.number(first&&first.open_price);if(openPrice===null)openPrice=base;}
 if(base===null||base<=0||closePrice===null||openPrice===null)return '<div class="price-slider-empty">اطلاعات OPEN و CLOSE برای رسم بازه موجود نیست.</div>';
 var openPct=(openPrice-base)*100/base,closePct=(closePrice-base)*100/base;
 var buy=C.number(c.buy_queue_value_toman)>0,sell=C.number(c.sell_queue_value_toman)>0;
 var clamp=function(v){return Math.max(-3,Math.min(3,v));},pos=function(v){return ((clamp(v)+3)/6*100).toFixed(2)+'%';};
 var rising=closePrice>=openPrice,cls=rising?'up':'down',color=rising?'#3f8b62':'#c7463d';
 var openLabel=buy&&openPct>=3?'+۳':sell&&openPct<=-3?'−۳':(openPct>0?'+':'')+fmt(openPct)+'٪';
 var closeLabel=buy&&closePct>=3?'+۳':sell&&closePct<=-3?'−۳':(closePct>0?'+':'')+fmt(closePct)+'٪';
 var span=Math.abs(clamp(closePct)-clamp(openPct)),start=Math.min(clamp(openPct),clamp(closePct));
 return '<div class="price-slider '+cls+'" role="img" aria-label="روند قیمت '+esc(item.symbol)+'؛ OPEN '+esc(fmt(openPct))+' درصد؛ CLOSE '+esc(fmt(closePct))+' درصد"><div class="price-slider-head"><span>−۳٪</span><strong>روند قیمت در طول روز</strong><span>+۳٪</span></div><div class="price-track"><div class="price-base"></div><div class="price-fill" style="right:'+pos(start)+';width:'+(span/6*100).toFixed(2)+'%;background:'+color+'"></div><span class="price-end-label negative">−۳</span><span class="price-end-label positive">+۳</span><span class="price-mark open" style="right:'+pos(openPct)+';color:'+color+'"><b>OPEN</b><strong>'+esc(openLabel)+'</strong></span><span class="price-mark close" style="right:'+pos(closePct)+';color:'+color+'"><b>CLOSE</b><strong>'+esc(closeLabel)+'</strong></span></div><div class="price-slider-foot"><span>OPEN: '+esc(C.integer(openPrice))+'</span><span>قیمت پایانی: '+esc(C.integer(closePrice))+'</span><span>CLOSE: '+esc(C.integer(last===null?closePrice:last))+'</span></div><p class="meta">بازه ثابت −۳٪ تا +۳٪ است؛ رنگ نوار بر اساس مقایسهٔ OPEN و CLOSE تعیین می‌شود. در صورت صف، انتهای مربوط با −۳/+۳ نشان داده می‌شود.</p></div>';
}
function download(data,type,name){var u=URL.createObjectURL(new Blob([data],{type:type})),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},3000);}
function downloadXlsx(rows,name){if(!window.XLSX){alert('ماژول Excel هنوز بارگذاری نشده است؛ CSV را امتحان کن');return;}var book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows.map(function(r){return {'تاریخ':r.day,'نماد':r.symbol,'تعداد نمونه':r.count,'میانگین امتیاز':r.mean,'میانه امتیاز':r.median,'کمینه':r.min,'بیشینه':r.max,'آخرین امتیاز':r.last,'کیفیت':r.quality==='review'?'review':'valid'};}));XLSX.utils.book_append_sheet(book,sheet,'Score History');XLSX.writeFile(book,name);
}
function archiveDate(v){return v?faDate(v):'—';}
function select(symbol,push){
 selected=symbol;var item=universe&&universe.bySymbol.get(symbol);render();
 if(push)history.pushState(null,'','?symbol='+encodeURIComponent(symbol));
 if(!item){$('#dossier').innerHTML='<div class="empty"><h2>'+(symbol?'نماد پیدا نشد':'یک نماد را انتخاب کن')+'</h2><p>از فهرست جست‌وجو و انتخاب کنید.</p></div>';return;}
 var c=item.current,rows=item.history;
 var groups=c?[
  group('امتیاز و جایگاه',[field('امتیاز فعلی',scoreFmt(c.score),'hero-value'),field('رتبه بین تمام سهام',rank(item.rank,universe.rankedCount),'rank-value')]),
  group('قیمت و صف',[field('درصد آخرین قیمت',C.number(c.last_pct)===null?'—':signed(c.last_pct,1)+'٪',C.number(c.last_pct)<0?'negative':'positive')].concat(C.number(c.buy_queue_value_toman)>0?[field('ارزش صف خرید',queue(c.buy_queue_value_toman),'queue-buy')]:[]).concat(C.number(c.sell_queue_value_toman)>0?[field('ارزش صف فروش',queue(c.sell_queue_value_toman),'queue-sell')]:[]).concat(C.number(c.buy_queue_value_toman)<=0&&C.number(c.sell_queue_value_toman)<=0?[field('صف','—')]:[])),
  group('حجم و ارزش معاملات',[compare('حجم معاملات','امروز',million(c.trade_volume),'میانگین ۱۵ روزه',million(c.avg15_trade_volume)),compare('ارزش معاملات','امروز',billion(c.trade_value_toman),'میانگین ۱۵ روزه',billion(c.avg15_trade_value_toman)),field('رتبه میانگین ارزش معاملات ۱۵ روز اخیر',rank(c.avg15_trade_value_rank,c.avg15_trade_value_rank_total))]),
  group('رفتار خریدار و فروشنده',[rankedMetric('سرانه خرید',million(c.buy_per_capita_toman),'رتبه سرانه خرید',rank(c.buy_per_capita_rank,c.buy_per_capita_rank_total),'positive'),rankedMetric('سرانه فروش',million(c.sell_per_capita_toman),'رتبه سرانه فروش',rank(c.sell_per_capita_rank,c.sell_per_capita_rank_total),'negative'),rankedMetric('قدرت خریدار به فروشنده',C.number(c.buyer_power)===null?'—':C.format(c.buyer_power,1),'رتبه قدرت خریدار به فروشنده',rank(c.buyer_power_rank,c.buyer_power_rank_total),'power-value')]),
  group('بازار و مشخصات سهم',[field('صنعت',c.industry||'—'),field('مارکت‌کپ',hmt(c.market_cap_hmt),'market-cap'),field('رتبه مارکت‌کپ',rank(c.market_cap_rank,c.market_cap_rank_total)),field('روز معاملاتی',faDate(c.trading_date))])
 ]:[];
 var table=rows.map(function(r){return '<tr><td>'+esc(r.day)+'</td>'+['count','mean','median','min','max','last'].map(function(k){return '<td><bdi>'+esc(k==='count'?C.integer(r[k]):scoreFmt(r[k]))+'</bdi></td>';}).join('')+'<td>'+esc(r.quality==='review'?'نیازمند بررسی':r.quality==='valid'?'معتبر':'نامشخص')+'</td></tr>';}).join('');
 var tsetmc=c&&c.tsetmc_url?'<a class="tsetmc-link" href="'+esc(c.tsetmc_url)+'" target="_blank" rel="noopener">مشاهده صفحه سهم در TSETMC ↗</a>':'';
 $('#dossier').innerHTML='<div class="dossier-head"><div><span class="tag">'+(c?'آخرین snapshot':'فقط آرشیو تاریخی')+'</span><h2>'+esc(symbol)+'</h2><p class="meta">'+(c?'زمان منبع: '+esc(stamp(c.timestamp||M.sourceTimestamp(market))):'در snapshot جاری داده‌ای برای این نماد نداریم.')+'</p></div><div class="head-actions">'+tsetmc+'<button class="share" id="copyLink">کپی لینک</button></div></div><div class="metric-groups">'+groups.join('')+'</div><div class="price-slider-box"><h3>روند حرکت قیمت در طول روز</h3>'+priceSlider(item)+'</div><div class="chartbox"><h3>کندل روزانه امتیازهای مشاهده‌شده</h3>'+chart(item)+'</div><div class="export-actions"><button class="share" id="csv">دانلود CSV</button><button class="share" id="xlsx">دانلود Excel</button><button class="share" id="json">دانلود JSON</button><span class="meta">'+C.integer(rows.length)+' روز موجود؛ نبود سابقه به معنی صفر نیست.</span></div><div class="tablebox"><table><thead><tr><th>تاریخ</th><th>تعداد نمونه</th><th>میانگین</th><th>میانه</th><th>کمینه</th><th>بیشینه</th><th>آخرین</th><th>کیفیت</th></tr></thead><tbody>'+ (table||'<tr><td colspan="8">تاریخچه‌ای در دسترس نیست.</td></tr>')+'</tbody></table></div>';
 bindChartTooltip();
 $('#csv').disabled=!rows.length;
 $('#csv').onclick=function(){var keys=['day','symbol','count','mean','median','min','max','last','quality'];download('\uFEFF'+C.csv([keys].concat(rows.map(function(r){return keys.map(function(k){return r[k];});}))),'text/csv;charset=utf-8',symbol+'-history.csv');};
 var xlsxButton=$('#xlsx');if(xlsxButton)xlsxButton.onclick=function(){downloadXlsx(rows,symbol+'-score-history.xlsx');};
 $('#json').onclick=function(){download(JSON.stringify({source_timestamp:M.sourceTimestamp(market),current:c,history:rows},null,2),'application/json',symbol+'.json');};
 $('#copyLink').onclick=function(){var el=this;if(!navigator.clipboard){el.textContent='کپی پشتیبانی نمی‌شود';return;}navigator.clipboard.writeText(location.href).then(function(){el.textContent='کپی شد';},function(){el.textContent='کپی ناموفق';});};
}
$('#q').oninput=render;$('#sort').onchange=render;$('#downloadAllArchive').onclick=function(){location.href='../history/data/market-score-history.xlsx';};
window.addEventListener('popstate',function(){select(new URLSearchParams(location.search).get('symbol'),false);});
function refresh(){return Promise.all([load('../data/market.json'),load('../history/data/history.json'),load('../history/data/score-candles.json')]).then(function(results){
 market=results[0];archive=results[1];candlesArchive=results[2];candleIndex=new Map();
 if(candlesArchive&&Array.isArray(candlesArchive.rows)){candlesArchive.rows.forEach(function(row){if(!row||!row.symbol)return;if(!candleIndex.has(row.symbol))candleIndex.set(row.symbol,[]);candleIndex.get(row.symbol).push(row);});}
 if(!market||!Array.isArray(market.stocks)&&!Array.isArray(market.top_stocks))market=null;
 if(!archive||!Array.isArray(archive.rows))archive=null;
 universe=C.buildUniverse(market,archive);items=Array.from(universe.bySymbol.values());
  if(archive){$('#archiveDays').textContent=C.integer(archive.valid_day_count);$('#archiveRows').textContent=C.integer(archive.row_count);$('#archiveLastDay').textContent=archiveDate(archive.generated_at);}
   var countEl=$('#count'),stampEl=$('#stamp');if(countEl)countEl.textContent=C.integer(items.length);if(stampEl)stampEl.textContent=stamp(M.sourceTimestamp(market));
 var age=Date.now()-Date.parse(M.sourceTimestamp(market)||''),messages=[];
 if(!market)messages.push('دریافت snapshot جاری ناموفق بود؛ داده‌های آرشیوی جای قیمت جاری نیستند.');
 else if(!Number.isFinite(age)||age>24*3600000||age< -300000)messages.push('snapshot قدیمی یا زمان منبع نامعتبر است؛ داده زنده محسوب نمی‌شود.');
 if(universe.partial)messages.push('فهرست جاری کامل نیست؛ فقط نمادهای موجود در داده نمایش داده می‌شوند.');
 if(!candlesArchive)messages.push('دریافت کندل‌ها ناموفق بود؛ تلاش مجدد در ۶۰ ثانیه.');
 if(!archive)messages.push('آرشیو در دسترس نیست؛ اطلاعات جاری همچنان قابل مشاهده است.');
 $('#availability').textContent=messages.length?'داده با محدودیت':'snapshot دریافت شد';$('#notice').hidden=!messages.length;$('#notice').textContent=messages.join(' ');
 render();var wanted=new URLSearchParams(location.search).get('symbol');select(wanted||null,false);
}).catch(function(){ $('#availability').textContent='خطا در نمایش داده';$('#notice').hidden=false;$('#notice').textContent='داده قابل پردازش نیست. صفحه را دوباره بارگذاری کنید.';}).then(function(){setTimeout(refresh,60000);});}
var resizeTimer;window.addEventListener('resize',function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(function(){if(universe&&selected)select(selected,false);},150);});
refresh();
})();
