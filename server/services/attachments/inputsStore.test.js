// server/services/attachments/inputsStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveToInputs, timestampPrefix, getInputsDir } from './inputsStore.js';

const NOW = new Date(2026, 10, 12, 16, 8, 42); // 12 Nov 2026 16:08:42 local
const mkdir = async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inputs-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
};

test('timestampPrefix formats local time with zero padding', () => {
  assert.equal(timestampPrefix(NOW), '2026-11-12_16-08-42');
  assert.equal(timestampPrefix(new Date(2026, 0, 5, 3, 4, 9)), '2026-01-05_03-04-09');
});

test('first file keeps its name, second gets the timestamp prefix, third a counter', async (t) => {
  const dir = await mkdir(t);
  const a = await saveToInputs({ dir, filename: 'spec.docx', buffer: Buffer.from('one'), now: NOW });
  const b = await saveToInputs({ dir, filename: 'spec.docx', buffer: Buffer.from('two'), now: NOW });
  const c = await saveToInputs({ dir, filename: 'spec.docx', buffer: Buffer.from('three'), now: NOW });
  assert.equal(a, path.join(dir, 'spec.docx'));
  assert.equal(b, path.join(dir, '2026-11-12_16-08-42_spec.docx'));
  assert.equal(c, path.join(dir, '2026-11-12_16-08-42_spec_1.docx'));
  assert.equal(await fs.readFile(a, 'utf8'), 'one');
  assert.equal(await fs.readFile(b, 'utf8'), 'two');
  assert.equal(await fs.readFile(c, 'utf8'), 'three');
});

test('concurrent saves of the same name never overwrite each other', async (t) => {
  const dir = await mkdir(t);
  const paths = await Promise.all(
    ['a', 'b', 'c', 'd'].map((x) => saveToInputs({ dir, filename: 'x.xlsx', buffer: Buffer.from(x), now: NOW }))
  );
  assert.equal(new Set(paths).size, 4);
  const contents = await Promise.all(paths.map((p) => fs.readFile(p, 'utf8')));
  assert.deepEqual(contents.sort(), ['a', 'b', 'c', 'd']);
});

test('a missing directory is an error and is not created', async (t) => {
  const dir = path.join(await mkdir(t), 'does-not-exist');
  await assert.rejects(saveToInputs({ dir, filename: 'a.docx', buffer: Buffer.from('x'), now: NOW }), { code: 'ENOENT' });
  await assert.rejects(fs.access(dir));
});

test('getInputsDir reads CLAUDE_UI_INPUTS_DIR and falls back to the default', () => {
  const prev = process.env.CLAUDE_UI_INPUTS_DIR;
  try {
    process.env.CLAUDE_UI_INPUTS_DIR = '/tmp/custom';
    assert.equal(getInputsDir(), path.resolve('/tmp/custom'));
    process.env.CLAUDE_UI_INPUTS_DIR = 'rel/inputs';
    assert.equal(getInputsDir(), path.resolve('rel/inputs'));
    delete process.env.CLAUDE_UI_INPUTS_DIR;
    assert.equal(getInputsDir(), path.resolve('/home/node/work/inputs'));
  } finally {
    if (prev !== undefined) process.env.CLAUDE_UI_INPUTS_DIR = prev;
    else delete process.env.CLAUDE_UI_INPUTS_DIR;
  }
});
