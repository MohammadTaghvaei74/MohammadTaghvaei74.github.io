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
  function portfolioSafe(holdings, now=Date.now()) { return (holdings||[]).filter(h=>h.value>0).every(h=>state(observation(h.row)||h.row?.historyTimestamp,now)==='fresh'); }
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
  const api = {observation, state, range, todayEvents, portfolioSafe, rangeState, comprehensiveSafe};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObservationSafety = api;
})(typeof window === 'object' ? window : null);
