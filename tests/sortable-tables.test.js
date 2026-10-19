'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sorter = require('../market/sortable-tables.js');

function row(value, index) {
  return { cells: [{ textContent: value, dataset: {} }], _defaultIndex: index };
}

test('three-state comparator orders Persian numerals, signs, and missing values', () => {
  const rows = [row('—', 0), row('۳٫۵', 1), row('-۱٫۲', 2), row('۱۰', 3)];
  assert.deepEqual(rows.slice().sort((a, b) => sorter.compareRows(a, b, 0, 'asc')).map(r => r.cells[0].textContent), ['-۱٫۲', '۳٫۵', '۱۰', '—']);
  assert.deepEqual(rows.slice().sort((a, b) => sorter.compareRows(a, b, 0, 'desc')).map(r => r.cells[0].textContent), ['۱۰', '۳٫۵', '-۱٫۲', '—']);
});

test('text values use Persian collation and preserve default order on ties', () => {
  const rows = [row('ب', 0), row('الف', 1), row('الف', 2)];
  assert.deepEqual(rows.slice().sort((a, b) => sorter.compareRows(a, b, 0, 'asc')).map(r => r.cells[0].textContent), ['الف', 'الف', 'ب']);
  assert.equal(sorter.normalizeDigits('۱۲۳'), '123');
});