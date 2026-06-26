// server/services/attachments/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { processAttachment, detectKind } from './index.js';

test('detectKind matches by extension first, then mime', () => {
  assert.equal(detectKind('a.docx', 'application/octet-stream'), 'docx');
  assert.equal(detectKind('a.xlsx', ''), 'xlsx');
  assert.equal(
    detectKind('noext', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'xlsx'
  );
  assert.equal(detectKind('a.png', 'image/png'), null);
});

test('xlsx is converted to a .md markdown attachment', async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['H'], ['v']]), 'S');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const att = await processAttachment({ buffer, name: 'fees.xlsx', mimeType: '' });
  assert.equal(att.name, 'fees.md');
  assert.equal(att.mimeType, 'text/markdown');
  assert.match(att.data, /^data:text\/markdown;base64,/);
  const decoded = Buffer.from(att.data.split(',')[1], 'base64').toString('utf8');
  assert.match(decoded, /## S/);
});

test('non-office files pass through unchanged as base64', async () => {
  const buffer = Buffer.from('hello');
  const att = await processAttachment({ buffer, name: 'a.txt', mimeType: 'text/plain' });
  assert.equal(att.name, 'a.txt');
  assert.equal(att.mimeType, 'text/plain');
  assert.equal(att.data, `data:text/plain;base64,${buffer.toString('base64')}`);
});
