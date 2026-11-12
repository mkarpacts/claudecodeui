// server/services/attachments/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processAttachment, detectKind, decodeUploadName } from './index.js';
import { OFFICE } from './constants.js';

test('detectKind matches by extension first, then mime', () => {
  assert.equal(detectKind('a.docx', 'application/octet-stream'), 'docx');
  assert.equal(detectKind('a.xlsx', ''), 'xlsx');
  assert.equal(
    detectKind('noext', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'xlsx'
  );
  assert.equal(detectKind('a.png', 'image/png'), null);
});

const DOCX_MIME = OFFICE.docx.mime;
const XLSX_MIME = OFFICE.xlsx.mime;

test('xlsx passes through as the original file', async () => {
  const buffer = Buffer.from('PK not a real workbook');
  const att = await processAttachment({ buffer, name: 'fees.xlsx', mimeType: XLSX_MIME });
  assert.equal(att.name, 'fees.xlsx');
  assert.equal(att.mimeType, XLSX_MIME);
  assert.equal(att.size, buffer.length);
  assert.equal(att.data, `data:${XLSX_MIME};base64,${buffer.toString('base64')}`);
});

test('office mime is normalized when the browser sends none or a generic one', async () => {
  const buffer = Buffer.from('PK');
  const a = await processAttachment({ buffer, name: 'spec.docx', mimeType: '' });
  assert.equal(a.mimeType, DOCX_MIME);
  assert.ok(a.data.startsWith(`data:${DOCX_MIME};base64,`));
  const b = await processAttachment({ buffer, name: 'fees.xlsx', mimeType: 'application/octet-stream' });
  assert.equal(b.mimeType, XLSX_MIME);
});

test('decodeUploadName restores UTF-8 names mangled as latin1 by multer', () => {
  const mangled = (s) => Buffer.from(s, 'utf8').toString('latin1');
  assert.equal(decodeUploadName(mangled('Analýza poplatků.docx')), 'Analýza poplatků.docx');
  assert.equal(decodeUploadName(mangled('Звіт.xlsx')), 'Звіт.xlsx');
  assert.equal(decodeUploadName('plain-name.docx'), 'plain-name.docx');
  assert.equal(decodeUploadName('café.docx'), 'café.docx'); // real latin1, not UTF-8 bytes
  assert.equal(decodeUploadName('Звіт.xlsx'), 'Звіт.xlsx'); // already correct
});

test('non-office files pass through unchanged as base64', async () => {
  const buffer = Buffer.from('hello');
  const att = await processAttachment({ buffer, name: 'a.txt', mimeType: 'text/plain' });
  assert.equal(att.name, 'a.txt');
  assert.equal(att.mimeType, 'text/plain');
  assert.equal(att.data, `data:text/plain;base64,${buffer.toString('base64')}`);
});
