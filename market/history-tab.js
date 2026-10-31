/* Same-shell history view; chart document remains the single UI implementation. */
(() => {
  'use strict';
  const overview = document.querySelector('main#overview');
  if (!overview) return;
  const panel = document.createElement('main');
  panel.id = 'history-tab-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'تاریخچه میانه بازار و لیدرها');
  const frame = document.createElement('iframe');
  frame.id = 'median-history-frame';
  frame.title = 'کندل و خط ۱۰ دقیقه‌ای میانه بازار و لیدرها';
  frame.setAttribute('scrolling', 'no');
  panel.append(frame);
  overview.after(panel);
  let observer;
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    // Hide only the standalone back link, not chart controls or data provenance.
    const back = doc.querySelector('#median-history > header > a');
    if (back) back.hidden = true;
    const size = () => { frame.style.height = `${Math.ceil(doc.body.scrollHeight + 32)}px`; };
    if (observer) observer.disconnect();
    observer = new ResizeObserver(size);
    observer.observe(doc.body);
    size();
  });
  function render() {
    const active = location.hash === '#history';
    overview.hidden = active;
    panel.hidden = !active;
    document.body.classList.toggle('history-tab-active', active);
    document.querySelectorAll('.main-nav a').forEach(link => {
      const selected = active ? link.dataset.historyTab === 'true' : link.getAttribute('href') === (location.hash || '#overview');
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (active && !frame.hasAttribute('src')) frame.src = 'median-history/?embedded=1';
  }
  window.addEventListener('hashchange', render);
  render();
})();
