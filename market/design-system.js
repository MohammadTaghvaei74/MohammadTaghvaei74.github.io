/* Shared shell presentation only. Market loaders/calculations stay page-owned. */
(() => {
  'use strict';
  document.documentElement.dataset.designSystem = 'sorena-v1';
  document.documentElement.dataset.embedded = String(new URLSearchParams(location.search).get('embedded') === '1');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const nav = document.querySelector('.main-nav');
  if (!nav) return;
  const updateNavigation = () => {
    const history = location.hash === '#history' || /\/(median-history|history)$/.test(path);
    nav.querySelectorAll('a').forEach(link => {
      const target = new URL(link.href);
      const targetPath = target.pathname.replace(/\/+$/, '') || '/';
      const isHistory = link.dataset.historyTab === 'true' || target.hash === '#history';
      const active = history ? isHistory : !isHistory && targetPath === path;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      if (!link.getAttribute('aria-label')) link.setAttribute('aria-label', link.textContent.trim());
    });
    // Keep the current destination in view inside the nav, never scroll the page.
    const active = nav.querySelector('[aria-current="page"]');
    if (active && nav.scrollWidth > nav.clientWidth) {
      const a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (a.left < n.left) nav.scrollLeft += a.left - n.left - 8;
      else if (a.right > n.right) nav.scrollLeft += a.right - n.right + 8;
    }
  };
  updateNavigation();
  window.addEventListener('hashchange', updateNavigation);
  // Keep shared presentation after the existing same-shell history renderer.
  window.addEventListener('load', updateNavigation, {once:true});
  document.querySelectorAll('.table-scroll').forEach(wrapper => {
    if (!wrapper.hasAttribute('tabindex')) wrapper.tabIndex = 0;
    if (!wrapper.hasAttribute('role')) wrapper.setAttribute('role', 'region');
    if (!wrapper.hasAttribute('aria-label')) wrapper.setAttribute('aria-label', 'جدول داده؛ برای مشاهده ستون‌های بیشتر پیمایش کنید');
  });
})();
