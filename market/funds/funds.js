/* Absolute weights are percentages of total fund assets, never equity-normalized. */
(function (root) {
  'use strict';
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  function portfolioModel(fund) {
    const holdings = (Array.isArray(fund?.holdings) ? fund.holdings : []).filter(h => h && (h.name || h.symbol)).map(h => ({...h, industry: String(h.industry || '').trim() || 'نامشخص', weight_pct: number(h.weight_pct) !== null && h.weight_pct >= 0 ? h.weight_pct : null}));
    const groups = new Map();
    for (const h of holdings) {
      if (!groups.has(h.industry)) groups.set(h.industry, {name:h.industry, weight_pct:null, count:0, unknown:0});
      const group = groups.get(h.industry);
      group.count++;
      if (h.weight_pct === null) group.unknown++;
      else group.weight_pct = (group.weight_pct ?? 0) + h.weight_pct;
    }
    const total = holdings.reduce((sum,h) => sum + (h.weight_pct ?? 0),0);
    return {holdings, industries:[...groups.values()].sort((a,b)=>(b.weight_pct ?? -1)-(a.weight_pct ?? -1)), available:holdings.length>0, total, unknown:holdings.filter(h=>h.weight_pct===null).length, remainder:Math.max(0,100-total), overflow:total>100};
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function safeSource(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\u0000-\u0020]/.test(value)) return '';
    try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !u.username && !u.password ? value : ''; } catch (_) { return ''; }
  }
  function selectionFunds(summary, portfolios) {
    const map = new Map(summary.filter(f=>f?.symbol).map(f=>[f.symbol,{symbol:f.symbol,name:f.description || f.symbol}]));
    for (const fund of portfolios) if (fund?.symbol) map.set(fund.symbol,{...map.get(fund.symbol),...fund});
    return [...map.values()];
  }
  const faText = value => String(value ?? '').replace(/[0-9]/g, d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const publicNote = value => !value ? '' : /[A-Za-z]/.test(String(value)) ? 'جزئیات گزارش کامل نیست؛ فایل اصلی را بررسی کنید.' : String(value);
  const initialSymbol = (funds, requested, prior) => funds.find(f=>f.symbol===requested)?.symbol || funds.find(f=>f.symbol===prior)?.symbol || funds.find(f=>portfolioModel(f).available)?.symbol || funds[0]?.symbol || '';
  const fmt = (v,d=2) => number(v) === null ? '—' : v.toLocaleString('fa-IR',{maximumFractionDigits:d});
  const pct = v => number(v) === null ? 'نامشخص' : v > 0 && v < 0.05 ? 'کمتر از ۰٫۱٪' : `${v.toLocaleString('fa-IR',{minimumFractionDigits:1,maximumFractionDigits:1})}٪`;
  const holdingLabel = h => String(h.symbol || h.name || '').replace(/ي/g,'ی').replace(/ك/g,'ک');
  const color = i => `hsl(${(i*137.5+165)%360} 48% 38%)`;
  function chartMarkup(items, model, id) {
    if (model.overflow) return '<p class="fund-warning">مجموع وزن‌های گزارش بیش از ۱۰۰٪ است؛ برای جلوگیری از نمایش گمراه‌کننده، نمودار رسم نمی‌شود. وزن‌های اصلی در جدول حفظ شده‌اند.</p>';
    if (!model.available || !items.some(x=>x.weight_pct !== null)) return '<p class="fund-empty">وزن معتبر برای رسم نمودار در دسترس نیست.</p>';
    const slices = [...items].sort((a,b)=>(b.weight_pct ?? -1)-(a.weight_pct ?? -1)).map(x=>({name:holdingLabel(x),weight_pct:x.weight_pct,unknown:x.unknown}));
    if (model.remainder>0) slices.push({name:'افشا‌نشده / غیرسهامی',weight_pct:model.remainder,remainder:true});
    let offset=0;
    const arcs=slices.map((x,i)=>{
      if (!(x.weight_pct>0)) return '';
      const arc=`<circle cx="100" cy="100" r="76" pathLength="100" fill="none" stroke="${x.remainder?'#c5cec8':color(i)}" stroke-width="26" stroke-dasharray="${x.weight_pct} ${100-x.weight_pct}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"><title>${escapeHtml(x.name)}: ${pct(x.weight_pct)}</title></circle>`;
      offset+=x.weight_pct; return arc;
    }).join('');
    return `<div class="fund-donut-layout"><svg viewBox="0 0 200 200" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">توزیع وزن نسبت به کل دارایی صندوق</title><desc id="${id}-desc">تمام وزن‌ها در راهنمای متنی و جدول آمده‌اند. وزن نامشخص صفر نیست.</desc><circle cx="100" cy="100" r="76" fill="none" stroke="#e7ebe5" stroke-width="26"/>${arcs}<text x="100" y="96" text-anchor="middle">${pct(model.total)}</text><text class="donut-caption" x="100" y="118" text-anchor="middle">وزن سهام معلوم</text></svg><p class="fund-method">فهرست کامل زیر نمودار قابل اسکرول است؛ درصد هر ردیف از کل دارایی صندوق است.</p><ul class="fund-legend" tabindex="0" aria-label="راهنمای کامل وزن‌ها">${slices.map((x,i)=>`<li><i aria-hidden="true" style="background:${x.remainder?'#c5cec8':color(i)}"></i><span>${escapeHtml(x.name)}${x.unknown?' (بخشی نامشخص)':''}</span><bdi>${pct(x.weight_pct)}</bdi></li>`).join('')}</ul></div>`;
  }
  async function boot(doc, fetcher) {
    const $ = id => doc.getElementById(id);
    const empty = (columns,message) => `<tr><td colspan="${columns}" class="fund-empty">${escapeHtml(message)}</td></tr>`;
    $('mobileMenuToggle').addEventListener('click',()=>{
      const open = doc.querySelector('.topbar').classList.toggle('menu-open');
      $('mobileMenuToggle').setAttribute('aria-expanded',String(open));
    });
    async function load() {
      $('retryLoad').hidden=true;
      $('loadStatus').textContent='در حال دریافت اطلاعات…';
      const get = async (url,key) => {
        const response=await fetcher(url,{cache:'no-cache'});
        if(!response.ok) throw new Error('HTTP');
        const data=await response.json();
        if(!Array.isArray(data[key])) throw new Error('schema');
        return data;
      };
      const results=await Promise.allSettled([get('../data/funds.json','rows'),get('../data/fund-portfolios.json','funds')]);
      const summary=results[0].status==='fulfilled'?results[0].value.rows:[];
      const payload=results[1].status==='fulfilled'?results[1].value:{funds:[]};
      const failures=results.filter(r=>r.status==='rejected').length;
      $('retryLoad').hidden=!failures;
      $('loadStatus').textContent=failures?'بخشی از داده‌ها دریافت نشد؛ اطلاعات موجود نمایش داده می‌شود.':'اطلاعات دریافت شد؛ تاریخ گزارش هر صندوق را جداگانه بررسی کنید.';
      const funds=selectionFunds(summary,payload.funds);
      const prior=$('fundSelect').value;
      $('fundSelect').innerHTML=funds.map(f=>`<option value="${escapeHtml(f.symbol)}">${escapeHtml(f.symbol)} — ${escapeHtml(f.name || f.symbol)}</option>`).join('') || '<option>صندوقی در دسترس نیست</option>';
      $('fundSelect').disabled=!funds.length;
      $('fundSelect').value=initialSymbol(funds,new URLSearchParams(root.location?.search || '').get('fund'),prior);
      const cell=(value,percent=false,digits=2)=>`<td><bdi>${percent?(number(value)===null?'—':pct(value)):fmt(value,digits)}</bdi></td>`;
      $('fundReportRows').innerHTML=summary.map((f,i)=>`<tr data-fund="${escapeHtml(f.symbol)}"><td>${fmt(i+1,0)}</td><td><button type="button" class="fund-pick" data-symbol="${escapeHtml(f.symbol)}">${escapeHtml(f.symbol)}</button></td>${cell(f.liquidity ?? f.avg_daily_value_billion_toman,false,1)}<td>${escapeHtml(faText(f.portfolio_last_update || f.report_date || '—'))}</td>${cell(f.bubble_pct,true)}${cell(f.portfolio_score)}${cell(f.board_score)}${cell(f.score_diff)}</tr>`).join('') || empty(8,results[0].status==='rejected'?'جدول خلاصه دریافت نشد.':'گزارش خلاصه صندوق‌ها هنوز آماده نیست.');
      function select() {
        const fund=funds.find(f=>f.symbol===$('fundSelect').value) || {};
        const model=portfolioModel(fund);
        $('detailTitle').textContent=fund.name || fund.symbol || 'ترکیب پرتفو';
        $('reportDate').textContent=faText(fund.report_date || 'نامشخص');
        if (fund.symbol && root.location && root.history) {
          const url=new URL(root.location.href); url.searchParams.set('fund',fund.symbol);
          root.history.replaceState(null,'',url.href);
        }
        const source=safeSource(fund.source_url);
        $('sourceLink').hidden=!source; $('sourceMissing').hidden=!!source;
        if(source){$('sourceLink').href=source;$('sourceLink').textContent=`↓ ${fund.source_label || 'دریافت فایل اصلی گزارش'}`;}
        else $('sourceLink').removeAttribute('href');
        $('portfolioStatus').textContent=(model.available?`${fmt(model.holdings.length,0)} ردیف سهام؛ مجموع وزن معلوم ${pct(model.total)}.${model.unknown?` وزن ${fmt(model.unknown,0)} ردیف نامشخص است.`:''}${model.overflow?' هشدار: مجموع وزن‌ها بیش از ۱۰۰٪؛ نمودارها غیرفعال شده‌اند.':''}`:'ریز سهام معتبر برای این صندوق در دسترس نیست. اگر فایل منبع موجود است، گزارش اصلی را بررسی کنید.')+(fund.note?` ${publicNote(fund.note)}`:'');
        $('holdingsCount').textContent=`${fmt(model.holdings.length,0)} ردیف سهام گزارش`;
        $('holdingsRows').innerHTML=[...model.holdings].sort((a,b)=>(b.weight_pct ?? -1)-(a.weight_pct ?? -1)).map(h=>`<tr><td>${escapeHtml(holdingLabel(h))}</td><td>${escapeHtml(h.industry)}</td><td><bdi>${pct(h.weight_pct)}</bdi></td><td>${escapeHtml(h.source_sheet || '—')} / ${escapeHtml(faText(h.source_row ?? '—'))}</td></tr>`).join('') || empty(4,'ریز سهام در دسترس نیست.');
        $('industryRows').innerHTML=model.industries.map(g=>`<tr><td>${escapeHtml(g.name)}</td><td>${fmt(g.count,0)}</td><td><bdi>${pct(g.weight_pct)}</bdi></td><td>${g.unknown?`${fmt(g.unknown,0)} وزن نامشخص؛ جمع فقط وزن‌های معلوم`:'وزن‌های معلوم'}</td></tr>`).join('') || empty(4,'اطلاعات صنایع در دسترس نیست.');
        $('stockChart').innerHTML=chartMarkup(model.holdings,model,'stock');
        $('industryChart').innerHTML=chartMarkup(model.industries,model,'industry');
        for(const row of $('fundReportRows').querySelectorAll('[data-fund]')) row.classList.toggle('selected',row.dataset.fund===fund.symbol);
      }
      $('fundSelect').onchange=select;
      for(const button of $('fundReportRows').querySelectorAll('[data-symbol]')) button.addEventListener('click',()=>{$('fundSelect').value=button.dataset.symbol;select();$('fundSelect').focus();});
      select();
    }
    $('retryLoad').onclick=load;
    await load();
  }
  const api = {holdingLabel, portfolioModel, escapeHtml, safeSource, selectionFunds, chartMarkup, boot, initialSymbol, faText, publicNote};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FundsPage = api;
  if (typeof document === 'object') boot(document, root.fetch.bind(root));
})(typeof window === 'object' ? window : globalThis);
