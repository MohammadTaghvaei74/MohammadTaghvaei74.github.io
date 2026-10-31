/* Median history v1: pure aggregation; only observed minute values. */
(function(root){
'use strict';
const COLORS={market:'#172c45',leaders:'#2379db'}, NAMES={market:'کل بازار',leaders:'لیدرها'};
const minute=p=>Number(p.minute.slice(11,13))*60+Number(p.minute.slice(14,16));
function candles(points,series,frame){
 const groups=new Map();
 for(const p of points){if(!Number.isFinite(p[series]))continue;const b=frame==='daily'?0:Math.floor((minute(p)-555)/Number(frame)); const key=p.minute.slice(0,10)+'/'+b;
 if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}
 return [...groups.entries()].map(([key,rows])=>{rows.sort((a,b)=>a.minute.localeCompare(b.minute));const vs=rows.map(p=>p[series]), count=frame==='daily'?196:Math.min(Number(frame),196-Number(key.split('/')[1])*Number(frame));return {key,date:rows[0].minute.slice(0,10),first:rows[0].minute,last:rows.at(-1).minute,o:vs[0],h:Math.max(...vs),l:Math.min(...vs),c:vs.at(-1),n:rows.length,partial:rows.length<count,expected:count,series};});
}
function samples(points,series){
 const valid=points.filter(p=>Number.isFinite(p[series])).sort((a,b)=>a.minute.localeCompare(b.minute));const buckets=new Map();
 for(const p of valid)buckets.set(p.minute.slice(0,10)+'/'+Math.floor((minute(p)-555)/10),p);
 const seen=new Set(valid.map(p=>p.minute));let prev=null;
 return [...buckets.entries()].map(([key,p])=>{let connected=!!prev&&prev.minute.slice(0,10)===p.minute.slice(0,10);if(connected)for(let t=Date.parse(prev.minute)+60000;t<=Date.parse(p.minute);t+=60000){const stamp=new Date(t+210*60000).toISOString().slice(0,19)+'+03:30';if(!seen.has(stamp)){connected=false;break;}}prev=p;return {key,date:p.minute.slice(0,10),time:p.minute,value:p[series],connected,series};});
}
if(typeof module!=='undefined')module.exports={candles,samples};
if(typeof document==='undefined')return;
const $=s=>document.querySelector(s),fa=new Intl.NumberFormat('fa-IR',{maximumFractionDigits:2}),date=d=>new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',month:'2-digit',day:'2-digit',year:'numeric'}).format(new Date(d+'T12:00:00+03:30')),time=t=>t.slice(11,16).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);
let data;
const el=(tag,attrs={},text='')=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));n.textContent=text;return n;};
function renderChart(id,seriesRows,type){
 const svg=$('#'+id);svg.replaceChildren();const rows=seriesRows.flat(),keys=[...new Set(rows.map(r=>r.key))].sort((a,b)=>a.split('/')[0].localeCompare(b.split('/')[0])||Number(a.split('/')[1])-Number(b.split('/')[1]));
 if(!rows.length){svg.append(el('text',{x:500,y:180,'text-anchor':'middle'},'مشاهده معتبر موجود نیست'));return;}
 const vals=rows.flatMap(r=>type==='candle'?[r.h,r.l]:[r.value]);let lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max((hi-lo)*.12,.1);lo-=pad;hi+=pad;
 const left=75,right=955,top=24,bottom=300,x=k=>left+(keys.indexOf(k)+.5)/keys.length*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 for(let i=0;i<=5;i++){const v=lo+(hi-lo)*i/5;svg.append(el('line',{x1:left,x2:right,y1:y(v),y2:y(v),stroke:'#d8e0e9'}),el('text',{x:65,y:y(v)+4,'text-anchor':'end',class:'axis'},fa.format(v)));}
 const step=Math.max(1,Math.ceil(keys.length/7));keys.forEach((k,i)=>{if(i%step!==0&&i!==keys.length-1)return;const [d,b]=k.split('/'),fr=$('#frame').value;const label=type==='candle'&&fr==='daily'?date(d):time(d+'T'+String(Math.floor((555+Number(b)*(type==='line'?10:Number(fr)))/60)).padStart(2,'0')+':'+String((555+Number(b)*(type==='line'?10:Number(fr)))%60).padStart(2,'0'));svg.append(el('text',{x:x(k),y:325,'text-anchor':'middle',class:'axis'},label));if(!(type==='candle'&&fr==='daily'))svg.append(el('text',{x:x(k),y:345,'text-anchor':'middle',class:'axis small'},date(d)));});
 const hit=[];
 seriesRows.forEach((rs,si)=>{let previous=null;for(const r of rs){const xx=x(r.key)+(type==='candle'&&seriesRows.length===2?(si===0?-1:1)*Math.min(12,(right-left)/keys.length*.17):0),color=COLORS[r.series];
 if(type==='candle'){const w=Math.max(2,Math.min(25,(right-left)/keys.length/(seriesRows.length+1)*.65));svg.append(el('line',{x1:xx,x2:xx,y1:y(r.h),y2:y(r.l),stroke:color,'stroke-width':2,'stroke-dasharray':r.partial?'3 2':'none'}),el('rect',{x:xx-w/2,y:y(Math.max(r.o,r.c)),width:w,height:Math.max(2,Math.abs(y(r.o)-y(r.c))),fill:r.c<r.o?color:'#fff',stroke:color,'stroke-width':2,'stroke-dasharray':r.partial?'3 2':'none',class:'candle-mark'}));}
 else{if(previous&&r.connected)svg.append(el('line',{x1:x(previous.key),x2:xx,y1:y(previous.value),y2:y(r.value),stroke:color,'stroke-width':2,class:'line-segment'}));svg.append(el('circle',{cx:xx,cy:y(r.value),r:4,fill:color,class:'sample-mark'}));previous=r;}
 hit.push({...r,x:xx,y:y(type==='candle'?r.c:r.value)});
 }});
 const cross=el('g',{visibility:'hidden','pointer-events':'none'}),vx=el('line',{y1:top,y2:bottom,stroke:'#8a4d0b','stroke-dasharray':'4 3'}),hy=el('line',{x1:left,x2:right,stroke:'#8a4d0b','stroke-dasharray':'4 3'}),xt=el('text',{y:378,'text-anchor':'middle',class:'cross-label'}),yt=el('text',{x:69,'text-anchor':'end',class:'cross-label'});cross.append(vx,hy,xt,yt);svg.append(cross);
 function show(event){const box=svg.getBoundingClientRect(),px=(event.clientX-box.left)*1000/box.width,py=(event.clientY-box.top)*390/box.height;const r=hit.reduce((a,b)=>Math.hypot(a.x-px,a.y-py)<Math.hypot(b.x-px,b.y-py)?a:b);cross.setAttribute('visibility','visible');vx.setAttribute('x1',r.x);vx.setAttribute('x2',r.x);hy.setAttribute('y1',r.y);hy.setAttribute('y2',r.y);xt.setAttribute('x',Math.max(150,Math.min(850,r.x)));xt.textContent=date(r.date)+' '+time(r.time||r.last);yt.setAttribute('y',r.y-5);yt.textContent=fa.format(type==='candle'?r.c:r.value);const text=type==='candle'?`${NAMES[r.series]} | ${date(r.date)} ${time(r.first)} تا ${time(r.last)} | باز: ${fa.format(r.o)} · بیشینه: ${fa.format(r.h)} · کمینه: ${fa.format(r.l)} · بسته: ${fa.format(r.c)} | ${fa.format(r.n)} از ${fa.format(r.expected)} دقیقه · ${r.partial?'ناقص / دارای فاصله':'کامل'}`:`${NAMES[r.series]} | ${date(r.date)} ${time(r.time)} | امتیاز: ${fa.format(r.value)} · آخرین مشاهده سبد (نه میانگین)${r.connected?'':' · شروع / قطع خط'}`;$('#'+(type==='candle'?'candle':'line')+'-tip').textContent=text;}
 svg.onpointermove=show;svg.onclick=show;svg.onpointerleave=()=>cross.setAttribute('visibility','hidden');
}
function render(){const series=$('#series').value==='both'?['market','leaders']:[$('#series').value],day=$('#day').value,frame=$('#frame').value;const chosen=data.points.filter(p=>day==='all'||p.minute.startsWith(day));renderChart('candles',series.map(s=>candles(frame==='daily'?data.points:chosen,s,frame)),'candle');renderChart('line',series.map(s=>samples(chosen,s)),'line');}
async function load(){try{const response=await fetch('../data/median-history.json?t='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);data=await response.json();if(data.schema_version!==1||!Array.isArray(data.points))throw new Error('schema');const selected=$('#day').value;$('#day').replaceChildren(new Option('همه روزهای موجود','all'));data.coverage.forEach(d=>$('#day').add(new Option(date(d.date),d.date)));$('#day').value=selected==='all'&& !root.historyLoaded?(data.coverage.at(-1)?.date||'all'):selected;root.historyLoaded=true;
$('#status').textContent=`${fa.format(data.coverage.length)} روز دارای مشاهده از پنجره ۳۰ روز تقویمی · ${fa.format(data.points.length)} دقیقه ثبت‌شده · ${date(data.window_start)} تا ${date(data.window_end)} · آخرین مشاهده: ${data.points.length?date(data.points.at(-1).minute.slice(0,10))+' '+time(data.points.at(-1).minute):'—'}`;
$('#coverage').replaceChildren();data.coverage.forEach(d=>{const p=document.createElement('p');p.textContent=`${date(d.date)} — ${fa.format(d.both_series_minutes)} / ۱۹۶ دقیقه مشترک — ${d.partial?'ناقص':'کامل'} | فاقد داده: ${d.missing_ranges.length?d.missing_ranges.map(([a,b])=>time('0000-00-00T'+a)+' تا '+time('0000-00-00T'+b)).join('، '):'ندارد'}`;$('#coverage').append(p);});$('#missing-days').textContent=data.dates_without_observations.map(date).join('، ');$('#provenance').textContent='منبع: ثبت واقعی گردآورنده و آرشیو تأییدشده با زمان دقیق لاگ؛ هیچ بازسازی با اعضای امروز یا مقدار مصنوعی انجام نشده است.';render();}catch(e){$('#status').textContent='دریافت تاریخچه ناموفق است؛ داده قبلی در صورت وجود حفظ شده. '+e.message;}}
['series','day','frame'].forEach(id=>$('#'+id).addEventListener('change',render));load();setInterval(load,60000);
})(typeof window==='undefined'?globalThis:window);
