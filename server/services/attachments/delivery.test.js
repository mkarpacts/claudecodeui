import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleAttachments, cleanupTempFiles, safeFilename } from './delivery.js';
import { OFFICE } from './constants.js';

const dataUrl = (mime, text) => `data:${mime};base64,${Buffer.from(text).toString('base64')}`;
// Paths of the temp files handleAttachments wrote, sorted by name ([] when there is no temp dir).
const tempFiles = async (r) =>
  r.tempDir ? (await fs.readdir(r.tempDir)).sort().map((n) => path.join(r.tempDir, n)) : [];

test('text attachment is written to a temp dir and listed in the prompt', async () => {
  const r = await handleAttachments('read it', [{ name: 'a.txt', data: dataUrl('text/plain', 'hello') }]);
  const [file] = await tempFiles(r);
  assert.equal(path.basename(file), 'a.txt');
  assert.equal(await fs.readFile(file, 'utf8'), 'hello');
  assert.equal(r.modifiedCommand, `read it\n\n[Attached files:]\n1. ${file}`);
  await cleanupTempFiles(r.tempDir);
  await assert.rejects(fs.access(r.tempDir));
});

test('attachment with a disallowed extension and unknown mime is skipped', async () => {
  const r = await handleAttachments('x', [{ name: 'a.exe', data: dataUrl('application/x-msdownload', 'MZ') }]);
  assert.deepEqual(await tempFiles(r), []);
  assert.equal(r.modifiedCommand, 'x');
  await cleanupTempFiles(r.tempDir);
});

test('safeFilename strips directories and derives extension from mime', () => {
  assert.equal(safeFilename('../../etc/a.txt', 'text/plain'), 'a.txt');
  assert.equal(safeFilename('noext', 'application/pdf'), 'noext.pdf');
  assert.equal(safeFilename('photo.heic', 'image/jpeg'), 'photo.jpg');
  assert.equal(safeFilename('a.exe', 'application/x-msdownload'), null);
});

const DOCX_MIME = OFFICE.docx.mime;
const NOW = new Date(2026, 10, 12, 16, 8, 42);
const rmAfter = (t, dir) => t.after(() => (dir ? fs.rm(dir, { recursive: true, force: true }) : undefined));
const mkInputs = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inputs-delivery-'));
  rmAfter(t, dir);
  return dir;
};

test('docx is stored in the inputs dir, listed in the prompt and survives cleanup', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('review', [{ name: 'spec.docx', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  const stored = path.join(inputsDir, 'spec.docx');
  assert.equal(r.modifiedCommand, `review\n\n[Attached files:]\n1. ${stored}`);
  assert.equal(r.tempDir, null);
  await cleanupTempFiles(r.tempDir);
  assert.equal(await fs.readFile(stored, 'utf8'), 'PK');
});

test('same name in a later message gets the timestamp prefix', async (t) => {
  const inputsDir = await mkInputs(t);
  const att = [{ name: 'spec.docx', data: dataUrl(DOCX_MIME, 'PK') }];
  const first = await handleAttachments('one', att, { inputsDir, now: NOW });
  rmAfter(t, first.tempDir);
  const r = await handleAttachments('two', att, { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  assert.match(r.modifiedCommand, /2026-11-12_16-08-42_spec\.docx$/);
});

test('mixed attachments keep their order; only the temp file is cleaned up', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('go', [
    { name: 'a.txt', data: dataUrl('text/plain', 'hello') },
    { name: 'spec.docx', data: dataUrl(DOCX_MIME, 'PK') },
  ], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  const lines = r.modifiedCommand.split('\n').slice(-2);
  assert.equal(lines[0], `1. ${(await tempFiles(r))[0]}`);
  assert.equal(lines[1], `2. ${path.join(inputsDir, 'spec.docx')}`);
  await cleanupTempFiles(r.tempDir);
  await assert.rejects(fs.access(r.tempDir));
  await fs.access(path.join(inputsDir, 'spec.docx'));
});

test('non-ASCII names are stored unchanged', async (t) => {
  const inputsDir = await mkInputs(t);
  const r1 = await handleAttachments('x', [{ name: 'Analýza poplatků.docx', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r1.tempDir);
  const r2 = await handleAttachments('x', [{ name: 'Звіт.docx', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r2.tempDir);
  assert.deepEqual((await fs.readdir(inputsDir)).sort(), ['Analýza poplatků.docx', 'Звіт.docx'].sort());
});

test('path separators in the name cannot escape the inputs dir', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('x', [{ name: '../../evil.docx', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  assert.ok(r.modifiedCommand.endsWith(`1. ${path.join(inputsDir, 'evil.docx')}`));
  assert.deepEqual(await fs.readdir(inputsDir), ['evil.docx']);
});

test('upper-case extension is treated as an office file', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('x', [{ name: 'SPEC.DOCX', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  assert.deepEqual(await fs.readdir(inputsDir), ['SPEC.DOCX']);
});

test('a non-office name with an office mime is not stored in inputs', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('x', [{ name: 'x.exe', data: dataUrl(DOCX_MIME, 'MZ') }], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  assert.deepEqual(await fs.readdir(inputsDir), []);
  await cleanupTempFiles(r.tempDir);
});

test('oversized attachments and attachments beyond the fifth are not stored', async (t) => {
  const inputsDir = await mkInputs(t);
  const big = { name: 'big.docx', data: `data:${DOCX_MIME};base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')}` };
  const r1 = await handleAttachments('x', [big], { inputsDir, now: NOW });
  rmAfter(t, r1.tempDir);
  assert.deepEqual(await fs.readdir(inputsDir), []);
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ name: `f${n}.docx`, data: dataUrl(DOCX_MIME, 'PK') }));
  const r2 = await handleAttachments('x', six, { inputsDir, now: NOW });
  rmAfter(t, r2.tempDir);
  assert.deepEqual((await fs.readdir(inputsDir)).sort(), ['f1.docx', 'f2.docx', 'f3.docx', 'f4.docx', 'f5.docx']);
});

test('one broken attachment does not drop the paths of the others', async (t) => {
  const inputsDir = await mkInputs(t);
  const r = await handleAttachments('x', [
    { name: 'spec.docx', data: dataUrl(DOCX_MIME, 'PK') },
    { name: 'broken.docx' },
  ], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  assert.equal(r.modifiedCommand, `x\n\n[Attached files:]\n1. ${path.join(inputsDir, 'spec.docx')}`);
});

test('when the inputs dir is missing the docx still reaches the prompt via the temp dir', async (t) => {
  const root = await mkInputs(t);
  const inputsDir = path.join(root, 'missing');
  const r = await handleAttachments('x', [{ name: 'spec.docx', data: dataUrl(DOCX_MIME, 'PK') }], { inputsDir, now: NOW });
  rmAfter(t, r.tempDir);
  const files = await tempFiles(r);
  assert.deepEqual(files.map((f) => path.basename(f)), ['spec.docx']);
  assert.ok(r.modifiedCommand.endsWith(
    `1. ${files[0]} (temporary copy: could not be saved to ${inputsDir}; it is deleted after this reply)`
  ));
  await cleanupTempFiles(r.tempDir);
});

test('two same-named non-office attachments in one message get a_1 suffix in the temp dir', async (t) => {
  const r = await handleAttachments('read', [
    { name: 'a.txt', data: dataUrl('text/plain', 'first') },
    { name: 'a.txt', data: dataUrl('text/plain', 'second') },
  ]);
  t.after(() => cleanupTempFiles(r.tempDir));
  const files = await tempFiles(r);
  assert.deepEqual(files.map((f) => path.basename(f)), ['a.txt', 'a_1.txt']);
  assert.equal(await fs.readFile(files[0], 'utf8'), 'first');
  assert.equal(await fs.readFile(files[1], 'utf8'), 'second');
  assert.equal(
    r.modifiedCommand,
    `read\n\n[Attached files:]\n1. ${files[0]}\n2. ${files[1]}`,
  );
});
