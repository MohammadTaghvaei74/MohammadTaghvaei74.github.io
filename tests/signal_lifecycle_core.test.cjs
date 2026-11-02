const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createBuyCase,
  applyQuote,
  expirePending,
  closeByExit,
  netReturnPct,
  applyRealized,
  summarize,
  validateLifecyclePayload,
  publicPerformance,
  performanceMetrics,
} = require('../market/signals/lifecycle-core.js');

const issuedAt = '2026-11-02T09:30:00+03:30';

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} !== ${expected}`);
}

test('creates two rounded independent orders under one mother signal', () => {
  const c = createBuyCase({
    id: 'mother-1', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
  });
  assert.equal(c.orders.length, 2);
  assert.deepEqual(c.orders.map(o => o.level), ['plus_1', 'minus_2']);
  assert.deepEqual(c.orders.map(o => o.orderPrice), [1010, 980]);
  assert.ok(c.orders.every(o => o.motherId === 'mother-1'));
});

test('lower immediate entry cancels plus-one order', () => {
  const c = createBuyCase({
    id: 'mother-2', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
    currentPrice: 970,
  });
  const lower = c.orders.find(o => o.level === 'minus_2');
  const upper = c.orders.find(o => o.level === 'plus_1');
  assert.equal(lower.status, 'entered');
  assert.equal(lower.entryPrice, 970);
  assert.equal(lower.entryMode, 'immediate_current_price');
  assert.equal(upper.status, 'cancelled');
});

test('touch after issue enters at the order price, not the jumped quote', () => {
  const c = createBuyCase({
    id: 'mother-3', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
    currentPrice: 1025,
  });
  const next = applyQuote(c, {
    timestamp: '2026-11-02T09:31:00+03:30', price: 1005,
  });
  const upper = next.orders.find(o => o.level === 'plus_1');
  assert.equal(upper.status, 'entered');
  assert.equal(upper.entryPrice, 1010);
  assert.equal(upper.entryMode, 'order_touch');
});

test('quotes at or before issue do not create a causal entry', () => {
  const c = createBuyCase({
    id: 'mother-4', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
  });
  const next = applyQuote(c, {
    timestamp: issuedAt, price: 970,
  });
  assert.ok(next.orders.every(o => o.status === 'pending'));
});

test('stale exit waits for a fresh quote, then closes all open orders at that quote', () => {
  const c = createBuyCase({
    id: 'mother-5', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
  });
  const entered = applyQuote(c, {
    timestamp: '2026-11-02T09:31:00+03:30', price: 1020,
  });
  const waiting = closeByExit(entered, {
    timestamp: '2026-11-02T10:00:00+03:30', price: 1100,
    priceAgeSeconds: 301,
  });
  assert.equal(waiting.orders.find(o => o.status === 'entered').status, 'entered');
  assert.equal(waiting.exit.status, 'waiting_for_fresh_price');
  const closed = closeByExit(waiting, {
    timestamp: '2026-11-02T10:01:00+03:30', price: 1110,
    priceAgeSeconds: 0,
  });
  assert.equal(closed.exit.status, 'closed');
  assert.equal(closed.exit.price, 1110);
  assert.equal(closed.orders.find(o => o.level === 'plus_1').status, 'closed');
});

test('stale exit waits for a fresh price even when a session close is available', () => {
  const c = createBuyCase({
    id: 'mother-6', symbol: 'TEST', issuedAt, zeroPrice: 1000, tickSize: 10,
  });
  const entered = applyQuote(c, {
    timestamp: '2026-11-02T09:31:00+03:30', price: 1010,
  });
  const waiting = closeByExit(entered, {
    timestamp: '2026-11-02T12:29:00+03:30', price: 1100,
    priceAgeSeconds: 301, sessionClosePrice: 1080,
  });
  assert.equal(waiting.exit.status, 'waiting_for_fresh_price');
  assert.equal(waiting.orders.find(o => o.status === 'entered').status, 'entered');
});

test('net return uses value-based fees and realized index is additive', () => {
  approx(netReturnPct(100, 110, 0.0037, 0.0088),
    (((110 * (1 - 0.0088)) - (100 * (1 + 0.0037))) / 100) * 100);
  assert.equal(applyRealized(100, 2.5), 102.5);
  assert.equal(applyRealized(102.5, -1.25), 101.25);
});

test('summary excludes expired and open orders from closed performance', () => {
  const rows = [
    { status: 'closed', netPnlPct: 2 },
    { status: 'closed', netPnlPct: -1 },
    { status: 'open' },
    { status: 'expired' },
  ];
  assert.deepEqual(summarize(rows), {
    closed: 2, open: 1, wins: 1, breakeven: 0, losses: 1,
    winRate: 50, realizedIndex: 101,
  });
});

test('validates lifecycle payload shape and hides aggregate stats before 30 closed cases', () => {
  const payload = {
    schema_version: 1,
    status: 'ok',
    generated_at: '2026-11-02T10:00:00+03:30',
    mother_signals: [],
    open_positions: [{ id: 'p1', symbol: 'TEST', entry_price: 100 }],
    closed_trades: Array.from({ length: 2 }, (_, i) => ({ id: `t${i}`, symbol: 'TEST', net_pnl_pct: 1 })),
  };
  assert.equal(validateLifecyclePayload(payload).open_positions.length, 1);
  assert.equal(publicPerformance(payload).aggregate_available, false);
  assert.equal(publicPerformance(payload).closed_count, 2);
  assert.throws(() => validateLifecyclePayload({ ...payload, open_positions: 'bad' }));
});

test('publishes extended performance metrics only after the minimum sample', () => {
  const payload = {
    schema_version: 1,
    status: 'ok',
    mother_signals: [],
    open_positions: [],
    closed_trades: Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`, symbol: 'TEST', net_pnl_pct: i === 0 ? 2 : (i === 1 ? -1 : 0),
    })),
  };
  const performance = publicPerformance(payload);
  assert.equal(performance.aggregate_available, true);
  assert.equal(performance.profit_factor, 2);
  assert.equal(performance.max_drawdown_points, 1);
  assert.equal(performance.max_consecutive_losses, 1);
});

test('computes realized profit factor and drawdown without marking open cases', () => {
  const metrics = performanceMetrics([
    { status: 'closed', netPnlPct: 2 },
    { status: 'closed', netPnlPct: -1 },
    { status: 'closed', netPnlPct: -3 },
    { status: 'closed', netPnlPct: 4 },
    { status: 'open', netPnlPct: 99 },
  ]);
  assert.equal(metrics.closed, 4);
  assert.equal(metrics.gross_profit_pct, 6);
  assert.equal(metrics.gross_loss_pct, 4);
  assert.equal(metrics.profit_factor, 1.5);
  assert.equal(metrics.realized_index, 102);
  assert.equal(metrics.max_drawdown_points, 4);
  assert.equal(metrics.max_consecutive_losses, 2);
});
