import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleAttachments } from './delivery.js';
import { AttachmentError } from './upload.js';

const mkDir = async (t, prefix) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};

const writeFiles = async (dir, names) => {
  const paths = [];
  for (const n of names) {
    const p = path.join(dir, n);
    await fs.writeFile(p, `content of ${n}`);
    paths.push(p);
  }
  return paths;
};

const NOT_AVAILABLE = /not available on the server/;

test('lists saved files in order and leaves them in place', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  const paths = await writeFiles(inputsDir, ['a.txt', 'b.png', 'c.docx']);
  const r = await handleAttachments(
    'read them',
    paths.map((p) => ({ name: path.basename(p), path: p })),
    { inputsDir },
  );
  assert.equal(
    r.modifiedCommand,
    `read them\n\n[Attached files:]\n1. ${paths[0]}\n2. ${paths[1]}\n3. ${paths[2]}`,
  );
  for (const p of paths) {
    assert.equal(await fs.readFile(p, 'utf8'), `content of ${path.basename(p)}`);
  }
});

test('no attachments keeps the command', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  assert.equal((await handleAttachments('x', undefined, { inputsDir })).modifiedCommand, 'x');
  assert.equal((await handleAttachments('x', [], { inputsDir })).modifiedCommand, 'x');
});

test('path outside inputs is rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  const other = await mkDir(t, 'other-delivery-');
  const [p] = await writeFiles(other, ['a.txt']);
  await assert.rejects(
    handleAttachments('x', [{ name: 'a.txt', path: p }], { inputsDir }),
    (err) => err instanceof AttachmentError && NOT_AVAILABLE.test(err.message) && err.message.includes('"a.txt"'),
  );
});

test('traversal path is rejected', async (t) => {
  const root = await mkDir(t, 'inputs-delivery-');
  const inputsDir = path.join(root, 'inputs');
  await fs.mkdir(inputsDir);
  await writeFiles(root, ['x.txt']);
  await assert.rejects(
    handleAttachments('x', [{ name: 'x.txt', path: path.join(inputsDir, '..', 'x.txt') }], { inputsDir }),
    NOT_AVAILABLE,
  );
});

test('missing file is rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  await assert.rejects(
    handleAttachments('x', [{ name: 'gone.txt', path: path.join(inputsDir, 'gone.txt') }], { inputsDir }),
    NOT_AVAILABLE,
  );
});

test('a directory is rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  const sub = path.join(inputsDir, 'sub');
  await fs.mkdir(sub);
  await assert.rejects(handleAttachments('x', [{ name: 'sub', path: sub }], { inputsDir }), NOT_AVAILABLE);
});

test('old base64 attachment without path is rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  await assert.rejects(
    handleAttachments('x', [{ name: 'a.txt', data: 'data:text/plain;base64,aGk=' }], { inputsDir }),
    NOT_AVAILABLE,
  );
});

test('non-array attachments are rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  await assert.rejects(handleAttachments('x', 'nope', { inputsDir }), AttachmentError);
});

test('error names the file by path basename or unknown when name is missing', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  await assert.rejects(
    handleAttachments('x', [{ path: path.join(inputsDir, 'gone.txt') }], { inputsDir }),
    /"gone\.txt"/,
  );
  await assert.rejects(handleAttachments('x', [{}], { inputsDir }), /"unknown"/);
});

test('more than five attachments are rejected', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  const paths = await writeFiles(inputsDir, [1, 2, 3, 4, 5, 6].map((n) => `f${n}.txt`));
  await assert.rejects(
    handleAttachments('x', paths.map((p) => ({ name: path.basename(p), path: p })), { inputsDir }),
    /at most 5/,
  );
});

test('blank command stays blank but invalid attachments still throw', async (t) => {
  const inputsDir = await mkDir(t, 'inputs-delivery-');
  const [p] = await writeFiles(inputsDir, ['a.txt']);
  assert.equal((await handleAttachments('', [{ name: 'a.txt', path: p }], { inputsDir })).modifiedCommand, '');
  await assert.rejects(handleAttachments('', [{ name: 'b.txt' }], { inputsDir }), NOT_AVAILABLE);
});
