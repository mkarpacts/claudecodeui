// server/services/attachments/converters/xlsx.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { convertXlsxToMarkdown } from './xlsx.js';

function makeXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('converts a single sheet to a section + table', () => {
  const buf = makeXlsx({ Mapping: [['FeeType', 'Id'], ['Deposit', 10], ['Withdrawal', 20]] });
  const md = convertXlsxToMarkdown(buf);
  assert.match(md, /## Mapping/);
  assert.match(md, /\| FeeType \| Id \|/);
  assert.match(md, /\| Deposit \| 10 \|/);
});

test('emits one section per sheet', () => {
  const buf = makeXlsx({ A: [['x'], ['1']], B: [['y'], ['2']] });
  const md = convertXlsxToMarkdown(buf);
  assert.match(md, /## A/);
  assert.match(md, /## B/);
});

test('empty workbook yields the empty notice', () => {
  const buf = makeXlsx({ Empty: [['', '']] });
  const md = convertXlsxToMarkdown(buf);
  assert.match(md, /_\(empty sheet\)_|_\(document contained no extractable text\)_/);
});
