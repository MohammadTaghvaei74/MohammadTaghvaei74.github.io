/* Sorena Watch theme preference module.
 * Intentionally standalone: the parent page owns loading this file and the CSS.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SorenaThemePreference = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THEME_PREFERENCE_KEY = 'sorena-theme';
  const THEMES = Object.freeze(['light', 'dark', 'system']);

  function normalizeTheme(value) {
    return THEMES.includes(value) ? value : 'system';
  }

  function getStorage(explicitStorage) {
    if (explicitStorage) return explicitStorage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function getStoredTheme(storage) {
    const safeStorage = getStorage(storage);
    if (!safeStorage) return 'dark';
    try {
      const value = safeStorage.getItem(THEME_PREFERENCE_KEY);
      return THEMES.includes(value) ? value : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function getMediaQuery(explicitMediaQuery) {
    if (explicitMediaQuery) return explicitMediaQuery;
    try {
      return typeof matchMedia === 'function'
        ? matchMedia('(prefers-color-scheme: dark)')
        : { matches: false };
    } catch (_) {
      return { matches: false };
    }
  }

  function resolveTheme(preference, mediaQuery) {
    const normalized = normalizeTheme(preference);
    return normalized === 'system'
      ? (getMediaQuery(mediaQuery).matches ? 'dark' : 'light')
      : normalized;
  }

  function applyTheme(document, preference, mediaQuery) {
    const normalized = normalizeTheme(preference);
    const resolved = resolveTheme(normalized, mediaQuery);
    if (!document || !document.documentElement) return resolved;
    const html = document.documentElement;
    html.dataset.theme = resolved;
    html.dataset.themePreference = normalized;
    if (html.style) html.style.colorScheme = resolved;
    return resolved;
  }

  function createBootstrapScript() {
    return "!function(){var p='dark',e=document.documentElement;try{var v=localStorage.getItem('" + THEME_PREFERENCE_KEY + "');p=['light','dark','system'].indexOf(v)<0?'dark':v}catch(_){}try{var d=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',t=p==='system'?d:p;e.dataset.theme=t;e.dataset.themePreference=p;e.style.colorScheme=t}catch(_){} }();";
  }

  function setStoredTheme(storage, preference) {
    try {
      const safeStorage = getStorage(storage);
      if (safeStorage) safeStorage.setItem(THEME_PREFERENCE_KEY, preference);
    } catch (_) {
      // Privacy mode, blocked storage, or quota exhaustion must not break controls.
    }
  }

  function makeLabel(document, value, text) {
    const label = document.createElement('label');
    label.className = 'theme-preference__option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'sorena-theme-preference';
    input.value = value;
    input.className = 'theme-preference__input';
    const copy = document.createElement('span');
    copy.className = 'theme-preference__label';
    copy.textContent = text;
    label.append(input, copy);
    return { label, input };
  }

  function mountThemePreference(container, options) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('mountThemePreference requires a container element');
    }
    const config = options || {};
    const document = config.document || (typeof window !== 'undefined' ? window.document : null);
    if (!document) throw new TypeError('mountThemePreference requires a document');
    const storage = getStorage(config.storage);
    const mediaQuery = getMediaQuery(config.mediaQuery);
    let preference = getStoredTheme(storage);
    const labels = [
      makeLabel(document, 'light', config.lightLabel || 'Light'),
      makeLabel(document, 'dark', config.darkLabel || 'Dark'),
      makeLabel(document, 'system', config.systemLabel || 'System'),
    ];
    const group = document.createElement('fieldset');
    group.className = 'theme-preference';
    const legend = document.createElement('legend');
    legend.className = 'theme-preference__legend';
    legend.textContent = config.legend || 'Theme';
    group.appendChild(legend);
    labels.forEach(({ label, input }) => {
      input.checked = input.value === preference;
      input.addEventListener('change', function () {
        if (!input.checked) return;
        preference = normalizeTheme(input.value);
        setStoredTheme(storage, preference);
        applyTheme(document, preference, mediaQuery);
        if (typeof config.onChange === 'function') config.onChange(preference, resolveTheme(preference, mediaQuery));
      });
      group.appendChild(label);
    });
    container.appendChild(group);
    applyTheme(document, preference, mediaQuery);
    const onSystemThemeChange = function () {
      if (preference === 'system') applyTheme(document, preference, mediaQuery);
    };
    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onSystemThemeChange);
    } else if (mediaQuery && typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(onSystemThemeChange);
    }

    return {
      getPreference: function () { return preference; },
      getResolvedTheme: function () { return resolveTheme(preference, mediaQuery); },
      destroy: function () {
        if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', onSystemThemeChange);
        } else if (mediaQuery && typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(onSystemThemeChange);
        }
        if (group.parentNode && typeof group.parentNode.removeChild === 'function') group.parentNode.removeChild(group);
      },
    };
  }

  return {
    THEME_PREFERENCE_KEY,
    THEMES,
    normalizeTheme,
    getStoredTheme,
    resolveTheme,
    applyTheme,
    createBootstrapScript,
    mountThemePreference,
  };
});
