import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateReadablePath, READABLE_EXTRA_ROOTS } from './readablePath.js';

const FORBIDDEN = {
  valid: false,
  status: 403,
  error: 'Path is outside the project and the allowed folders',
};

let base;
let project;
let work;
let claude;
let extra;

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'readable-'));
  project = path.join(base, 'project');
  work = path.join(base, 'work');
  claude = path.join(base, 'claude');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(path.join(work, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(base, 'work-old'), { recursive: true });
  await fs.mkdir(path.join(claude, 'plans'), { recursive: true });
  await fs.writeFile(path.join(work, 'inputs', 'Test 1 (2).txt'), 'x');
  await fs.writeFile(path.join(base, 'work-old', 'x.txt'), 'x');
  await fs.writeFile(path.join(claude, 'plans', 'p.md'), 'x');
  await fs.writeFile(path.join(claude, '.credentials.json'), 'secret');
  extra = [work, path.join(claude, 'plans')];
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

test('project file by relative path is readable', async () => {
  const result = await validateReadablePath(project, 'a.txt', extra);
  assert.deepEqual(result, { valid: true, resolved: path.join(project, 'a.txt') });
});

test('file in work subfolder is readable from another project', async () => {
  const file = path.join(work, 'inputs', 'Test 1 (2).txt');
  const result = await validateReadablePath(project, file, extra);
  assert.equal(result.valid, true);
  assert.equal(result.resolved, await fs.realpath(file));
});

test('file in claude plans is readable', async () => {
  const result = await validateReadablePath(project, path.join(claude, 'plans', 'p.md'), extra);
  assert.equal(result.valid, true);
});

test('rest of claude dir is rejected', async () => {
  const result = await validateReadablePath(project, path.join(claude, '.credentials.json'), extra);
  assert.deepEqual(result, FORBIDDEN);
});

test('sibling folder with the same prefix is rejected', async () => {
  const result = await validateReadablePath(project, path.join(base, 'work-old', 'x.txt'), extra);
  assert.deepEqual(result, FORBIDDEN);
});

test('traversal out of work is rejected', async () => {
  const result = await validateReadablePath(
    project,
    path.join(work, '..', 'claude', '.credentials.json'),
    extra,
  );
  assert.deepEqual(result, FORBIDDEN);
});

test('symlink inside work pointing outside is rejected', async (t) => {
  try {
    await fs.symlink(claude, path.join(work, 'link'), 'junction');
  } catch (err) {
    if (err.code === 'EPERM') {
      t.skip('symlinks not permitted');
      return;
    }
    throw err;
  }
  const result = await validateReadablePath(
    project,
    path.join(work, 'link', '.credentials.json'),
    extra,
  );
  assert.deepEqual(result, FORBIDDEN);
});

test('missing file in work returns 404', async () => {
  const result = await validateReadablePath(project, path.join(work, 'inputs', 'nope.txt'), extra);
  assert.deepEqual(result, { valid: false, status: 404, error: 'File not found' });
});

test('missing extra root is ignored', async () => {
  const missing = path.join(base, 'does-not-exist');
  const result = await validateReadablePath(project, path.join(missing, 'f.txt'), [missing]);
  assert.deepEqual(result, FORBIDDEN);
});

test('default roots are work and claude plans', () => {
  assert.deepEqual(READABLE_EXTRA_ROOTS, ['/home/node/work', '/home/node/.claude/plans']);
});
