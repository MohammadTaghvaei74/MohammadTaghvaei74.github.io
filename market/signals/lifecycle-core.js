(function (root) {
  'use strict';

  const STALE_AFTER_SECONDS = 5 * 60;
  const BREAKEVEN_MIN = -0.5;
  const BREAKEVEN_MAX = 0.5;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
    return number;
  }

  function roundToTick(value, tickSize) {
    const tick = finite(tickSize, 'tickSize');
    if (tick <= 0) throw new RangeError('tickSize must be positive');
    return Math.round((finite(value, 'price') / tick) + Number.EPSILON) * tick;
  }

  function createBuyCase({ id, symbol, issuedAt, zeroPrice, tickSize, currentPrice }) {
    if (!id || !symbol || !issuedAt || !Number.isFinite(Date.parse(issuedAt))) {
      throw new TypeError('id, symbol, and a valid issuedAt are required');
    }
    const zero = finite(zeroPrice, 'zeroPrice');
    const plusPrice = roundToTick(zero * 1.01, tickSize);
    const minusPrice = roundToTick(zero * 0.98, tickSize);
    const base = {
      id: String(id),
      symbol: String(symbol),
      issuedAt,
      zeroPrice: zero,
      tickSize: finite(tickSize, 'tickSize'),
      status: 'pending',
      lastPrice: Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : zero,
      orders: [
        { id: `${id}:plus_1`, motherId: String(id), level: 'plus_1', orderPrice: plusPrice, status: 'pending' },
        { id: `${id}:minus_2`, motherId: String(id), level: 'minus_2', orderPrice: minusPrice, status: 'pending' },
      ],
      exit: null,
    };

    // The approved asymmetric rule: below -2% is an immediate current-price entry
    // and the +1% order is removed from this mother signal.
    if (Number.isFinite(Number(currentPrice)) && Number(currentPrice) < minusPrice) {
      base.orders[0].status = 'cancelled';
      base.orders[0].cancelReason = 'lower_immediate_entry';
      enter(base.orders[1], Number(currentPrice), issuedAt, 'immediate_current_price');
      base.status = 'open';
    }
    return base;
  }

  function enter(order, price, timestamp, entryMode) {
    order.status = 'entered';
    order.entryPrice = finite(price, 'entryPrice');
    order.entryAt = timestamp;
    order.entryMode = entryMode;
    return order;
  }

  function crossed(previous, current, level) {
    return (previous <= level && current >= level) || (previous >= level && current <= level);
  }

  function refreshCaseStatus(state) {
    const entered = state.orders.some(order => order.status === 'entered');
    const pending = state.orders.some(order => order.status === 'pending');
    if (state.exit && state.exit.status === 'closed') state.status = 'closed';
    else if (entered) state.status = 'open';
    else if (pending) state.status = 'pending';
    else state.status = 'expired';
    return state;
  }

  function applyQuote(caseState, { timestamp, price }) {
    const state = clone(caseState);
    const current = finite(price, 'price');
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new TypeError('valid timestamp is required');
    if (Date.parse(timestamp) <= Date.parse(state.issuedAt)) return state;

    const previous = Number.isFinite(Number(state.lastPrice)) ? Number(state.lastPrice) : current;
    for (const order of state.orders) {
      if (order.status !== 'pending') continue;
      if (crossed(previous, current, order.orderPrice)) enter(order, order.orderPrice, timestamp, 'order_touch');
    }
    state.lastPrice = current;
    return refreshCaseStatus(state);
  }

  function expirePending(caseState, timestamp) {
    const state = clone(caseState);
    for (const order of state.orders) {
      if (order.status === 'pending') {
        order.status = 'expired';
        order.expiredAt = timestamp || null;
      }
    }
    return refreshCaseStatus(state);
  }

  function closeByExit(caseState, { timestamp, price, priceAgeSeconds, sessionClosePrice }) {
    const state = clone(caseState);
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new TypeError('valid exit timestamp is required');
    const hasOpen = state.orders.some(order => order.status === 'entered');
    if (!hasOpen) return state;

    const age = finite(priceAgeSeconds, 'priceAgeSeconds');
    const fresh = age <= STALE_AFTER_SECONDS;
    let exitPrice = null;
    let priceSource = null;
    if (fresh) {
      exitPrice = finite(price, 'price');
      priceSource = 'exit_quote';
    }

    if (exitPrice === null) {
      state.exit = { status: 'waiting_for_fresh_price', signalAt: timestamp, observedPrice: price, priceAgeSeconds: age };
      return state;
    }

    state.exit = { status: 'closed', signalAt: timestamp, price: exitPrice, priceSource };
    for (const order of state.orders) {
      if (order.status === 'entered') {
        order.status = 'closed';
        order.exitAt = timestamp;
        order.exitPrice = exitPrice;
      }
    }
    return refreshCaseStatus(state);
  }

  function netReturnPct(entryPrice, exitPrice, buyFeeRate, sellFeeRate) {
    const entry = finite(entryPrice, 'entryPrice');
    const exit = finite(exitPrice, 'exitPrice');
    const buyFee = finite(buyFeeRate, 'buyFeeRate');
    const sellFee = finite(sellFeeRate, 'sellFeeRate');
    if (entry <= 0 || buyFee < 0 || sellFee < 0 || buyFee >= 1 || sellFee >= 1) {
      throw new RangeError('invalid PnL inputs');
    }
    return (((exit * (1 - sellFee)) - (entry * (1 + buyFee))) / entry) * 100;
  }

  function applyRealized(index, netPnlPct) {
    return finite(index, 'index') + finite(netPnlPct, 'netPnlPct');
  }

  function summarize(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const closedRows = list.filter(row => row && row.status === 'closed' && Number.isFinite(Number(row.netPnlPct)));
    const wins = closedRows.filter(row => Number(row.netPnlPct) > BREAKEVEN_MAX).length;
    const breakeven = closedRows.filter(row => Number(row.netPnlPct) >= BREAKEVEN_MIN && Number(row.netPnlPct) <= BREAKEVEN_MAX).length;
    const losses = closedRows.filter(row => Number(row.netPnlPct) < BREAKEVEN_MIN).length;
    const realized = closedRows.reduce((sum, row) => sum + Number(row.netPnlPct), 0);
    return {
      closed: closedRows.length,
      open: list.filter(row => row && row.status === 'open').length,
      wins,
      breakeven,
      losses,
      winRate: closedRows.length ? (wins / closedRows.length) * 100 : null,
      realizedIndex: 100 + realized,
    };
  }

  function validateLifecyclePayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('invalid lifecycle payload');
    if (data.schema_version !== 1 || !['ok', 'unavailable'].includes(data.status)) throw new Error('invalid lifecycle metadata');
    for (const key of ['mother_signals', 'open_positions', 'closed_trades']) {
      if (!Array.isArray(data[key])) throw new Error(`${key} must be an array`);
    }
    const ids = new Set();
    for (const row of [...data.mother_signals, ...data.open_positions, ...data.closed_trades]) {
      if (!row || typeof row !== 'object' || !row.id || ids.has(row.id)) throw new Error('invalid or duplicate lifecycle id');
      ids.add(row.id);
    }
    return data;
  }

  function performanceMetrics(rows) {
    const closedRows = (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.status === 'closed' && Number.isFinite(Number(row.netPnlPct)));
    const pnl = closedRows.map(row => Number(row.netPnlPct));
    const grossProfit = pnl.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const grossLoss = pnl.filter(value => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
    let realizedIndex = 100;
    let peak = 100;
    let maxDrawdown = 0;
    let currentLossStreak = 0;
    let maxLossStreak = 0;
    for (const value of pnl) {
      realizedIndex += value;
      peak = Math.max(peak, realizedIndex);
      maxDrawdown = Math.max(maxDrawdown, peak - realizedIndex);
      if (value < 0) {
        currentLossStreak += 1;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      } else {
        currentLossStreak = 0;
      }
    }
    return {
      closed: pnl.length,
      gross_profit_pct: grossProfit,
      gross_loss_pct: grossLoss,
      profit_factor: grossLoss ? grossProfit / grossLoss : null,
      realized_index: realizedIndex,
      max_drawdown_points: maxDrawdown,
      max_consecutive_losses: maxLossStreak,
    };
  }

  function publicPerformance(data) {
    const closed = Array.isArray(data && data.closed_trades) ? data.closed_trades : [];
    const open = Array.isArray(data && data.open_positions) ? data.open_positions : [];
    const aggregateAvailable = closed.length >= 30;
    const normalized = closed.map(row => ({
      status: 'closed',
      netPnlPct: row.net_pnl_pct,
    }));
    const computed = summarize(normalized);
    const extended = performanceMetrics(normalized);
    return {
      aggregate_available: aggregateAvailable,
      closed_count: closed.length,
      open_count: open.length,
      ...(aggregateAvailable ? {
        wins: computed.wins,
        breakeven: computed.breakeven,
        losses: computed.losses,
        win_rate: computed.winRate,
        realized_index: computed.realizedIndex,
        gross_profit_pct: extended.gross_profit_pct,
        gross_loss_pct: extended.gross_loss_pct,
        profit_factor: extended.profit_factor,
        max_drawdown_points: extended.max_drawdown_points,
        max_consecutive_losses: extended.max_consecutive_losses,
      } : {}),
    };
  }

  const api = {
    STALE_AFTER_SECONDS,
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
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SignalLifecycleCore = api;
})(globalThis);
