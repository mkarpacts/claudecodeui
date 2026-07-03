// server/projects.sessionfile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSessionMessagesFromFile } from './projects.js';

test('reads one file, filters by sessionId, paginates from the end', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'abc.jsonl');
  const mk = (sid, i) => JSON.stringify({ sessionId: sid, timestamp: `2026-07-01T10:00:0${i}.000Z`, type: 'user', message: { role: 'user', content: 'm' + i } });
  fs.writeFileSync(file, [mk('abc', 0), mk('other', 1), mk('abc', 2), mk('abc', 3)].join('\n') + '\n');

  const page = await getSessionMessagesFromFile(file, 'abc', 2, 0);
  assert.equal(page.total, 3);
  assert.deepEqual(page.messages.map(m => m.message.content), ['m2', 'm3']); // last 2
  assert.equal(page.hasMore, true);

  const none = await getSessionMessagesFromFile(file, 'missing', 2, 0);
  assert.equal(none.total, 0);
});

test('missing file returns empty result, not an error', async () => {
  const res = await getSessionMessagesFromFile(path.join(os.tmpdir(), 'no-such-dir-xyz', 'nope.jsonl'), 'abc', 2, 0);
  assert.deepEqual(res, { messages: [], total: 0, hasMore: false });
});

test('limit null returns all matching messages', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'x.jsonl');
  const mk = (i) => JSON.stringify({ sessionId: 'x', timestamp: `2026-07-01T10:00:0${i}.000Z`, type: 'user', message: { role: 'user', content: 'm' + i } });
  fs.writeFileSync(file, [mk(0), mk(1), mk(2)].join('\n') + '\n');
  const res = await getSessionMessagesFromFile(file, 'x', null, 0);
  assert.equal(res.total, 3);
  assert.equal(res.messages.length, 3);
  assert.equal(res.hasMore, false);
});
