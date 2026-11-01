/* Optional UI only. Raw accepted payloads are never mutated; no recommendation math. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'sorena-watch:design-extras:layout:v1';
  const SELECTION_KEY = 'sorena-watch:design-extras:selection:v1';
  const MAX_SELECTION = 4;
  const SYMBOL_FIELDS = [['score','امتیاز خام تابلو'],['last_pct','تغییر آخرین قیمت'],['trade_value_toman','ارزش معاملات']];
  const FUND_FIELDS = [['portfolio_score','امتیاز پرتفو گزارش'],['report_board_score','امتیاز تابلو در گزارش'],['bubble_pct','حباب در گزارش'],['liquidity','میانگین ارزش روزانه گزارش'],['board_score','امتیاز تابلو رصدشده'],['price_change_pct','تغییر آخرین قیمت رصدشده'],['trade_value_toman','ارزش معاملات رصدشده']];
  const safeText = v => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const rows = v => Array.isArray(v) ? v.filter(object) : [];
  const observation = row => safeText(row && (row.observed_at || row.source_at || row.timestamp)) || null;
  const fa = v => safeText(v).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  function finite(v) {
    if (!['string','number'].includes(typeof v) || (typeof v === 'string' && !v.trim())) return null;
    return Number.isFinite(Number(v)) ? Number(v) : null;
  }
  function displayValue(v) {
    const n = finite(v);
    return n === null ? 'در دسترس نیست' : n.toLocaleString('fa-IR', {maximumFractionDigits: 4});
  }
  function stateFor(stamp, now = Date.now(), safety = root && root.ObservationSafety) {
    if (!stamp || !safety || typeof safety.freshness !== 'function' || typeof safety.range !== 'function') return 'unknown';
    try { return safety.freshness(safety.range([{timestamp:stamp}]), {now}).status; } catch (_) { return 'unknown'; }
  }
  function metric(value, unit, observedAt, provenance, reportDate = null, source = '') {
    return {value:finite(value), unit, observedAt:observedAt || null, provenance, reportDate, source};
  }
  function catalog(snapshot, summary) {
    const data = object(snapshot) ? snapshot : {};
    const report = object(summary) ? summary : object(data.fund_report) ? data.fund_report : {};
    const stocks = rows(data.stocks);
    const leveraged = rows(data.leveraged);
    const board = stocks.concat(leveraged);
    const reportRows = rows(report.rows).filter(r => safeText(r.symbol));
    const fundNames = new Set(reportRows.concat(leveraged).map(r => r.symbol));
    const source = safeText(data.source) || 'market.json (snapshot پذیرفته‌شده)';
    const reportSource = safeText(report.portfolio_source) || 'funds.json / fund_report';
    const result = [], seen = new Set();
    for (const row of stocks) {
      const symbol = safeText(row.symbol);
      if (!symbol || fundNames.has(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      const stamp = observation(row), metrics = {};
      for (const [key] of SYMBOL_FIELDS) metrics[key] = metric(row[key], key === 'trade_value_toman' ? 'تومان' : key === 'last_pct' ? 'درصد' : 'امتیاز خام', stamp, 'live-board', null, source);
      result.push({id:'symbol:'+symbol, type:'symbol', symbol, label:safeText(row.description) || symbol, metrics, source});
    }
    seen.clear();
    // A known leveraged row remains a fund even if its archival report is absent.
    const allFunds = reportRows.concat(leveraged.filter(r => !reportRows.some(f => f.symbol === r.symbol)).map(r => ({symbol:r.symbol,instrument:r.instrument,description:r.description})));
    for (const row of allFunds) {
      const symbol = safeText(row.symbol);
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      const matches = board.filter(b => row.instrument ? safeText(b.instrument) === safeText(row.instrument) : b.symbol === symbol);
      // Never join mismatched identities on a similar name; ambiguous IDs stay unknown.
      const live = matches.find(b => b.symbol === symbol) || (matches.length === 1 ? matches[0] : null);
      const date = safeText(row.portfolio_last_update || row.report_date) || null;
      const stamp = observation(live);
      const metrics = {
        portfolio_score:metric(row.portfolio_score,'امتیاز خام',null,'archive-report',date,reportSource),
        report_board_score:metric(row.board_score,'امتیاز خام',observation(row),'report-board',null,reportSource),
        bubble_pct:metric(row.bubble_pct,'درصد',observation(row),'report-board',date,reportSource),
        liquidity:metric(row.liquidity ?? row.avg_daily_value_billion_toman,'میلیارد تومان',null,'historical-liquidity',null,reportSource),
        board_score:metric(live && live.score,'امتیاز خام',stamp,'live-board',null,source),
        price_change_pct:metric(live && live.last_pct,'درصد',stamp,'live-board',null,source),
        trade_value_toman:metric(live && live.trade_value_toman,'تومان',stamp,'live-board',null,source)
      };
      metrics.liquidity.basis = safeText(row.liquidity_basis || report.portfolio_contract?.liquidity_basis || report.liquidity_basis);
      metrics.portfolio_score.note = 'زمان مشاهده ورودی‌های امتیاز پرتفو در این گزارش قابل تأیید نیست.';
      result.push({id:'fund:'+symbol,type:'fund',symbol,label:safeText(row.description)||symbol,reportDate:date,metrics,source:reportSource});
    }
    return result;
  }
  function normalizeSelection(ids) {
    const result = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !/^(symbol|fund):.+/.test(id) || id.length > 300 || result.includes(id)) continue;
      if (result.length && id.split(':')[0] !== result[0].split(':')[0]) continue;
      if (result.length < MAX_SELECTION) result.push(id);
    }
    return result;
  }
  function selectComparable(items, ids) {
    const map = new Map(rows(items).map(item => [item.id,item]));
    return normalizeSelection(ids).map(id => map.get(id)).filter(Boolean);
  }
  function normalizePreferences(value, ids) {
    const v = object(value) ? value : {}, allowed = new Set(ids);
    const hidden = [...new Set((Array.isArray(v.hidden) ? v.hidden : []).filter(id => allowed.has(id)))];
    const order = [...new Set((Array.isArray(v.order) ? v.order : []).filter(id => allowed.has(id)))];
    return {hidden,order:order.concat(ids.filter(id => !order.includes(id)))};
  }
  function load(storage, key, fallback) {
    try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
  }
  function save(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  const readPreferences = (storage, ids) => normalizePreferences(load(storage, STORAGE_KEY, {}), ids);
  const writePreferences = (storage, value) => save(storage, STORAGE_KEY, value);
  function metricStatus(item, m, now = Date.now()) {
    if (!m) return 'منبع و زمان در دسترس نیست';
    const src = 'منبع: ' + m.source + ' · ';
    if (m.provenance === 'archive-report') return src + 'گزارش آرشیوی · تاریخ ترکیب پرتفو: ' + (fa(m.reportDate) || 'ثبت نشده') + ' · ' + (m.note || '');
    if (m.provenance === 'historical-liquidity') return src + 'داده تاریخی · مبنا: ' + (m.basis || 'ثبت نشده') + ' · تاریخ پایان دوره ثبت نشده؛ تازگی قابل تأیید نیست';
    const status = stateFor(m.observedAt, now);
    const label = {fresh:'به‌روز نسبت به جلسه بازار',stale:'داده قدیمی',unknown:'تازگی قابل تأیید نیست'}[status] || 'تازگی قابل تأیید نیست';
    return src + (m.provenance === 'report-board' ? 'مقدار ثبت‌شده در گزارش؛ ' : 'تابلو رصدشده؛ ') + label + ' · زمان مشاهده: ' + (fa(m.observedAt) || 'ثبت نشده');
  }

  let latest = null, latestFunds = null, instance = null;
  function accept(data, summary) {
    if (object(data) && (Array.isArray(data.stocks) || Array.isArray(data.leveraged))) latest = data;
    if (object(summary) && Array.isArray(summary.rows)) latestFunds = summary;
    if (instance) instance.refresh();
  }
  function mount(options = {}) {
    const doc = options.document || (root && root.document);
    if (!doc) return null;
    if (options.snapshot) accept(options.snapshot, options.funds);
    if (instance) return instance.node;
    const main = options.main || doc.querySelector('main#overview, main');
    if (!main) return null;
    const win = doc.defaultView;
    let storage = options.storage;
    if (!storage) { try { storage = win.localStorage; } catch (_) { storage = null; } }
    const el = (tag, text, attrs = {}, parent) => {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = safeText(text);
      for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value));
      if (parent) parent.append(node);
      return node;
    };
    // Explicit overview groups: never include transport/status/navigation or another route's cards.
    const definitions = [
      ['daily','.daily-overview-pair','ارزش معاملات و توزیع قیمت'],
      ['intraday','.top-charts','روندهای درون‌روزی بازار'],
      ['queue-count','.queue-count-section','تعداد صف‌های بازار'],
      ['leaders','#leaders','تمرکز بازار'],
      ['comprehensive','#comprehensive-table','جدول جامع بازار'],
      ['industries','#industries','صنایع']
    ];
    const sections = main.id === 'overview' ? definitions.map(([id,selector,label]) => ({id,el:main.querySelector(selector),label})).filter(x => x.el && x.el.parentElement === main) : [];
    const slots = sections.map(item => {
      const marker = doc.createComment('sorena-extras-position');
      item.el.before(marker);
      item.el.dataset.extrasSection = item.id;
      return marker;
    });
    const ids = sections.map(x => x.id);
    let prefs = readPreferences(storage, ids);
    let selected = normalizeSelection(load(storage, SELECTION_KEY, []));
    let items = [], loading = false, attempted = false, timer = null;
    const toolbar = el('section',undefined,{'data-sorena-extras':'toolbar',class:'sorena-extras-toolbar','aria-labelledby':'sorena-extras-title'});
    const heading = el('div',undefined,{class:'sorena-extras-heading'},toolbar);
    el('h2','تنظیم نمایش / مقایسه',{id:'sorena-extras-title'},heading);
    const actions = el('div',undefined,{class:'sorena-extras-actions'},toolbar);
    const compareButton = el('button','مقایسه ابزارها',{type:'button',class:'sorena-extras-button','aria-expanded':'false','aria-controls':'sorena-extras-compare'},actions);
    const layoutButton = el('button','تنظیم بخش‌ها',{type:'button',class:'sorena-extras-button','aria-expanded':'false','aria-controls':'sorena-extras-personalize'},actions);
    layoutButton.hidden = !sections.length;
    const compare = el('div',undefined,{id:'sorena-extras-compare',class:'sorena-extras-panel',hidden:''},toolbar);
    const personal = el('div',undefined,{id:'sorena-extras-personalize',class:'sorena-extras-panel',hidden:''},toolbar);
    el('p','حداکثر ۴ نماد یا ۴ صندوق؛ فقط مقادیر خام با واحد و زمان مستقل. پیشنهاد خرید یا فروش محاسبه نمی‌شود.',{class:'sorena-extras-disclaimer'},compare);
    el('div','راهنمای منبع: «گزارش آرشیوی» = تاریخ گزارش پرتفو؛ «تابلو رصدشده» = زمان مشاهدهٔ ردیف پذیرفته‌شده؛ «تازگی قابل تأیید نیست» = زمان مشاهده در منبع ثبت نشده است.',{class:'sorena-extras-provenance-legend',role:'note'},compare);
    const controls = el('div',undefined,{class:'sorena-extras-controls'},compare);
    const selectLabel = el('label','افزودن ابزار هم‌نوع',{for:'sorena-extras-pick'},controls);
    const select = el('select',undefined,{id:'sorena-extras-pick',class:'sorena-extras-select'},selectLabel);
    const clear = el('button','پاک‌کردن مقایسه',{type:'button',class:'sorena-extras-button'},controls);
    const retry = el('button','دریافت داده مقایسه',{type:'button',class:'sorena-extras-button'},controls);
    const message = el('p','هنوز داده مقایسه دریافت نشده است.',{role:'status','aria-live':'polite',class:'sorena-extras-message'},compare);
    const chips = el('div',undefined,{class:'sorena-extras-selected'},compare);
    const tableHost = el('div',undefined,{class:'sorena-extras-comparison',role:'region','aria-label':'مقایسه؛ برای ستون‌های بیشتر افقی پیمایش کنید',tabindex:'0'},compare);
    const notice = el('p','تنظیم‌ها فقط در همین مرورگر ذخیره می‌شوند؛ داده‌ها حذف نمی‌شوند.',{class:'sorena-extras-disclaimer'},personal);
    const list = el('div',undefined,{class:'sorena-extras-section-list'},personal);
    const reset = el('button','بازنشانی ترتیب و نمایش',{type:'button',class:'sorena-extras-button'},personal);
    const persist = () => { if (!save(storage,SELECTION_KEY,selected)) message.textContent = 'ذخیره‌سازی مرورگر در دسترس نیست؛ تغییرات فقط در این صفحه باقی می‌ماند.'; };
    const saveLayout = () => { if (!writePreferences(storage,prefs)) notice.textContent = 'ذخیره‌سازی مرورگر در دسترس نیست؛ تغییرات فقط در این صفحه باقی می‌ماند.'; };
    function applyLayout() {
      prefs.order.forEach((id,index) => {
        const section = sections.find(x => x.id === id);
        section.el.toggleAttribute('data-sorena-extras-hidden',prefs.hidden.includes(id));
        slots[index].after(section.el);
      });
    }
    function drawLayout(focusId, direction) {
      list.replaceChildren();
      prefs.order.forEach((id,index) => {
        const item = sections.find(x => x.id === id);
        const row = el('div',undefined,{class:'sorena-extras-section-row'},list);
        const label = el('label',undefined,{class:'sorena-extras-check-label'},row);
        const check = el('input',undefined,{type:'checkbox'},label);
        check.checked = !prefs.hidden.includes(id);
        el('span',item.label,{},label);
        check.addEventListener('change',() => { prefs.hidden = prefs.hidden.filter(x => x !== id); if (!check.checked) prefs.hidden.push(id); applyLayout(); saveLayout(); });
        [-1,1].forEach(delta => {
          const word = delta === -1 ? 'بالا' : 'پایین';
          const move = el('button',word,{type:'button',class:'sorena-extras-order','aria-label':`انتقال ${item.label} به ${word}`},row);
          move.disabled = index+delta < 0 || index+delta >= prefs.order.length;
          move.addEventListener('click',() => { [prefs.order[index],prefs.order[index+delta]] = [prefs.order[index+delta],prefs.order[index]]; applyLayout(); saveLayout(); drawLayout(id,delta); });
          if (id === focusId && direction === delta) { if (!move.disabled) move.focus(); else check.focus(); }
        });
      });
    }
    function drawTable() {
      tableHost.replaceChildren();
      if (!selected.length) return;
      const chosen = selected.map(id => items.find(x => x.id === id) || {id,type:id.split(':')[0],symbol:id.slice(id.indexOf(':')+1),metrics:{}});
      const table = el('table',undefined,{class:'sorena-extras-table','data-custom-sort':'true'},tableHost);
      el('caption','مقایسه مقادیر خام؛ تاریخ هر معیار مستقل است',{},table);
      const head = el('tr',undefined,{},el('thead',undefined,{},table));
      el('th','معیار / واحد',{scope:'col'},head);
      chosen.forEach(item => el('th',item.symbol,{scope:'col'},head));
      const body = el('tbody',undefined,{},table);
      (chosen[0].type === 'fund' ? FUND_FIELDS : SYMBOL_FIELDS).forEach(([key,label]) => {
        const row = el('tr',undefined,{},body);
        el('th',label,{scope:'row'},row);
        chosen.forEach(item => {
          const m = item.metrics[key], cell = el('td',undefined,{},row);
          const status = !m ? 'unknown' : m.provenance === 'archive-report' || m.provenance === 'historical-liquidity' ? 'archive' : stateFor(m.observedAt);
          cell.dataset.extrasStatus = status;
          const value = el('bdi',displayValue(m && m.value) + (m ? ' '+m.unit : ''),{class:'sorena-extras-value'},cell);
          value.title = m && m.value !== null ? String(m.value) + ' ' + m.unit : 'در دسترس نیست';
          el('small',metricStatus(item,m),{class:'sorena-extras-provenance'},cell);
        });
      });
    }
    function draw() {
      items = catalog(latest,latestFunds);
      select.replaceChildren(el('option','انتخاب نماد یا صندوق…',{value:''}));
      const type = selected.length ? selected[0].split(':')[0] : null;
      items.forEach(item => {
        const option = el('option',item.symbol + ' · ' + (item.type === 'fund' ? 'صندوق' : 'نماد'),{value:item.id},select);
        option.disabled = selected.includes(item.id) || selected.length >= MAX_SELECTION || !!(type && type !== item.type);
      });
      chips.replaceChildren();
      selected.forEach(id => {
        const name = id.slice(id.indexOf(':')+1);
        const chip = el('span',undefined,{class:'sorena-extras-chip'},chips);
        el('bdi',name,{},chip);
        const remove = el('button','حذف',{type:'button',class:'sorena-extras-remove','aria-label':'حذف '+name+' از مقایسه'},chip);
        remove.addEventListener('click',() => { selected = selected.filter(x => x !== id); draw(); persist(); select.focus(); });
      });
      message.textContent = loading ? 'در حال دریافت نسخه عمومی داده…' : !items.length ? 'داده معتبر برای مقایسه در دسترس نیست؛ دریافت داده را دوباره امتحان کنید.' : selected.length ? fa(selected.length)+' از ۴ ابزار انتخاب شده؛ ابزارهای غیرهم‌نوع غیرفعال هستند.' : 'یک نماد یا صندوق انتخاب کنید؛ ابزارهای انتخاب‌شده پس از بستن صفحه حفظ می‌شوند.';
      drawTable();
    }
    // Lazy public-snapshot fallback only. Never wrap fetch, duplicate collectors,
    // or call ObservationSafety.accept on another consumer's behalf.
    async function loadPublic() {
      if (loading || !win.fetch) return;
      loading = true; attempted = true; draw();
      const revision = latest;
      const script = [...doc.scripts].find(s => /\/design-extras\.js(?:\?|$)/.test(s.src));
      const base = new URL('./data/', script ? script.src : new URL('/market/design-extras.js',win.location.href));
      const get = async name => {
        const controller = new AbortController(), timeout = win.setTimeout(() => controller.abort(),10000);
        try {
          const response = await win.fetch(new URL(name,base).href,{cache:'no-cache',signal:controller.signal});
          if (!response.ok) throw new Error('HTTP');
          const payload = await response.json();
          if (!object(payload)) throw new Error('schema');
          return payload;
        } finally { win.clearTimeout(timeout); }
      };
      await Promise.all([
        latest ? Promise.resolve() : get('market.json').then(payload => { if (latest === revision && [1,2].includes(payload.schema_version) && Array.isArray(payload.stocks)) latest = payload; }).catch(() => {}),
        get('funds.json').then(payload => { if (Array.isArray(payload.rows)) latestFunds = payload; }).catch(() => {})
      ]);
      loading = false; draw();
    }
    select.addEventListener('change',() => {
      const next = items.find(x => x.id === select.value);
      if (!next || selected.length >= MAX_SELECTION || selected.includes(next.id) || (selected.length && selected[0].split(':')[0] !== next.type)) return;
      selected.push(next.id); draw(); persist(); select.focus();
    });
    clear.addEventListener('click',() => { selected=[]; draw(); persist(); select.focus(); });
    retry.addEventListener('click',loadPublic);
    compareButton.addEventListener('click',() => {
      compare.hidden = !compare.hidden;
      compareButton.setAttribute('aria-expanded',String(!compare.hidden));
      if (!compare.hidden) {
        draw();
        if (!attempted) void loadPublic();
        if (!timer) timer = win.setInterval(drawTable,15000);
      } else { win.clearInterval(timer); timer=null; }
    });
    layoutButton.addEventListener('click',() => { personal.hidden=!personal.hidden; layoutButton.setAttribute('aria-expanded',String(!personal.hidden)); if (!personal.hidden) drawLayout(); });
    reset.addEventListener('click',() => { prefs=normalizePreferences({},ids); applyLayout(); saveLayout(); drawLayout(); });
    toolbar.addEventListener('keydown',event => {
      if (event.key !== 'Escape') return;
      const target = personal.contains(event.target) ? layoutButton : compareButton;
      if (!personal.hidden && personal.contains(event.target)) { personal.hidden=true; layoutButton.setAttribute('aria-expanded','false'); }
      if (!compare.hidden && compare.contains(event.target)) { compare.hidden=true; compareButton.setAttribute('aria-expanded','false'); win.clearInterval(timer); timer=null; }
      target.focus();
    });
    function reveal(hash) {
      let target;
      try { target=doc.getElementById(decodeURIComponent(hash.slice(1))); } catch (_) { return; }
      const item=sections.find(x=>x.el === target || (target && x.el.contains(target)));
      if (item && prefs.hidden.includes(item.id)) { prefs.hidden=prefs.hidden.filter(id=>id!==item.id); applyLayout(); saveLayout(); drawLayout(); }
    }
    if (sections.length) {
      win.addEventListener('hashchange',()=>reveal(win.location.hash));
      doc.addEventListener('click',event=>{ const anchor=event.target.closest && event.target.closest('a[href]'); if (!anchor) return; const url=new URL(anchor.href,win.location.href); if (url.pathname===win.location.pathname && url.origin===win.location.origin) reveal(url.hash); });
    }
    main.prepend(toolbar);
    applyLayout(); drawLayout(); draw(); reveal(win.location.hash);
    instance={node:toolbar,refresh:draw};
    toolbar.refresh = data => accept(data);
    return toolbar;
  }
  const api = {STORAGE_KEY,SELECTION_KEY,MAX_SELECTION,catalog,buildInstrumentCatalog:catalog,selectComparable,normalizeSelection,normalizePreferences,readPreferences,writePreferences,displayValue,safeText,stateFor,metricStatus,mount,accept};
  if (typeof module === 'object' && module.exports) module.exports=api;
  if (root) {
    root.SorenaExtras=api;
    root.addEventListener('market:snapshot',event=>accept(event.detail));
    const start=()=>mount();
    if (root.document.readyState==='loading') root.document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
  }
})(typeof window === 'object' ? window : null);
