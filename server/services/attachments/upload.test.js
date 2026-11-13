import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { toStoredName, safeFilename, storeAttachments, saveFailureReason, AttachmentError, createUploadAttachmentsHandler } from './upload.js';
import { OFFICE } from './constants.js';

const DOCX_MIME = OFFICE.docx.mime;
const XLSX_MIME = OFFICE.xlsx.mime;
const mangled = (s) => Buffer.from(s, 'utf8').toString('latin1');
// Fixture only: a throwaway dir standing in for the inputs folder.
const mkDir = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inputs-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};

test('toStoredName restores Czech names', () => {
  const name = 'HL_CTS_SLSP_Změna číselníku SK_NACE2_v1.1.docx';
  assert.equal(toStoredName(mangled(name), DOCX_MIME), name);
});

test('toStoredName normalizes NFD to NFC', () => {
  assert.equal(
    toStoredName(mangled('Změna.md'.normalize('NFD')), 'text/markdown'),
    'Změna.md'.normalize('NFC'),
  );
});

test('toStoredName strips directories and derives or rejects extensions', () => {
  assert.equal(toStoredName('../../etc/a.txt', 'text/plain'), 'a.txt');
  assert.equal(toStoredName('shot', 'image/png'), 'shot.png');
  assert.equal(toStoredName('a.exe', 'application/x-msdownload'), null);
});

test('safeFilename strips directories and derives extension from mime', () => {
  assert.equal(safeFilename('../../etc/a.txt', 'text/plain'), 'a.txt');
  assert.equal(safeFilename('noext', 'application/pdf'), 'noext.pdf');
  assert.equal(safeFilename('photo.heic', 'image/jpeg'), 'photo.jpg');
  assert.equal(safeFilename('a.exe', 'application/x-msdownload'), null);
});

test('storeAttachments saves every allowed format', async (t) => {
  const dir = await mkDir(t);
  const files = [
    { originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.from([1, 2, 3]) },
    { originalname: 'b.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF') },
    { originalname: 'c.md', mimetype: 'text/markdown', buffer: Buffer.from('# hi') },
    { originalname: 'd.xlsx', mimetype: XLSX_MIME, buffer: Buffer.from('PK') },
  ];
  const result = await storeAttachments(files, { dir });
  assert.equal(result.length, 4);
  for (const [i, f] of files.entries()) {
    assert.equal(result[i].name, f.originalname);
    assert.equal(result[i].path, path.join(dir, result[i].name));
    assert.deepEqual(await fs.readFile(result[i].path), f.buffer);
    assert.equal(result[i].size, f.buffer.length);
    assert.equal(result[i].mimeType, f.mimetype);
  }
});

test('two pasted image.png in one call get distinct files', async (t) => {
  const dir = await mkDir(t);
  const now = new Date(2026, 10, 13, 10, 0, 0);
  const result = await storeAttachments([
    { originalname: 'image.png', mimetype: 'image/png', buffer: Buffer.from('one') },
    { originalname: 'image.png', mimetype: 'image/png', buffer: Buffer.from('two') },
  ], { dir, now });
  assert.deepEqual(result.map((r) => r.name), ['image.png', '2026-11-13_10-00-00_image.png']);
  assert.equal(await fs.readFile(result[0].path, 'utf8'), 'one');
  assert.equal(await fs.readFile(result[1].path, 'utf8'), 'two');
});

test('missing dir fails with the file name', async (t) => {
  const dir = path.join(await mkDir(t), 'nope');
  await assert.rejects(
    storeAttachments([{ originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.from('x') }], { dir }),
    (err) => err instanceof AttachmentError
      && /Could not save "a.png": folder .* does not exist/.test(err.message),
  );
});

test('ENAMETOOLONG maps to a readable reason inside the save error', () => {
  // Windows/NTFS does not reject a 200-char name, so a real save cannot raise ENAMETOOLONG
  // portably; assert the mapping with a fake error carrying the code.
  const reason = saveFailureReason(Object.assign(new Error('boom'), { code: 'ENAMETOOLONG' }), '/x');
  assert.match(`Could not save "${'ž'.repeat(200)}.txt": ${reason}`, /Could not save ".*": file name is too long/);
  assert.match(reason, /rename the file and try again/);
});

test('a failure keeps files saved before it', async (t) => {
  const dir = await mkDir(t);
  await assert.rejects(
    storeAttachments([
      { originalname: 'ok.txt', mimetype: 'text/plain', buffer: Buffer.from('ok') },
      { originalname: 'bad.exe', mimetype: 'application/x-msdownload', buffer: Buffer.from('MZ') },
    ], { dir }),
    (err) => err instanceof AttachmentError && /Unsupported file "bad.exe"/.test(err.message),
  );
  assert.equal(await fs.readFile(path.join(dir, 'ok.txt'), 'utf8'), 'ok');
});

// ---- endpoint -------------------------------------------------------------
const startApp = async (t, dir) => {
  const app = express();
  app.post('/u', createUploadAttachmentsHandler({ dir }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/u`;
};
const post = (url, files) => {
  const form = new FormData();
  for (const [name, type, content] of files) {
    form.append('attachments', new Blob([content], { type }), name);
  }
  return fetch(url, { method: 'POST', body: form });
};

test('endpoint stores Czech docx, png and md', async (t) => {
  const dir = await mkDir(t);
  const url = await startApp(t, dir);
  const czech = 'HL_CTS_SLSP_Změna číselníku SK_NACE2_v1.1.docx';
  const res = await post(url, [
    [czech, DOCX_MIME, 'PK docx'],
    ['a.png', 'image/png', 'png'],
    ['b.md', 'text/markdown', '# md'],
  ]);
  assert.equal(res.status, 200);
  const { attachments } = await res.json();
  assert.deepEqual(attachments.map((a) => a.name), [czech, 'a.png', 'b.md']);
  for (const a of attachments) {
    assert.ok(!('data' in a));
    await fs.access(path.join(dir, a.name));
  }
});

test('endpoint without inputs dir returns 400 naming the file', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = path.join(await mkDir(t), 'missing');
  const url = await startApp(t, dir);
  const res = await post(url, [['a.md', 'text/markdown', 'x']]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Could not save ".*": folder .* does not exist/);
});

test('endpoint rejects legacy .doc', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = await mkDir(t);
  const url = await startApp(t, dir);
  const res = await post(url, [['old.doc', 'application/msword', 'x']]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Legacy \.doc\/\.xls is not supported/);
});

test('endpoint rejects 6 files and a file over 10 MB', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = await mkDir(t);
  const url = await startApp(t, dir);
  const six = Array.from({ length: 6 }, (_, i) => [`f${i}.md`, 'text/markdown', 'x']);
  assert.equal((await post(url, six)).status, 400);
  const big = await post(url, [['big.pdf', 'application/pdf', Buffer.alloc(11 * 1024 * 1024)]]);
  assert.equal(big.status, 400);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('endpoint without files returns 400', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const dir = await mkDir(t);
  const url = await startApp(t, dir);
  const res = await fetch(url, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'No files provided');
});
