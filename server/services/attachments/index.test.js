// server/services/attachments/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeUploadName } from './index.js';

test('decodeUploadName restores UTF-8 names mangled as latin1 by multer', () => {
  const mangled = (s) => Buffer.from(s, 'utf8').toString('latin1');
  assert.equal(decodeUploadName(mangled('Analýza poplatků.docx')), 'Analýza poplatků.docx');
  assert.equal(decodeUploadName(mangled('Звіт.xlsx')), 'Звіт.xlsx');
  assert.equal(decodeUploadName('plain-name.docx'), 'plain-name.docx');
  assert.equal(decodeUploadName('café.docx'), 'café.docx'); // real latin1, not UTF-8 bytes
  assert.equal(decodeUploadName('Звіт.xlsx'), 'Звіт.xlsx'); // already correct
});
