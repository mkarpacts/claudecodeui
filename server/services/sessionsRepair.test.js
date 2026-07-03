// server/services/sessionsRepair.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SESSIONS_META_SCHEMA, SESSION_OWNERSHIP_INDEX_SQL, createSessionsMetaDb } from '../database/sessionsMeta.js';
import { repairSessionsMeta } from './sessionsRepair.js';

function makeMeta() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE session_ownership (session_id TEXT, provider TEXT DEFAULT 'claude', user_id INTEGER, UNIQUE(session_id, provider));
           CREATE TABLE session_names (id INTEGER PRIMARY KEY, session_id TEXT, provider TEXT DEFAULT 'claude', custom_name TEXT, UNIQUE(session_id, provider));`);
  db.exec(SESSION_OWNERSHIP_INDEX_SQL);
  db.exec(SESSIONS_META_SCHEMA);
  return { db, meta: createSessionsMetaDb(db) };
}

test('repair: inserts owned filename-derived sessions, KEEPS rows with missing files, skips orphans and agent files', async (t) => {
  const { meta } = makeMeta();
  const ownedIds = new Set(['owned-new']);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'proj-a');
  fs.mkdirSync(proj);
  const entry = (sid, role, text) => JSON.stringify({ sessionId: sid, cwd: '/x', timestamp: '2026-07-01T10:00:00.000Z', type: role, message: { role, content: text } }) + '\n';
  // owned-new: 2 UI-visible messages + 1 non-message entry
  fs.writeFileSync(path.join(proj, 'owned-new.jsonl'),
    entry('owned-new', 'user', 'hello world') +
    entry('owned-new', 'assistant', 'hi there') +
    JSON.stringify({ sessionId: 'owned-new', type: 'queue-operation', timestamp: '2026-07-01T10:00:01.000Z' }) + '\n');
  fs.writeFileSync(path.join(proj, 'orphan.jsonl'), entry('orphan', 'user', 'x'));       // no ownership -> skip
  fs.writeFileSync(path.join(proj, 'agent-x.jsonl'), entry('agent', 'user', 'x'));       // agent -> skip
  // row whose file is gone: MUST survive (no auto-deletion, decision 2026-07-03)
  meta.upsertCreated({ sessionId: 'fileless', project: 'proj-a', filePath: path.join(proj, 'gone.jsonl'), now: '2026-07-01T00:00:00.000Z' });

  const stats = await repairSessionsMeta({ sessionsMetaDb: meta, ownedSessionIds: ownedIds, projectsRoot: root });
  const row = meta.getById('owned-new');
  assert.equal(row?.project, 'proj-a');
  assert.equal(row?.message_count, 2); // UI-visible only (user+assistant), not the queue-operation entry
  assert.equal(meta.getById('orphan'), undefined);
  assert.equal(meta.getById('agent'), undefined);
  assert.notEqual(meta.getById('fileless'), undefined); // KEPT
  assert.equal(stats.inserted, 1);
});

test('repair: known rows with existing files are untouched (no parsing)', async (t) => {
  const { meta } = makeMeta();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'proj-b');
  fs.mkdirSync(proj);
  const fp = path.join(proj, 'known.jsonl');
  fs.writeFileSync(fp, JSON.stringify({ sessionId: 'known', type: 'user', timestamp: '2026-07-01T10:00:00.000Z', message: { role: 'user', content: 'x' } }) + '\n');
  meta.upsertCreated({ sessionId: 'known', project: 'proj-b', filePath: fp, title: 'original', now: '2026-07-01T09:00:00.000Z' });

  const stats = await repairSessionsMeta({ sessionsMetaDb: meta, ownedSessionIds: new Set(['known']), projectsRoot: root });
  assert.equal(meta.getById('known')?.title, 'original'); // untouched
  assert.equal(stats.inserted, 0);
});
