/* Integrates the standalone theme preference module into the shared header. */
(() => {
  'use strict';
  const mount = () => {
    const api = window.SorenaThemePreference;
    const host = document.querySelector('.topbar-actions');
    if (!api || !host || host.querySelector('.ds-appearance')) return;
    const details = document.createElement('details');
    details.className = 'ds-appearance';
    const summary = document.createElement('summary');
    summary.textContent = 'پوسته';
    summary.setAttribute('aria-label', 'انتخاب پوسته');
    const target = document.createElement('div');
    target.className = 'ds-appearance-menu';
    details.append(summary, target);
    host.prepend(details);
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.ds-appearance')) details.removeAttribute('open');
    });
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape') { details.removeAttribute('open'); summary.focus(); }
    });
    api.mountThemePreference(target, {
      document,
      legend: 'پوسته',
      lightLabel: 'روشن',
      darkLabel: 'تیره',
      systemLabel: 'سیستم',
      onChange() { details.removeAttribute('open'); summary.focus(); },
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once: true});
  else mount();
})();
