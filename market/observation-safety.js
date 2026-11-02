/* Source observation clocks: publication/reload times are never observations. */
(function (root) {
  'use strict';
  function observation(row) { return row && (row.observed_at || row.source_at || row.timestamp) || null; }
  function day(value) { return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)); }
  function state(value, now = Date.now()) {
    const time = Date.parse(value || '');
    if (!Number.isFinite(time) || !/T.*(Z|[+-]\d\d:\d\d)$/.test(String(value))) return 'unknown';
    if (time > now + 5000) return 'unknown';
    if (day(time) !== day(now) || now - time > 120000) return 'stale';
    return 'fresh';
  }
  function range(rows, field = observation) {
    const values = (rows || []).map(field), known = values.filter(v => v && Number.isFinite(Date.parse(v))).sort((a,b) => Date.parse(a)-Date.parse(b));
    return {first:known[0] || null, last:known[known.length-1] || null, unknown:!values.length || known.length !== values.length};
  }
  function todayEvents(items, now=Date.now()) { return (items||[]).filter(r=>Number.isFinite(Date.parse(r.timestamp)) && Date.parse(r.timestamp)<=now && day(r.timestamp)===day(now)); }
  function portfolioSafe(holdings, now=Date.now()) { return (holdings||[]).filter(h=>h.value>0).every(h=>state(observation(h.row)||(h.row && h.row.historyTimestamp),now)==='fresh'); }
  function rangeState(r, now=Date.now()) { return r.unknown || state(r.last,now)==='unknown' ? 'unknown' : state(r.first,now); }
  // Historical windows are not live ticks: require source-validated session coverage,
  // never substitute quote/fetch/publication times for their provenance.
  function historySafe(p, now) {
    const today = day(now), start = new Date(today + 'T00:00:00Z');
    start.setUTCDate(start.getUTCDate() - 30);
    const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
    if (!p || p.validated !== true || p.as_of !== today || p.window_end_exclusive !== today || p.window_start !== start.toISOString().slice(0,10)) return false;
    const expected = p.expected_sessions, observed = p.observed_sessions;
    if (!Array.isArray(expected) || !Array.isArray(observed) || !expected.length || expected.length !== observed.length) return false;
    return new Set(expected).size === expected.length && new Set(observed).size === observed.length && expected.every(d => validDay(d) && d >= p.window_start && d < today && observed.includes(d));
  }
  function comprehensiveSafe(rows, keys, now=Date.now()) {
    if (!Array.isArray(keys) || !keys.length || !Array.isArray(rows) || !rows.length || rangeState(range(rows),now) !== 'fresh') return false;
    return rows.every(row => keys.every(key => {
      if (key === 'score_position_pct') return Number.isFinite(row.score_rank) && row.score_rank_total > 0;
      if (key === 'industry_score_position_pct') return Number.isFinite(row.industry_score_rank) && row.industry_score_rank_total > 0;
      if (!Number.isFinite(row[key])) return false;
      if (key === 'legal_buy_pct' || key === 'legal_sell_pct') return row.client_type_status === 'ok' && row.client_type_date === day(now) && state(row.client_type_observed_at,now) === 'fresh';
      if (key === 'avg_trade_value_toman') return historySafe(row.avg_trade_value_provenance,now);
      return true;
    }));
  }
  // Display last known same-day observations, not expired recommendations.
  function tableVisible(r, recommendation=false, now=Date.now()) {
    if (!r || r.unknown || state(r.first,now)==='unknown' || state(r.last,now)==='unknown') return false;
    if (day(r.first) !== day(now) || day(r.last) !== day(now)) return false;
    return !recommendation || rangeState(r, now) === 'fresh';
  }
  // Display freshness is separate from the stricter recommendation/analysis gates above.
  // Tehran exchange week: Saturday–Wednesday. Callers may supply declared closures/openings.
  const sessionCalendar = {from:'2025-01-01', through:'2027-12-31', holidays:["2025-01-14", "2025-01-28", "2025-02-10", "2025-02-14", "2025-03-19", "2025-03-20", "2025-03-21", "2025-03-22", "2025-03-23", "2025-03-24", "2025-03-31", "2025-04-01", "2025-04-02", "2025-04-24", "2025-06-04", "2025-06-05", "2025-06-06", "2025-06-14", "2025-07-05", "2025-07-06", "2025-08-14", "2025-08-22", "2025-08-24", "2025-09-01", "2025-09-10", "2025-11-24", "2026-01-03", "2026-01-17", "2026-02-04", "2026-02-11", "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-11", "2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23", "2026-03-24", "2026-04-01", "2026-04-02", "2026-04-14", "2026-05-27", "2026-06-04", "2026-06-05", "2026-06-24", "2026-06-25", "2026-08-04", "2026-08-12", "2026-08-13", "2026-08-21", "2026-08-30", "2026-11-13", "2026-12-23", "2027-01-06", "2027-01-24", "2027-02-11", "2027-03-01", "2027-03-10", "2027-03-11", "2027-03-20", "2027-03-21", "2027-03-22", "2027-03-23", "2027-03-24", "2027-04-01", "2027-04-02", "2027-04-03", "2027-05-17", "2027-05-25", "2027-06-04", "2027-06-05", "2027-06-15", "2027-06-16", "2027-07-25", "2027-08-02", "2027-08-03", "2027-08-11", "2027-08-20", "2027-11-03", "2027-12-12", "2027-12-26"], source:'python-holidays 0.107 / Iran public holidays; exceptional exchange closures require calendar override'};
  function session(now, options={}) {
    const calendar=options.calendar||sessionCalendar, today=day(now);
    if(today<calendar.from || today>calendar.through)return null;
    const open=options.open||'09:00', close=options.close||'12:30';
    const isOpen=d=>(calendar.openDays||[]).includes(d)||(![4,5].includes(new Date(d+'T12:00:00Z').getUTCDay()) && !(calendar.holidays||[]).includes(d));
    const time=(d,t)=>Date.parse(d+'T'+t+':00+03:30');
    if(isOpen(today)&&now>=time(today,open)&&now<time(today,close)&&!options.daily)return {live:true,expected:now,day:today};
    let date=today;
    if(!isOpen(date)||now<time(date,close)) {
      const d=new Date(date+'T12:00:00Z');
      do {d.setUTCDate(d.getUTCDate()-1);date=d.toISOString().slice(0,10);} while(!isOpen(date)&&date>=calendar.from);
    }
    return date<calendar.from?null:{live:false,expected:time(date,close),day:date};
  }
  function freshness(r, options={}) {
    const now=options.now !== null && options.now !== undefined ? options.now : Date.now(), expected=session(now,options);
    if(options.archive)return {status:'archive',timestamp:r && r.last || null,expected};
    const stamp=options.series ? (r && r.last) : (r && r.first), parsed=Date.parse(stamp||'');
    if(!r||r.unknown||!Number.isFinite(parsed)||!/T.*(Z|[+-]\d\d:\d\d)$/.test(String(stamp))||parsed>now+5000||Date.parse(r.last)>now+5000||!expected)return {status:'unknown',timestamp:stamp||null,expected};
    return {status:(expected.live ? now-parsed<=60000 : parsed>=expected.expected-60000)?'fresh':'stale',timestamp:stamp,expected};
  }
  function dailyRange(rows) {
    const valid=(rows||[]).map(r=>{
      const match=String(r.source||'').match(/^(?:persisted 12:30 MarketWatch final snapshot; |post-close MarketWatch ordinary shares; overview date verified; )(\d{4}-\d{2}-\d{2}T[^; ]+)/);
      const stamp=match ? match[1] : null, time=Date.parse(stamp||'');
      return r.complete===true && typeof r.final_turnover_toman==='number' && Number.isFinite(r.final_turnover_toman) && r.final_turnover_toman>=0 && Number.isFinite(time) && day(time)===r.trading_date && time>=Date.parse(r.trading_date+'T12:30:00+03:30')?{timestamp:stamp}:null;
    }).filter(Boolean);
    return range(valid);
  }
  // Keep acceptance explicit at the boundary. Renderers may call this after a
  // schema-validated payload is loaded; provenance is read from the payload and
  // no publication/fetch timestamp is promoted to an observation.
  function accept(payload) { return !!payload && typeof payload === 'object' && !Array.isArray(payload); }
  const api = {accept, observation, state, range, todayEvents, portfolioSafe, rangeState, comprehensiveSafe, tableVisible, freshness, session, sessionCalendar, dailyRange};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObservationSafety = api;
})(typeof window === 'object' ? window : null);
