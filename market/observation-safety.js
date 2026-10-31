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
  const api = {observation, state, range, todayEvents, portfolioSafe, rangeState};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObservationSafety = api;
})(typeof window === 'object' ? window : null);
