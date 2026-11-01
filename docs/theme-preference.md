# Theme preference module

Standalone theme preference support for the Sorena Watch market pages. This module is intentionally isolated so the parent worker can integrate it into the shared HTML/shell after review.

## Files

- `market/theme-preference.js` — safe preference storage, system-theme resolution, pre-paint bootstrap generator, accessible radio-group mounting, and OS theme-change handling.
- `market/theme-preference.css` — light/dark token mappings, theme-aware surfaces/controls, semantic status/chart colors, accessible focus states, responsive control layout, and reduced-motion support.
- `tests/theme_preference.test.cjs` — Node tests for behavior and storage failure paths.

## Parent integration

Load the tiny bootstrap inline in `<head>`, **before stylesheets that paint the page**. The generated string is available from Node/CommonJS or the browser bundle:

```html
<script>
!function(){try{var k='sorena-theme',p=localStorage.getItem(k);p=['light','dark','system'].indexOf(p)<0?'system':p;var d=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',t=p==='system'?d:p,e=document.documentElement;e.dataset.theme=t;e.dataset.themePreference=p;e.style.colorScheme=t}catch(_){}}();
</script>
<link rel="stylesheet" href="market/theme-preference.css">
```

The parent may instead emit `createBootstrapScript()` from `market/theme-preference.js`; keep the result inline in the document head. The bootstrap is deliberately small and does not require the full module to have loaded.

After the shared token stylesheet, mount the control into an existing header/actions container:

```html
<div id="themePreferenceControl"></div>
<script src="market/theme-preference.js"></script>
<script>
  SorenaThemePreference.mountThemePreference(
    document.getElementById('themePreferenceControl'),
    { legend: 'Theme', lightLabel: 'Light', darkLabel: 'Dark', systemLabel: 'System' }
  );
</script>
```

For the Persian UI, pass localized labels while keeping the values unchanged:

```js
SorenaThemePreference.mountThemePreference(container, {
  legend: 'پوسته',
  lightLabel: 'روشن',
  darkLabel: 'تیره',
  systemLabel: 'سیستم',
});
```

## Contract

- Storage key: `sorena-theme`.
- Values: `light`, `dark`, or `system`. Missing, malformed, blocked, or unreadable storage resolves to `system`.
- `system` follows `prefers-color-scheme: dark`; the mounted control updates when the media query changes.
- The resolved value is written to `html[data-theme]`; the requested value is written to `html[data-theme-preference]`.
- Storage failures are swallowed intentionally so private browsing, disabled storage, and quota errors do not disable the control.
- `destroy()` removes the media-query listener and control when a parent route unmounts it.

## Styling notes

The CSS consumes existing `--ds-*` tokens first and uses the older `--bg`, `--surface`, `--ink`, `--muted`, `--line`, `--green`, and `--red` tokens as fallbacks. Dark-mode values are explicitly defined under `html[data-theme="dark"]` so prior light declarations cannot win the cascade. No global invert filter is used.

Positive, negative, and warning states use separate theme-aware colors (`--chart-positive`, `--chart-negative`, and `--chart-warning`) and retain distinct chart series selectors. The module does not rewrite data or chart geometry.

All options retain a 44px minimum touch target and native radio semantics. Focus-visible styles are preserved, and `prefers-reduced-motion: reduce` disables transitions/animations without hiding content.

## Verification

```sh
node tests/theme_preference.test.cjs
node --check market/theme-preference.js
git diff --check
```

The unit test uses no market fixture or fabricated market data. The parent should run its existing local browser QA after loading the two assets; this module can also be checked in an isolated browser fixture by asserting `document.documentElement.dataset.theme` and the three accessible radio inputs.

This change intentionally does not edit shared HTML, shared tokens, or deployment files.
