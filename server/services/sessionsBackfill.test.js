// server/services/sessionsBackfill.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SESSIONS_META_SCHEMA, SESSION_OWNERSHIP_INDEX_SQL, createSessionsMetaDb } from '../database/sessionsMeta.js';
import { backfillSessionsMeta } from './sessionsBackfill.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE session_ownership (session_id TEXT, provider TEXT DEFAULT 'claude', user_id INTEGER, UNIQUE(session_id, provider));
           CREATE TABLE session_names (id INTEGER PRIMARY KEY, session_id TEXT, provider TEXT DEFAULT 'claude', custom_name TEXT, UNIQUE(session_id, provider));`);
  db.exec(SESSION_OWNERSHIP_INDEX_SQL);
  db.exec(SESSIONS_META_SCHEMA);
  return { db, meta: createSessionsMetaDb(db) };
}
const entry = (sid, role, text, ts = '2026-07-01T10:00:00.000Z') =>
  JSON.stringify({ sessionId: sid, cwd: '/x', timestamp: ts, type: role, message: { role, content: text } }) + '\n';

test('backfill: upserts owned (refreshing stale rows), skips orphans, KEEPS rows without files', async (t) => {
  const { meta } = makeDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'proj-a');
  fs.mkdirSync(proj);

  // owned session on disk + STALE row in db (wrong title/path) -> must be refreshed
  fs.writeFileSync(path.join(proj, 'owned.jsonl'), entry('owned', 'user', 'real question') + entry('owned', 'assistant', 'answer'));
  meta.upsertCreated({ sessionId: 'owned', project: 'proj-a', filePath: '/stale/path.jsonl', title: 'stale', now: '2026-06-01T00:00:00.000Z' });
  // orphan on disk -> skipped
  fs.writeFileSync(path.join(proj, 'orphan.jsonl'), entry('orphan', 'user', 'x'));
  // row whose file no longer exists anywhere -> KEPT (no reconcile, decision 2026-07-03)
  meta.upsertCreated({ sessionId: 'fileless', project: 'proj-a', filePath: path.join(proj, 'fileless.jsonl'), now: '2026-06-01T00:00:00.000Z' });

  const stats = await backfillSessionsMeta({ sessionsMetaDb: meta, ownedSessionIds: new Set(['owned']), projectsRoot: root });

  const owned = meta.getById('owned');
  assert.equal(owned.file_path, path.join(proj, 'owned.jsonl')); // refreshed
  assert.notEqual(owned.title, 'stale');                          // refreshed
  assert.equal(owned.message_count, 2);                           // UI-visible count
  assert.equal(meta.getById('orphan'), undefined);
  assert.notEqual(meta.getById('fileless'), undefined);           // KEPT
  assert.equal(stats.upserted, 1);
  assert.equal(stats.skippedOrphans, 1);
});

test('backfill is idempotent: second run changes nothing', async (t) => {
  const { meta } = makeDb();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'p');
  fs.mkdirSync(proj);
  fs.writeFileSync(path.join(proj, 'a.jsonl'), entry('a', 'user', 'q'));
  const owned = new Set(['a']);
  await backfillSessionsMeta({ sessionsMetaDb: meta, ownedSessionIds: owned, projectsRoot: root });
  const before = meta.getById('a');
  const stats2 = await backfillSessionsMeta({ sessionsMetaDb: meta, ownedSessionIds: owned, projectsRoot: root });
  const after = meta.getById('a');
  assert.deepEqual(after, { ...before, updated_at: after.updated_at }); // only updated_at may move
  assert.equal(stats2.upserted, 1); // same row re-upserted, nothing else
});
