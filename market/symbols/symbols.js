'use strict';
(function(){
var C=window.SymbolCore,M=window.MarketCore,$=function(s){return document.querySelector(s);};
var market=null,archive=null,universe=null,items=[],selected=null;
var esc=function(v){return C.text(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var fmt=C.format;
function stamp(v){return M.formatDate(v);}
function load(url){var ac=new AbortController(),timer=setTimeout(function(){ac.abort();},12000);return fetch(url+'?ts='+Date.now(),{cache:'no-store',signal:ac.signal}).then(function(r){if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(function(data){clearTimeout(timer);return data;},function(){clearTimeout(timer);return null;});}
function render(){
 var q=C.normalize($('#q').value),key=$('#sort').value;
 var list=items.filter(function(x){return !q||C.normalize(x.symbol+' '+(x.current&&x.current.industry||'')).indexOf(q)>=0;});
 list.sort(function(a,b){if(key==='symbol')return a.symbol.localeCompare(b.symbol,'fa');var k=key==='pct'?'last_pct':'score',av=key==='history'?a.history.length:C.number(a.current&&a.current[k]),bv=key==='history'?b.history.length:C.number(b.current&&b.current[k]);if(av===null&&bv===null)return a.symbol.localeCompare(b.symbol,'fa');if(av===null)return 1;if(bv===null)return -1;return bv-av;});
 $('#shown').textContent=C.integer(list.length)+' نماد';
 $('#list').innerHTML=list.map(function(x){return '<button type="button" class="row '+(x.symbol===selected?'sel':'')+'" data-symbol="'+esc(x.symbol)+'"><span><b>'+esc(x.symbol)+'</b><small>'+esc(x.current&&x.current.industry||'فقط آرشیو تاریخی')+'</small></span><strong>'+esc(x.current?fmt(x.current.score):C.integer(x.history.length)+' روز')+'</strong></button>';}).join('')||'<p class="empty">نمادی پیدا نشد.</p>';
 $('#list').querySelectorAll('button').forEach(function(el){el.onclick=function(){select(el.dataset.symbol,true);};});
}
function chart(item){
 var rows=item.history;if(!rows.length)return '<p class="meta">تاریخچه‌ای در دسترس نیست.</p>';
 var series=C.chartSeries(rows),values=[];series.forEach(function(s){values=values.concat(s.values.filter(function(v){return v!==null;}));});
 if(!values.length)return '<p class="meta">مقادیر نمودار ناموجود یا خارج از دامنه‌اند؛ جدول را بررسی کنید.</p>';
 var leverage=Array.isArray(market&&market.leveraged)&&market.leveraged.some(function(r){return r.symbol===item.symbol;});
 var thresholds=C.thresholds(values,leverage),lo=Math.min.apply(Math,[0].concat(values,thresholds))-1,hi=Math.max.apply(Math,[0].concat(values,thresholds))+1;
 var w=800,h=260,p=45,x=function(i){return Math.round(p+i*(w-2*p)/Math.max(1,rows.length-1));},y=function(v){return Math.round(h-p-(v-lo)*(h-2*p)/(hi-lo));};
 var lines=[lo,0,hi].map(function(v){return '<line x1="45" x2="755" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#d8e3db"/><text x="36" y="'+(y(v)+4)+'" text-anchor="end">'+esc(fmt(v,1))+'</text>';}).join('');
 lines+=thresholds.map(function(v){return '<line class="threshold" x1="45" x2="755" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#b46a40" stroke-dasharray="5 5"/><text x="755" y="'+(y(v)-5)+'" text-anchor="end">آستانه '+esc(fmt(v))+'</text>';}).join('');
 var colors=['#247d99','#64882b','#c76a3d'];
 var plots=series.map(function(s,i){return '<path d="'+C.path(s.values,x,y)+'" fill="none" stroke="'+colors[i]+'" stroke-width="2.5"/>'+s.values.map(function(v,j){return v===null?'':'<circle cx="'+x(j)+'" cy="'+y(v)+'" r="2.5" fill="'+colors[i]+'"><title>'+esc(rows[j].day+' : '+fmt(v))+'</title></circle>';}).join('');}).join('');
 var labels=[0,Math.floor((rows.length-1)/2),rows.length-1].filter(function(v,i,a){return a.indexOf(v)===i;}).map(function(i){return '<text x="'+x(i)+'" y="250" text-anchor="middle">'+esc(rows[i].day)+'</text>';}).join('');
 return '<svg class="chart" viewBox="0 0 800 260" role="img" aria-label="روند امتیاز '+esc(item.symbol)+'">'+lines+plots+labels+'</svg><p class="meta">آبی: میانگین · سبز: میانه · نارنجی: آخرین امتیاز. مقادیر خارج از ±۲۰ در نمودار رسم نشده‌اند و در جدول حفظ شده‌اند؛ نقاط گمشده به هم متصل نمی‌شوند.</p>';
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
 $('#dossier').innerHTML='<div class="dossier-head"><div><span class="tag">'+(c?'آخرین snapshot':'فقط آرشیو تاریخی')+'</span><h2>'+esc(symbol)+'</h2><p class="meta">'+(c?'زمان منبع: '+esc(stamp(c.timestamp||M.sourceTimestamp(market))):'در snapshot جاری داده‌ای برای این نماد نداریم.')+'</p></div><button class="share" id="copyLink">کپی لینک</button></div><div class="fields">'+fields.map(function(f){return '<div class="field"><span>'+esc(f[0])+'</span><b><bdi>'+esc(f[1])+'</bdi></b></div>';}).join('')+'</div><div class="chartbox"><h3>روند امتیاز در روزهای کامل</h3>'+chart(item)+'</div><div class="export-actions"><button class="share" id="csv">دانلود CSV</button><button class="share" id="json">دانلود JSON</button><a class="share" href="../history/">آرشیو و Excel</a><span class="meta">'+C.integer(rows.length)+' روز موجود؛ نبود سابقه به معنی صفر نیست.</span></div><div class="tablebox"><table><thead><tr><th>تاریخ</th><th>تعداد نمونه</th><th>میانگین</th><th>میانه</th><th>کمینه</th><th>بیشینه</th><th>آخرین</th><th>کیفیت</th></tr></thead><tbody>'+ (table||'<tr><td colspan="8">تاریخچه‌ای در دسترس نیست.</td></tr>')+'</tbody></table></div>';
 $('#csv').disabled=!rows.length;
 $('#csv').onclick=function(){var keys=['day','symbol','count','mean','median','min','max','last','quality'];download('\uFEFF'+C.csv([keys].concat(rows.map(function(r){return keys.map(function(k){return r[k];});}))),'text/csv;charset=utf-8',symbol+'-history.csv');};
 $('#json').onclick=function(){download(JSON.stringify({source_timestamp:M.sourceTimestamp(market),current:c,history:rows},null,2),'application/json',symbol+'.json');};
 $('#copyLink').onclick=function(){var el=this;if(!navigator.clipboard){el.textContent='کپی پشتیبانی نمی‌شود';return;}navigator.clipboard.writeText(location.href).then(function(){el.textContent='کپی شد';},function(){el.textContent='کپی ناموفق';});};
}
$('#q').oninput=render;$('#sort').onchange=render;
window.addEventListener('popstate',function(){select(new URLSearchParams(location.search).get('symbol'),false);});
Promise.all([load('../data/market.json'),load('../history/data/history.json')]).then(function(results){
 market=results[0];archive=results[1];
 if(!market||!Array.isArray(market.stocks)&&!Array.isArray(market.top_stocks))market=null;
 if(!archive||!Array.isArray(archive.rows))archive=null;
 universe=C.buildUniverse(market,archive);items=Array.from(universe.bySymbol.values());
 $('#count').textContent=C.integer(items.length);$('#stamp').textContent=stamp(M.sourceTimestamp(market));
 var age=Date.now()-Date.parse(M.sourceTimestamp(market)||''),messages=[];
 if(!market)messages.push('دریافت snapshot جاری ناموفق بود؛ داده‌های آرشیوی جای قیمت جاری نیستند.');
 else if(!Number.isFinite(age)||age>24*3600000||age< -300000)messages.push('snapshot قدیمی یا زمان منبع نامعتبر است؛ داده زنده محسوب نمی‌شود.');
 if(universe.partial)messages.push('فهرست جاری کامل نیست؛ فقط نمادهای موجود در داده نمایش داده می‌شوند.');
 if(!archive)messages.push('آرشیو در دسترس نیست؛ اطلاعات جاری همچنان قابل مشاهده است.');
 $('#availability').textContent=messages.length?'داده با محدودیت':'snapshot دریافت شد';$('#notice').hidden=!messages.length;$('#notice').textContent=messages.join(' ');
 render();var wanted=new URLSearchParams(location.search).get('symbol');select(wanted||null,false);
}).catch(function(){ $('#availability').textContent='خطا در نمایش داده';$('#notice').hidden=false;$('#notice').textContent='داده قابل پردازش نیست. صفحه را دوباره بارگذاری کنید.';});
})();
