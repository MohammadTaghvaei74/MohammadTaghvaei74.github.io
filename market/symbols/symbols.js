'use strict';
(function(){
var C=window.SymbolCore,M=window.MarketCore,$=function(s){return document.querySelector(s);};
var market=null,archive=null,candlesArchive=null,candleIndex=new Map(),universe=null,items=[],selected=null;
var esc=function(v){return C.text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var fmt=C.format;
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
   tip.innerHTML='<strong>'+esc(faDate(d.day))+'</strong>'+[['باز شدن',d.open],['بیشترین',d.high],['کمترین',d.low],['بسته شدن',d.close]].map(function(row){return '<div><span>'+row[0]+'</span><bdi>'+esc(fmt(row[1]))+'</bdi></div>';}).join('');
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
 $('#list').innerHTML=list.map(function(x){return '<button type="button" class="row '+(x.symbol===selected?'sel':'')+'" data-symbol="'+esc(x.symbol)+'"><span><b>'+esc(x.symbol)+'</b><small>'+esc(x.current&&x.current.industry||'فقط آرشیو تاریخی')+'</small></span><strong>'+esc(x.current?fmt(x.current.score):C.integer(x.history.length)+' روز')+'</strong></button>';}).join('')||'<p class="empty">نمادی پیدا نشد.</p>';
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
 lines+=thresholds.map(function(v,index){return '<line class="threshold" x1="'+left+'" x2="'+right+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#b46a40" stroke-dasharray="5 5"/><text x="'+right+'" y="'+(topPad+12+index*18)+'" text-anchor="end">آستانه '+esc(fmt(v))+'</text>';}).join('');
 var plots=valid.map(function(r,j){var open=C.number(r.open),high=C.number(r.high),low=C.number(r.low),close=C.number(r.close),cx=x(j),top=y(Math.max(open,close)),bottom=y(Math.min(open,close)),height=Math.max(2,bottom-top),dir=close>=open?'up':'down';return '<g tabindex="0" role="graphics-symbol" aria-label="'+esc(faDate(r.day)+'؛ باز شدن '+fmt(open)+'؛ بیشترین '+fmt(high)+'؛ کمترین '+fmt(low)+'؛ بسته شدن '+fmt(close))+'" class="score-candle '+dir+'" data-day="'+esc(r.day)+'" data-open="'+open+'" data-high="'+high+'" data-low="'+low+'" data-close="'+close+'"><line class="candle-wick" x1="'+cx+'" x2="'+cx+'" y1="'+y(high)+'" y2="'+y(low)+'"/><rect class="candle-body" x="'+(cx-body/2)+'" y="'+top+'" width="'+body+'" height="'+height+'" rx="2"/><rect class="candle-hit" x="'+(cx-Math.max(body,step*.9)/2)+'" y="'+topPad+'" width="'+Math.max(body,step*.9)+'" height="'+(h-topPad-bottomPad)+'" fill="transparent"/></g>';}).join('');
 var labels=(mobile?[0,valid.length-1]:[0,Math.floor((valid.length-1)/2),valid.length-1]).filter(function(v,i,a){return a.indexOf(v)===i;}).map(function(i,index,all){return '<text class="x-date" x="'+x(i)+'" y="'+(h-15)+'" text-anchor="'+(index===0?'start':index===all.length-1?'end':'middle')+'">'+esc(faDate(valid[i].day))+'</text>';}).join('');
 return '<div class="candle-stage"><svg class="chart candle-chart" viewBox="0 0 '+w+' '+h+'" role="group" aria-label="کندل استیک روزانه امتیاز '+esc(item.symbol)+'">'+lines+plots+labels+'</svg><div class="candle-tooltip" role="tooltip" hidden></div></div><p class="meta">هر کندل یک روز است؛ باز شدن/بسته شدن اولین و آخرین snapshot و بیشترین/کمترین، بیشترین و کمترین امتیاز مشاهده‌شده همان روز است. '+C.integer(valid.filter(function(r){return r.coverage!=='complete';}).length)+' روز دارای پوشش ناقص یا نامشخص است؛ این نمودار به معنی ثبت تمام دقایق روز نیست. دریافت خودکار هر ۶۰ ثانیه. سبز: بسته شدن بالاتر یا برابر باز شدن · قرمز: بسته شدن پایین‌تر از باز شدن.</p>';
}
function download(data,type,name){var u=URL.createObjectURL(new Blob([data],{type:type})),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},3000);}
function select(symbol,push){
 selected=symbol;var item=universe&&universe.bySymbol.get(symbol);render();
 if(push)history.pushState(null,'','?symbol='+encodeURIComponent(symbol));
 if(!item){$('#dossier').innerHTML='<div class="empty"><h2>'+(symbol?'نماد پیدا نشد':'یک نماد را انتخاب کن')+'</h2><p>از فهرست جست‌وجو و انتخاب کنید.</p></div>';return;}
 var c=item.current,rows=item.history;
 var fields=c?[
 ['امتیاز',fmt(c.score)],['رتبه در نمادهای جاری',item.rank===null?'—':C.integer(item.rank)+' / '+C.integer(universe.rankedCount)],['درصد آخرین',C.number(c.last_pct)===null?'—':fmt(c.last_pct)+'٪'],
 ['قیمت دیروز · ریال',fmt(c.yesterday_price)],['قیمت پایانی · ریال',fmt(c.close_price)],['آخرین قیمت · ریال',fmt(c.last_price)],
 ['حجم معامله · سهم',C.integer(c.trade_volume)],['ارزش معامله · تومان',C.integer(c.trade_value_toman)],['نوع ابزار',c.instrument_type||'—'],
 ['حجم صف خرید · سهم',C.integer(c.buy_queue_volume)],['حجم صف فروش · سهم',C.integer(c.sell_queue_volume)],['صنعت',c.industry||'—'],
 ['ارزش صف خرید · تومان',C.integer(c.buy_queue_value_toman)],['ارزش صف فروش · تومان',C.integer(c.sell_queue_value_toman)],['روز معاملاتی',c.trading_date||'—']
 ]:[];
 var table=rows.map(function(r){return '<tr><td>'+esc(r.day)+'</td>'+['count','mean','median','min','max','last'].map(function(k){return '<td><bdi>'+esc(fmt(r[k]))+'</bdi></td>';}).join('')+'<td>'+esc(r.quality==='review'?'نیازمند بررسی':r.quality==='valid'?'معتبر':'نامشخص')+'</td></tr>';}).join('');
 $('#dossier').innerHTML='<div class="dossier-head"><div><span class="tag">'+(c?'آخرین snapshot':'فقط آرشیو تاریخی')+'</span><h2>'+esc(symbol)+'</h2><p class="meta">'+(c?'زمان منبع: '+esc(stamp(c.timestamp||M.sourceTimestamp(market))):'در snapshot جاری داده‌ای برای این نماد نداریم.')+'</p></div><button class="share" id="copyLink">کپی لینک</button></div><div class="fields">'+fields.map(function(f){return '<div class="field"><span>'+esc(f[0])+'</span><b><bdi>'+esc(f[1])+'</bdi></b></div>';}).join('')+'</div><div class="chartbox"><h3>کندل روزانه امتیازهای مشاهده‌شده</h3>'+chart(item)+'</div><div class="export-actions"><button class="share" id="csv">دانلود CSV</button><button class="share" id="json">دانلود JSON</button><a class="share" href="../history/">آرشیو و Excel</a><span class="meta">'+C.integer(rows.length)+' روز موجود؛ نبود سابقه به معنی صفر نیست.</span></div><div class="tablebox"><table><thead><tr><th>تاریخ</th><th>تعداد نمونه</th><th>میانگین</th><th>میانه</th><th>کمینه</th><th>بیشینه</th><th>آخرین</th><th>کیفیت</th></tr></thead><tbody>'+ (table||'<tr><td colspan="8">تاریخچه‌ای در دسترس نیست.</td></tr>')+'</tbody></table></div>';
 bindChartTooltip();
 $('#csv').disabled=!rows.length;
 $('#csv').onclick=function(){var keys=['day','symbol','count','mean','median','min','max','last','quality'];download('\uFEFF'+C.csv([keys].concat(rows.map(function(r){return keys.map(function(k){return r[k];});}))),'text/csv;charset=utf-8',symbol+'-history.csv');};
 $('#json').onclick=function(){download(JSON.stringify({source_timestamp:M.sourceTimestamp(market),current:c,history:rows},null,2),'application/json',symbol+'.json');};
 $('#copyLink').onclick=function(){var el=this;if(!navigator.clipboard){el.textContent='کپی پشتیبانی نمی‌شود';return;}navigator.clipboard.writeText(location.href).then(function(){el.textContent='کپی شد';},function(){el.textContent='کپی ناموفق';});};
}
$('#q').oninput=render;$('#sort').onchange=render;
window.addEventListener('popstate',function(){select(new URLSearchParams(location.search).get('symbol'),false);});
function refresh(){return Promise.all([load('../data/market.json'),load('../history/data/history.json'),load('../history/data/score-candles.json')]).then(function(results){
 market=results[0];archive=results[1];candlesArchive=results[2];candleIndex=new Map();
 if(candlesArchive&&Array.isArray(candlesArchive.rows)){candlesArchive.rows.forEach(function(row){if(!row||!row.symbol)return;if(!candleIndex.has(row.symbol))candleIndex.set(row.symbol,[]);candleIndex.get(row.symbol).push(row);});}
 if(!market||!Array.isArray(market.stocks)&&!Array.isArray(market.top_stocks))market=null;
 if(!archive||!Array.isArray(archive.rows))archive=null;
 universe=C.buildUniverse(market,archive);items=Array.from(universe.bySymbol.values());
 $('#count').textContent=C.integer(items.length);$('#stamp').textContent=stamp(M.sourceTimestamp(market));
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
