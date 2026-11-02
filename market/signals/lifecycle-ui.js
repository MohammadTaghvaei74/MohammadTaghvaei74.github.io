(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const faDigits = (value) => String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  const fmtNumber = (value, digits = 2) => Number.isFinite(Number(value))
    ? faDigits(Number(value).toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: digits }))
    : '—';
  const fmtPct = (value) => Number.isFinite(Number(value)) ? `${value > 0 ? '+' : ''}${fmtNumber(value)}٪` : '—';
  const fmtDate = (value) => {
    if (!value || Number.isNaN(Date.parse(value))) return '—';
    return faDigits(new Date(value).toLocaleString('fa-IR', {
      timeZone: 'Asia/Tehran', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  };

  function empty(target, message) {
    const node = $(target);
    if (!node) return;
    node.textContent = '';
    const p = document.createElement('p');
    p.className = 'lifecycle-empty';
    p.textContent = message;
    node.appendChild(p);
  }

  function table(target, columns, rows, emptyMessage) {
    const node = $(target);
    if (!node) return;
    node.textContent = '';
    if (!rows.length) return empty(target, emptyMessage);
    const tableNode = document.createElement('table');
    tableNode.className = 'lifecycle-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach((column) => { const th = document.createElement('th'); th.textContent = column.label; headRow.appendChild(th); });
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      columns.forEach((column) => { const td = document.createElement('td'); td.textContent = column.value(row); tr.appendChild(td); });
      body.appendChild(tr);
    });
    tableNode.append(head, body);
    node.appendChild(tableNode);
  }

  function render(data) {
    const publicStats = window.SignalLifecycleCore.publicPerformance(data);
    $('#lifecycleState').textContent = data.status === 'ok' ? 'داده چرخه فعال است' : 'داده چرخه هنوز در دسترس نیست';
    $('#openCount').textContent = faDigits(publicStats.open_count);
    $('#closedCount').textContent = faDigits(publicStats.closed_count);
    $('#realizedIndex').textContent = publicStats.aggregate_available ? fmtNumber(publicStats.realized_index) : '—';

    table('#openPositions', [
      { label: 'نماد', value: (row) => row.symbol || '—' },
      { label: 'قیمت ورود', value: (row) => fmtNumber(row.entry_price) },
      { label: 'زمان ورود', value: (row) => fmtDate(row.entry_at) },
      { label: 'مدت', value: (row) => Number.isFinite(Number(row.holding_days)) ? `${faDigits(row.holding_days)} روز` : '—' },
      { label: 'وضعیت', value: () => 'باز' },
    ], data.open_positions, 'در حال حاضر موقعیت باز عمومی ثبت نشده است.');

    table('#closedTrades', [
      { label: 'نماد', value: (row) => row.symbol || '—' },
      { label: 'ورود', value: (row) => fmtNumber(row.entry_price) },
      { label: 'خروج', value: (row) => fmtNumber(row.exit_price) },
      { label: 'زمان خروج', value: (row) => fmtDate(row.exit_at) },
      { label: 'مدت', value: (row) => Number.isFinite(Number(row.holding_days)) ? `${faDigits(row.holding_days)} روز` : '—' },
      { label: 'PnL خالص', value: (row) => fmtPct(row.net_pnl_pct) },
    ], data.closed_trades, 'هنوز پرونده بسته‌شده‌ای برای نمایش ثبت نشده است.');

    const performanceState = $('#performanceState');
    if (!publicStats.aggregate_available) {
      performanceState.textContent = `آمار کامل پس از ثبت ۳۰ پرونده بسته معتبر نمایش داده می‌شود؛ فعلاً ${faDigits(publicStats.closed_count)} پرونده ثبت شده است.`;
      $('#performanceDetails').textContent = '—';
    } else {
      performanceState.textContent = 'آمار تحقق‌یافته بر اساس پرونده‌های بسته معتبر.';
      $('#performanceDetails').textContent = `برد: ${faDigits(publicStats.wins)} · سربه‌سر: ${faDigits(publicStats.breakeven)} · باخت: ${faDigits(publicStats.losses)} · Win Rate: ${fmtPct(publicStats.win_rate)} · PF: ${fmtNumber(publicStats.profit_factor)} · افت تحقق‌یافته: ${fmtNumber(publicStats.max_drawdown_points)}٪`;
    }
  }

  async function load() {
    try {
      const response = await fetch(`../data/signal-lifecycle.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(window.SignalLifecycleCore.validateLifecyclePayload(await response.json()));
    } catch (error) {
      render({ schema_version: 1, status: 'unavailable', mother_signals: [], open_positions: [], closed_trades: [] });
      console.error(error);
    }
  }

  load();
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
})();
