/* Additive data interactions: delegates filtering/sorting/data truth to existing renderers. */
(function (root) {
  'use strict';
  var KEYS = ['symbol','industry','score','score_10d_total','score_position_pct','industry_score_position_pct','avg_trade_value_toman','last_close_diff_pct','queue_value_toman','buy_per_capita_toman','buyer_power','legal_buy_pct','legal_sell_pct'];
  var LABELS = {symbol:'نماد',industry:'صنعت',score:'امتیاز',score_10d_total:'مجموع ۱۰ روزه',score_position_pct:'جایگاه بازار',industry_score_position_pct:'جایگاه صنعت',avg_trade_value_toman:'میانگین ارزش (میلیارد تومان)',last_close_diff_pct:'اختلاف آخرین و پایانی (%)',queue_value_toman:'صف (میلیارد تومان)',buy_per_capita_toman:'سرانه خرید (میلیون تومان)',buyer_power:'قدرت',legal_buy_pct:'خرید حقوقی (%)',legal_sell_pct:'فروش حقوقی (%)'};
  var STORAGE = 'sorena.comprehensive.presets.v1';
  var CHARTS = {
    turnoverChart: ['.turnover-bar','.ma5-path','.ma20-path'],
    queueChart: ['.chart-buy','.chart-sell'],
    marketChart: ['.chart-leaders','.chart-market'],
    queueCountChart: ['.chart-buy','.chart-sell']
  };
  var chartNames = {turnoverChart:['ارزش معاملات روزانه','میانگین ۵ روزه','میانگین ۲۰ روزه'],queueChart:['صف خرید','صف فروش'],marketChart:['امتیاز لیدرها','امتیاز کل بازار'],queueCountChart:['تعداد صف خرید','تعداد صف فروش']};
  function presetName(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value)) throw Error('نام باید بین ۱ تا ۸۰ نویسه باشد.');
    return value.trim();
  }
  function validateFilters(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error('فیلتر نامعتبر است.');
    var result = {};
    Object.keys(value).forEach(function (key) {
      if (KEYS.indexOf(key) < 0) throw Error('ستون ناشناخته است.');
      var conditions = value[key] && value[key].conditions;
      if (!Array.isArray(conditions) || conditions.length < 1 || conditions.length > 20) throw Error('شرط نامعتبر است.');
      result[key] = {conditions: conditions.map(function (c) {
        if (!c || ['','<','>','=','>=','<='].indexOf(c.operator) < 0 || typeof c.value !== 'string' || c.value.length > 200) throw Error('شرط نامعتبر است.');
        return {operator:c.operator, value:c.value};
      })};
    });
    return result;
  }
  function validatePresets(items) {
    if (!Array.isArray(items) || items.length > 30) throw Error('فهرست ذخیره‌شده معتبر نیست (حداکثر ۳۰ مورد).');
    return items.map(function (p) { return {name:presetName(p.name), filters:validateFilters(p.filters)}; });
  }
  function loadPresets(storage) {
    try { var raw = storage.getItem(STORAGE); return {ok:true,items:raw ? validatePresets(JSON.parse(raw)) : []}; }
    catch (e) { return {ok:false,items:[],error:'خواندن فیلترهای ذخیره‌شده ممکن نیست؛ فیلتر دستی همچنان فعال است.'}; }
  }
  function savePresets(storage, items) {
    try { storage.setItem(STORAGE, JSON.stringify(validatePresets(items))); return {ok:true}; }
    catch (e) { return {ok:false,error:'ذخیره انجام نشد؛ فضای مرورگر یا مجوز ذخیره‌سازی را بررسی کنید.'}; }
  }
  function browserStorage() { try { return root.localStorage; } catch(e) { return null; } }
  function chartSeriesSelector(id) { return CHARTS[id] ? CHARTS[id].slice() : []; }
  function isSortableHeader(header) { return !!(header && header.dataset && header.dataset.sortKey); }
  function narrowAxisIndices(count) {
    if (count <= 3) return Array.from({length:count}, function (_, i) { return i; });
    var indexes = [0];
    for (var i = 2; i < count - 1; i += 2) indexes.push(i);
    indexes.push(count - 1);
    return indexes.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }
  function signalCardModel(cells) {
    if (!Array.isArray(cells) || cells.length < 4) throw Error('ردیف سیگنال ناقص است.');
    return {type:String(cells[0] || '—'),symbol:String(cells[1] || '—'),time:String(cells[2] || '—'),explanation:String(cells[3] || '—')};
  }
  function eventOf(type) { try { return new Event(type, {bubbles:true}); } catch (e) { var ev = document.createEvent('Event'); ev.initEvent(type, true, true); return ev; } }
  function emit(control, type) { if (control) control.dispatchEvent(eventOf(type)); }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function controlsFor(host) { return Array.prototype.slice.call(host ? host.querySelectorAll('.filter-pair') : []); }
  function conditionsFor(host) {
    var pairs = controlsFor(host);
    if (!pairs.length && host) { var input = host.querySelector('input.column-filter'); return [{operator:'',value:input ? input.value : ''}]; }
    return pairs.map(function (pair) { var input = pair.querySelector('input.column-filter'); var select = pair.querySelector('select.filter-operator'); return {operator:select ? select.value : '',value:input ? input.value : ''}; });
  }
  function initFilters(doc) {
    var table = doc.querySelector('#comprehensiveTable');
    if (!table || table.dataset.diFilters === 'true') return;
    if (!table.querySelector('[data-filter-key]')) return;
    var scroll = table.parentElement;
    if (!scroll) return;
    var toolbar = doc.createElement('section'); toolbar.className = 'di-filter-toolbar'; toolbar.setAttribute('aria-label','فیلترهای سریع جدول جامع');
    var head = doc.createElement('div'); head.className = 'di-filter-toolbar-head';
    head.innerHTML = '<strong>فیلتر جدول</strong><button type="button" class="di-filter-toggle" aria-expanded="false">نمایش فیلترها</button><span class="di-filter-status" role="status" aria-live="polite"></span>';
    toolbar.appendChild(head);
    var body = doc.createElement('div'); body.className = 'di-filter-toolbar-body'; body.hidden = true;
    var fields = doc.createElement('div'); fields.className = 'di-filter-fields'; body.appendChild(fields);
    var actions = doc.createElement('div'); actions.className = 'di-filter-actions';
    actions.innerHTML = '<button type="button" class="di-filter-reset">پاک‌کردن همه</button><div class="di-preset-controls"><label>ذخیره به نام <input class="di-preset-name" maxlength="80" type="text" aria-label="نام فیلتر ذخیره‌شده"></label><button type="button" class="di-preset-save">ذخیره</button><label>فیلتر ذخیره‌شده <select class="di-preset-select" aria-label="فیلتر ذخیره‌شده"><option value="">انتخاب کنید</option></select></label><button type="button" class="di-preset-apply">اعمال</button><button type="button" class="di-preset-delete">حذف</button></div>';
    body.appendChild(actions);
    var chips = doc.createElement('div'); chips.className = 'di-filter-chips'; chips.setAttribute('aria-label','فیلترهای فعال'); body.appendChild(chips);
    toolbar.appendChild(body); scroll.parentNode.insertBefore(toolbar, scroll);
    table.dataset.diFilters = 'true';
    var toggle = head.querySelector('.di-filter-toggle'), status = head.querySelector('.di-filter-status');
    var targets = {};
    function targetFor(key) {
      if (targets[key] && targets[key].isConnected) return targets[key];
      var control = table.querySelector('[data-filter-key="' + key + '"]');
      targets[key] = control ? (control.closest('th') || control.parentElement) : null;
      return targets[key];
    }
    function fieldConditions(field) { return conditionsFor(targetFor(field.dataset.key)); }
    function createField(key) {
      var host = doc.createElement('div'); host.className = 'di-filter-field'; host.dataset.key = key;
      var label = doc.createElement('label'); label.textContent = LABELS[key] || key; host.appendChild(label);
      var conditionHost = doc.createElement('div'); conditionHost.className = 'di-filter-condition-list'; host.appendChild(conditionHost);
      function addCondition(condition, index) {
        var line = doc.createElement('span'); line.className = 'di-condition'; line.dir = 'ltr';
        var target = targetFor(key); var source = target && target.querySelectorAll('.filter-pair')[index]; var sourceSelect = source && source.querySelector('select.filter-operator');
        if (key !== 'symbol' && key !== 'industry') {
          var select = doc.createElement('select'); select.setAttribute('aria-label', 'عملگر ' + (LABELS[key] || key));
          var options = sourceSelect ? Array.prototype.slice.call(sourceSelect.options).map(function (o) { return {value:o.value,text:o.textContent}; }) : [{value:'',text:'شرط'},{value:'>',text:'>'},{value:'<',text:'<'},{value:'=',text:'='}];
          options.forEach(function (o) { var option=doc.createElement('option'); option.value=o.value; option.textContent=o.text; select.appendChild(option); });
          select.value = condition.operator || select.value; line.appendChild(select);
        }
        var input = doc.createElement('input'); input.type = key === 'symbol' || key === 'industry' ? 'search' : 'text'; input.className = 'di-condition-input'; input.value = condition.value || ''; input.placeholder = key === 'symbol' ? 'نماد' : key === 'industry' ? 'نام صنعت' : 'عدد'; input.setAttribute('aria-label','مقدار ' + (LABELS[key] || key)); line.appendChild(input);
        if (index > 0) { var remove=doc.createElement('button'); remove.type='button'; remove.className='di-remove-condition'; remove.textContent='×'; remove.setAttribute('aria-label','حذف شرط دوم'); line.appendChild(remove); remove.addEventListener('click', function(){ var t=targetFor(key), pairs=controlsFor(t); if(pairs[index] && pairs[index].querySelector('.remove-filter')) pairs[index].querySelector('.remove-filter').click(); refresh(); }); }
        Array.prototype.forEach.call(line.querySelectorAll('input,select'), function (control) { control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', function(){ syncToExisting(key, index, line); }); });
        conditionHost.appendChild(line);
      }
      (fieldConditions(host).length ? fieldConditions(host) : [{operator:'',value:''}]).forEach(addCondition);
      var add=doc.createElement('button'); add.type='button'; add.className='di-add-condition'; add.textContent='+ شرط'; add.addEventListener('click',function(){var t=targetFor(key),nativeAdd=t&&t.querySelector('.add-filter'); if(nativeAdd) nativeAdd.click(); refresh();}); host.appendChild(add);
      fields.appendChild(host);
    }
    var keys = Array.prototype.slice.call(table.querySelectorAll('thead tr:first-child th[data-sort-key]')).map(function (h) { return h.dataset.sortKey; }).filter(function (k) { return KEYS.indexOf(k)>=0 && targetFor(k); });
    keys.forEach(createField);
    function moduleConditions(key) { var field=fields.querySelector('.di-filter-field[data-key="'+key+'"]'); return field ? Array.prototype.map.call(field.querySelectorAll('.di-condition'), function(line){var input=line.querySelector('input'),select=line.querySelector('select');return {operator:select?select.value:'',value:input?input.value:''};}) : []; }
    function readFilters() { var result={}; keys.forEach(function(key){ var c=moduleConditions(key); if(c.some(function(x){return x.value;})) result[key]={conditions:c}; }); return result; }
    function syncToExisting(key,index,line) {
      var t=targetFor(key), pairs=controlsFor(t); if(!t || !pairs[index]) return;
      var input=line.querySelector('input'), select=line.querySelector('select'); var nativeInput=pairs[index].querySelector('input.column-filter'), nativeSelect=pairs[index].querySelector('select.filter-operator');
      if(nativeInput) nativeInput.value=input.value; if(nativeSelect&&select) nativeSelect.value=select.value;
      emit(nativeInput || nativeSelect, nativeInput ? 'input' : 'change'); refresh();
    }
    function refresh() {
      keys.forEach(function(key){ var f=fields.querySelector('.di-filter-field[data-key="'+key+'"]'), c=conditionsFor(targetFor(key)); var lines=f?f.querySelectorAll('.di-condition'):[]; if(lines.length!==c.length){var next=f.nextSibling;f.remove();createField(key);f=fields.lastElementChild;fields.insertBefore(f,next);lines=f.querySelectorAll('.di-condition');} c.forEach(function(condition,i){if(lines[i]){var input=lines[i].querySelector('input');var select=lines[i].querySelector('select');if(input&&input.value!==condition.value)input.value=condition.value;if(select&&select.value!==condition.operator)select.value=condition.operator;}}); });
      chips.innerHTML=''; var active=0; keys.forEach(function(key){ fieldConditions(fields.querySelector('.di-filter-field[data-key="'+key+'"]')).forEach(function(c,i){if(!c.value)return;active++;var b=doc.createElement('button');b.type='button';b.className='di-filter-chip';b.textContent=(LABELS[key]||key)+' '+(c.operator||'شامل')+' '+c.value;b.addEventListener('click',function(){var t=targetFor(key),p=controlsFor(t)[i],input=p&&p.querySelector('input.column-filter');if(input){input.value='';emit(input,'input');}refresh();});chips.appendChild(b);});}); status.textContent=active ? active+' فیلتر فعال' : 'فیلتر فعالی نیست';
    }
    function clearAll(){var clear=doc.querySelector('#clearComprehensiveFilters'); if(clear) clear.click(); else table.querySelectorAll('input.column-filter').forEach(function(i){i.value='';emit(i,'input');}); refresh();}
    function populatePresets(){var load=loadPresets(browserStorage());var select=actions.querySelector('.di-preset-select');select.querySelectorAll('option:not(:first-child)').forEach(function(o){o.remove();});if(!load.ok){status.textContent=load.error;return;}load.items.forEach(function(p,i){var o=doc.createElement('option');o.value=String(i);o.textContent=p.name;select.appendChild(o);});}
    toggle.addEventListener('click',function(){body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));toggle.textContent=body.hidden?'نمایش فیلترها':'پنهان‌کردن فیلترها';});
    actions.querySelector('.di-filter-reset').addEventListener('click',clearAll);
    actions.querySelector('.di-preset-save').addEventListener('click',function(){try{var name=presetName(actions.querySelector('.di-preset-name').value),load=loadPresets(browserStorage());if(!load.ok){status.textContent=load.error;return;}var items=load.items.filter(function(p){return p.name!==name;});items.unshift({name:name,filters:readFilters()});var saved=savePresets(browserStorage(),items);status.textContent=saved.ok?'فیلتر ذخیره شد.':saved.error;populatePresets();}catch(e){status.textContent=e.message;}});
    actions.querySelector('.di-preset-apply').addEventListener('click',function(){var select=actions.querySelector('.di-preset-select'),load=loadPresets(browserStorage()),item=load.ok&&load.items[Number(select.value)];if(select.value===''||!item)return;clearAll();Object.keys(item.filters).forEach(function(key){var t=targetFor(key),conditions=item.filters[key].conditions;conditions.forEach(function(c,i){var pairs=controlsFor(t);if(i>=pairs.length){var add=t&&t.querySelector('.add-filter');if(add)add.click();pairs=controlsFor(t);}var p=pairs[i];if(p){var input=p.querySelector('input.column-filter'),op=p.querySelector('select.filter-operator');if(input){input.value=c.value;emit(input,'input');}if(op){op.value=c.operator;emit(op,'change');}}});});refresh();});
    actions.querySelector('.di-preset-delete').addEventListener('click',function(){var select=actions.querySelector('.di-preset-select'),load=loadPresets(browserStorage()),index=Number(select.value);if(select.value===''||!load.ok||!load.items[index])return;load.items.splice(index,1);var saved=savePresets(browserStorage(),load.items);status.textContent=saved.ok?'فیلتر حذف شد.':saved.error;populatePresets();});
    new MutationObserver(function(){ refresh(); }).observe(table, {childList:true,subtree:true});
    table.addEventListener('input',refresh); table.addEventListener('change',refresh);
    toolbar.appendChild(chips); // Active chips remain usable when the editor is collapsed.
    refresh(); populatePresets();
  }
  function applyChartVisibility(svg, state) { var selectors=chartSeriesSelector(svg.id); selectors.forEach(function(selector,i){Array.prototype.forEach.call(svg.querySelectorAll(selector),function(el){el.style.display=state[i]===false?'none':'';el.setAttribute('aria-hidden',state[i]===false?'true':'false');});}); if(svg.id==='marketChart')Array.prototype.forEach.call(svg.querySelectorAll('.chart-area'),function(el){el.style.display=state[1]===false?'none':'';el.setAttribute('aria-hidden',state[1]===false?'true':'false');}); }
  function bindChartKeyboard(svg, hit) {
    if (!hit || hit._diKeyboardBound) return;
    hit._diKeyboardBound = true;
    hit.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight Home End Escape');
    if (!hit.getAttribute('aria-label')) hit.setAttribute('aria-label','نمایش مقدار با واحد و زمان');
    var wrap = svg.parentElement, tooltip = wrap && wrap.querySelector('.chart-tooltip-html');
    function describeTooltip() {
      if (!tooltip || tooltip.hidden) return;
      if (!tooltip.querySelector('.di-chart-tip-note')) {
        var note = document.createElement('span'); note.className = 'di-chart-tip-note';
        note.textContent = svg.id === 'marketChart' ? 'واحد: امتیاز؛ زمانِ نمونه در بالا' : 'واحد: تعداد نماد؛ زمانِ نمونه در بالا';
        tooltip.appendChild(note);
      }
    }
    ['pointerenter','pointermove','focus'].forEach(function(name) { hit.addEventListener(name,describeTooltip); });
    if (tooltip && !tooltip.querySelector('.di-chart-tip-note')) {
      var initialNote = document.createElement('span'); initialNote.className='di-chart-tip-note';
      initialNote.textContent = svg.id === 'marketChart' ? 'واحد: امتیاز؛ زمانِ نمونه در بالا' : 'واحد: تعداد نماد؛ زمانِ نمونه در بالا';
      tooltip.appendChild(initialNote);
    }
    tooltip && tooltip.setAttribute('aria-live','polite');
    if (tooltip) { tooltip.setAttribute('role','tooltip'); if (!tooltip.id) tooltip.id = 'di-' + svg.id + '-tooltip'; hit.setAttribute('aria-describedby',tooltip.id); }
    hit.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { if (tooltip) tooltip.hidden = true; return; }
      if (['ArrowLeft','ArrowRight','Home','End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      var labels = svg.querySelectorAll('.chart-label[text-anchor="middle"]'), count = labels.length || 2;
      var index = Number(svg.dataset.diKeyboardIndex || 0);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = count - 1;
      else index += event.key === 'ArrowRight' ? 1 : -1;
      index = Math.max(0, Math.min(count - 1, index)); svg.dataset.diKeyboardIndex = String(index);
      var rect = hit.getBoundingClientRect(), x = rect.left + index / Math.max(count - 1, 1) * rect.width;
      try { hit.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:rect.top + rect.height / 2,pointerType:'mouse'})); } catch (e) {}
    });
  }
  function initChart(svg, doc) {
    var selectors=chartSeriesSelector(svg.id), legend=svg.parentElement && svg.parentElement.parentElement ? svg.parentElement.parentElement.querySelector('.chart-legend') : null;
    if (!selectors.length || !legend || !selectors.some(function(s){return svg.querySelector(s);})) return;
    var state=svg._diLegendState || selectors.map(function(){return true;}); svg._diLegendState=state;
    if (legend.dataset.diLegend !== 'true') {
      legend.dataset.diLegend='true';
      Array.prototype.slice.call(legend.children).forEach(function(item,i){if(!selectors[i] || !svg.querySelector(selectors[i]))return;var button=doc.createElement('button');button.type='button';button.className='di-chart-legend-control';button.innerHTML=item.innerHTML;button.setAttribute('aria-pressed',String(state[i]!==false));button.setAttribute('aria-label','نمایش یا پنهان کردن '+(chartNames[svg.id]||[])[i]);item.replaceWith(button);button.addEventListener('click',function(){state[i]=state[i]===false;button.setAttribute('aria-pressed',String(state[i]));applyChartVisibility(svg,state);});});
    }
    applyChartVisibility(svg,state); bindChartKeyboard(svg,svg.querySelector('.chart-hit-area')); adaptAxes(svg);
    if (root.ResizeObserver && !svg._diResizeBound) { svg._diResizeBound=true; new root.ResizeObserver(function(){adaptAxes(svg);}).observe(svg.parentElement || svg); }
    if (root.MutationObserver && !svg._diChartObserverBound) { svg._diChartObserverBound=true; new root.MutationObserver(function(){applyChartVisibility(svg,state);bindChartKeyboard(svg,svg.querySelector('.chart-hit-area'));adaptAxes(svg);}).observe(svg,{childList:true}); }
  }
  function adaptAxes(svg) { var width=(svg.parentElement&&svg.parentElement.clientWidth)||svg.clientWidth||1000, labels=Array.prototype.slice.call(svg.querySelectorAll('.chart-label'));var xlabels=labels.filter(function(t){return t.getAttribute('text-anchor')==='middle';});var keep=width<520?narrowAxisIndices(xlabels.length):xlabels.map(function(_,i){return i;});xlabels.forEach(function(t,i){t.classList.toggle('di-axis-hidden',keep.indexOf(i)<0);});svg.dataset.diNarrow=width<520?'true':'false'; }
  function initSignals(doc) {
    var table=doc.querySelector('.signals-table'), feed=doc.querySelector('#feed'); if(!table||!feed||table.dataset.diSignals==='true')return; table.dataset.diSignals='true';
    var wrap=table.parentElement, bar=doc.createElement('div');bar.className='di-signal-view-toggle';bar.setAttribute('role','group');bar.setAttribute('aria-label','نحوه نمایش سیگنال‌ها');bar.innerHTML='<button type="button" class="di-signal-view" data-view="table" aria-pressed="true">جدول</button><button type="button" class="di-signal-view" data-view="cards" aria-pressed="false">کارت‌ها</button>';wrap.parentNode.insertBefore(bar,wrap);
    var cards=doc.createElement('div');cards.className='di-signal-cards';cards.hidden=true;wrap.parentNode.insertBefore(cards,wrap.nextSibling);
    function renderCards(){cards.innerHTML='';Array.prototype.forEach.call(feed.querySelectorAll('tr'),function(row){var cells=Array.prototype.map.call(row.cells,function(c){return c.textContent.trim();});if(!cells.length)return;if(row.classList.contains('empty-state')||cells.length<4){var empty=doc.createElement('p');empty.className='empty-state';empty.textContent=cells[0]||'داده‌ای برای نمایش موجود نیست.';cards.appendChild(empty);return;}var model=signalCardModel(cells);var article=doc.createElement('article');article.className='di-signal-card';article.innerHTML='<h3>'+esc(model.type)+'</h3><dl><dt>نماد</dt><dd>'+esc(model.symbol)+'</dd><dt>زمان</dt><dd dir="ltr">'+esc(model.time)+'</dd><dt>توضیحات</dt><dd>'+esc(model.explanation)+'</dd></dl>';cards.appendChild(article);});}
    function setView(view){bar.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.view===view));});table.hidden=view!=='table';cards.hidden=view!=='cards';renderCards();}
    bar.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){setView(b.dataset.view);});});
    new MutationObserver(renderCards).observe(feed,{childList:true,subtree:true}); renderCards();
  }
  function initTableA11y(doc){doc.querySelectorAll('table').forEach(function(table){var row=table.tHead&&table.tHead.rows[0];if(!row)return;Array.prototype.forEach.call(row.cells,function(header){if(!isSortableHeader(header))return;header.tabIndex=header.tabIndex>=0?header.tabIndex:0;if(!header.hasAttribute('role'))header.setAttribute('role','columnheader');if(!header.hasAttribute('aria-sort'))header.setAttribute('aria-sort','none');if(!header.title)header.title='برای مرتب‌سازی Enter یا Space را بزنید';});});}
  function init(doc){doc=doc||document;if(doc.documentElement.dataset.diInteractions!=='true')doc.documentElement.dataset.diInteractions='true';initFilters(doc);initSignals(doc);initTableA11y(doc);Object.keys(CHARTS).forEach(function(id){var svg=doc.getElementById(id);if(svg)initChart(svg,doc);});if(!doc.documentElement.dataset.diObserverBound&&root.MutationObserver&&doc.body){doc.documentElement.dataset.diObserverBound='true';new root.MutationObserver(function(){initFilters(doc);initSignals(doc);initTableA11y(doc);Object.keys(CHARTS).forEach(function(id){var svg=doc.getElementById(id);if(svg)initChart(svg,doc);});}).observe(doc.body,{childList:true,subtree:true});}}
  var api={validateFilters:validateFilters,presetName:presetName,loadPresets:loadPresets,savePresets:savePresets,chartSeriesSelector:chartSeriesSelector,isSortableHeader:isSortableHeader,narrowAxisIndices:narrowAxisIndices,signalCardModel:signalCardModel,init:init};
  if (typeof module === 'object' && module.exports) { module.exports=api; return; }
  if (root.SorenaDataInteractions) return;
  root.SorenaDataInteractions=api;
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){init(document);}); else init(document);
})(typeof window !== 'undefined' ? window : this);

// Idempotent browser injection can call init again through the exported global.
