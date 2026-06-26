// server/services/attachments/markdownTable.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCell, renderMarkdownTable } from './markdownTable.js';

test('escapeCell escapes pipes and newlines, trims', () => {
  assert.equal(escapeCell('a|b'), 'a\\|b');
  assert.equal(escapeCell('line1\nline2'), 'line1<br>line2');
  assert.equal(escapeCell('  x  '), 'x');
  assert.equal(escapeCell(null), '');
  assert.equal(escapeCell(42), '42');
});

test('renderMarkdownTable builds a GFM table with header + separator', () => {
  const md = renderMarkdownTable([['Name', 'Id'], ['Alice', 1], ['Bob', 2]]);
  const lines = md.split('\n');
  assert.equal(lines[0], '| Name | Id |');
  assert.equal(lines[1], '| --- | --- |');
  assert.equal(lines[2], '| Alice | 1 |');
  assert.equal(lines[3], '| Bob | 2 |');
});

test('renderMarkdownTable fills missing header cells with Col<n>', () => {
  const md = renderMarkdownTable([['Name', ''], ['Alice', 'x']]);
  assert.equal(md.split('\n')[0], '| Name | Col2 |');
});

test('renderMarkdownTable normalizes ragged rows to widest', () => {
  const md = renderMarkdownTable([['A'], ['x', 'y']]);
  const lines = md.split('\n');
  assert.equal(lines[0], '| A | Col2 |');
  assert.equal(lines[2], '| x | y |');
});

test('renderMarkdownTable returns empty string when no data', () => {
  assert.equal(renderMarkdownTable([]), '');
  assert.equal(renderMarkdownTable([['', '  ']]), '');
});
