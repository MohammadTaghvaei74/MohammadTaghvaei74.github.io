// Deterministic light-palette gate, not a substitute for computed browser QA.
// Run: node --test tests/design_contrast.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'market', file), 'utf8');
const css = read('design-system.css');
const extrasCss = read('design-extras.css');
const tokens = {};
// Only unconditional :root blocks; later declarations win, like CSS source order.
for (const [, block] of css.matchAll(/:root\s*\{([^}]+)\}/g)) {
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
}
function color(value, seen = []) {
  assert.ok(value, 'missing color declaration');
  value = value.trim().replace(/\s*!important$/, '');
  const variable = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (variable) {
    assert.ok(!seen.includes(variable[1]), `cyclic token ${variable[1]}`);
    return color(tokens[variable[1]] || variable[2], [...seen, variable[1]]);
  }
  assert.match(value, /^#(?:[\da-f]{3}|[\da-f]{6})$/i, `unsupported color: ${value}`);
  return value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value;
}
function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function ratio(foreground, background) {
  const values = [luminance(color(foreground)), luminance(color(background))].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}
function check(label, fg, bg, threshold = 4.5) {
  const result = ratio(fg, bg);
  assert.ok(result >= threshold, `${label}: ${color(fg)} on ${color(bg)} = ${result.toFixed(3)}:1; requires ${threshold}:1`);
}
function declaration(block, property) {
  const result = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(result, `missing ${property}`);
  return result[1];
}

test('contrast math catches the audited regressions without rounding up', () => {
  assert.equal(ratio('#000', '#fff'), 21);
  for (const [fg, bg] of [['#82938f', '#f4f6ef'], ['#fff', '#e97845'], ['#33966b', '#fff'], ['#d85c68', '#fff']]) {
    assert.ok(ratio(fg, bg) < 4.5, `${fg} on ${bg} must fail AA normal text`);
  }
});
test('shared text tokens meet AA on supported light surfaces', () => {
  for (const fg of ['--ds-ink', '--ds-muted', '--ds-positive', '--ds-negative', '--ds-warning', '--ds-info', '--ds-archive']) {
    for (const bg of ['--ds-bg', '--ds-surface', '--ds-surface-muted']) check(`${fg}/${bg}`, `var(${fg})`, `var(${bg})`);
  }
});
test('unavailable comparison text resolves to an AA-safe token or fallback', () => {
  const rule = extrasCss.match(/\.sorena-extras-table\s+\.is-unavailable\s*\{([^}]+)\}/);
  assert.ok(rule, 'missing unavailable comparison text rule');
  for (const bg of ['--ds-bg', '--ds-surface', '--ds-surface-muted']) {
    check(`unavailable/${bg}`, declaration(rule[1], 'color'), `var(${bg})`);
  }
});
test('actual status text/background declarations meet AA', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(([, selectors, body]) => selectors.includes('.observation-clock[data-status=') && /(?:^|;)\s*background:/.test(body));
  assert.ok(rules.length >= 4, 'expected fresh, stale/error, unknown, and archive rules');
  for (const [, selectors, body] of rules) check(selectors.trim(), declaration(body, 'color'), declaration(body, 'background'));
});
test('actual options CTA foreground/background meet AA', () => {
  const rule = css.match(/\.options-preparation\s+\.options-cta\s*\{([^}]+)\}/);
  assert.ok(rule, 'missing options CTA rule');
  check('options CTA', declaration(rule[1], 'color'), declaration(rule[1], 'background'));
});
test('focus indicator meets 3:1 on light surfaces', () => {
  for (const bg of ['--ds-bg', '--ds-surface', '--ds-surface-muted']) check(`focus/${bg}`, 'var(--ds-focus)', `var(${bg})`, 3);
});
