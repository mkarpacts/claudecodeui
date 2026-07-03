// server/database/sessionsMeta.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SESSIONS_META_SCHEMA, SESSION_OWNERSHIP_INDEX_SQL, createSessionsMetaDb, encodeProjectName, migrateSessionsMetaSoftDelete } from './sessionsMeta.js';

function makeDb() {
  const db = new Database(':memory:');
  // minimal preexisting tables the module depends on
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE session_ownership (
      session_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'claude',
      user_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, provider));
    CREATE TABLE session_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'claude', custom_name TEXT NOT NULL,
      UNIQUE(session_id, provider));
  `);
  db.exec(SESSION_OWNERSHIP_INDEX_SQL);
  db.exec(SESSIONS_META_SCHEMA);
  return db;
}

let db, meta;
beforeEach(() => { db = makeDb(); meta = createSessionsMetaDb(db); });

const row = (id, act) => ({
  sessionId: id, project: 'C--Projects-x', filePath: `/home/node/.claude/projects/C--Projects-x/${id}.jsonl`,
  cwd: 'C:/Projects/x', title: 't-' + id, now: act,
});
const own = (id, userId) => db.prepare(
  'INSERT INTO session_ownership (session_id, provider, user_id) VALUES (?, ?, ?)').run(id, 'claude', userId);

test('encodeProjectName matches Claude CLI encoding', () => {
  assert.equal(encodeProjectName('/tmp'), '-tmp');
  assert.equal(encodeProjectName('C:\\Projects\\claudecodeui'), 'C--Projects-claudecodeui');
});

test('upsertCreated is idempotent; recordActivity bumps activity+count and returns the row', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z'));
  meta.upsertCreated(row('a', '2026-07-01T11:00:00.000Z')); // ignored
  const r = meta.getById('a');
  assert.equal(r.last_activity, '2026-07-01T10:00:00.000Z');
  const updated = meta.recordActivity('a', 'claude', 2, '2026-07-01T12:00:00.000Z');
  assert.equal(updated.last_activity, '2026-07-01T12:00:00.000Z');
  assert.equal(updated.message_count, 2);
  assert.equal(meta.recordActivity('missing', 'claude', 2), undefined); // no row -> caller self-heals
});

test('upsertFromFile refreshes stale rows (true upsert for backfill/rebuild)', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z'));
  meta.upsertFromFile({
    sessionId: 'a', project: 'C--Projects-x', filePath: '/new/path/a.jsonl',
    cwd: null, title: 'fresh title', messageCount: 7, lastActivity: '2026-07-02T10:00:00.000Z',
  });
  const r = meta.getById('a');
  assert.equal(r.file_path, '/new/path/a.jsonl');
  assert.equal(r.title, 'fresh title');
  assert.equal(r.message_count, 7);
  assert.equal(r.last_activity, '2026-07-02T10:00:00.000Z');
  assert.equal(r.cwd, 'C:/Projects/x'); // COALESCE keeps existing cwd when null passed
});

test('listPage: ownership scoping + keyset pagination, newest first', () => {
  for (const [id, act] of [['a', '2026-07-01T10:00:00.000Z'], ['b', '2026-07-01T11:00:00.000Z'], ['c', '2026-07-01T12:00:00.000Z']]) {
    meta.upsertCreated(row(id, act)); own(id, 1);
  }
  meta.upsertCreated(row('theirs', '2026-07-01T13:00:00.000Z')); own('theirs', 2);

  const p1 = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 2 });
  assert.deepEqual(p1.sessions.map(s => s.session_id), ['c', 'b']);
  assert.equal(p1.hasMore, true);
  const p2 = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 2, cursor: p1.nextCursor });
  assert.deepEqual(p2.sessions.map(s => s.session_id), ['a']);
  assert.equal(p2.hasMore, false);

  // cursor past the end returns an empty page
  const p3 = meta.listPage({
    userId: 1, project: 'C--Projects-x', limit: 2,
    cursor: { lastActivity: '2026-07-01T10:00:00.000Z', sessionId: 'a' },
  });
  assert.deepEqual(p3, { sessions: [], hasMore: false, nextCursor: null });
});

test('listPage: identical last_activity paginates across boundary without dupes/skips (session_id DESC tiebreak)', () => {
  const SAME = '2026-07-01T10:00:00.000Z';
  for (const id of ['a', 'b', 'c']) { meta.upsertCreated(row(id, SAME)); own(id, 1); }
  const p1 = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 2 });
  assert.deepEqual(p1.sessions.map(s => s.session_id), ['c', 'b']);
  assert.equal(p1.hasMore, true);
  const p2 = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 2, cursor: p1.nextCursor });
  assert.deepEqual(p2.sessions.map(s => s.session_id), ['a']);
  assert.equal(p2.hasMore, false);
});

test('superseded rows are hidden from listPage', () => {
  meta.upsertCreated(row('old', '2026-07-01T10:00:00.000Z')); own('old', 1);
  meta.upsertCreated(row('new', '2026-07-01T11:00:00.000Z')); own('new', 1);
  meta.supersede('old', 'new');
  const p = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 10 });
  assert.deepEqual(p.sessions.map(s => s.session_id), ['new']);
});

test('countsByProjectForUser counts only own non-superseded and reports max lastActivity', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z')); own('a', 1);
  meta.upsertCreated(row('a2', '2026-07-01T09:00:00.000Z')); own('a2', 1);
  meta.upsertCreated(row('b', '2026-07-01T11:00:00.000Z')); own('b', 2);
  const m = meta.countsByProjectForUser(1);
  assert.equal(m.get('C--Projects-x').total, 2);
  assert.equal(m.get('C--Projects-x').lastActivity, '2026-07-01T10:00:00.000Z');
});

// Soft delete (decision 2026-07-03): the row and its ownership/name records stay
// forever for statistics — the session merely disappears from lists and counts.
test('softDelete hides the session from listPage and counts but keeps all DB records', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z')); own('a', 1);
  db.prepare("INSERT INTO session_names (session_id, provider, custom_name) VALUES ('a','claude','X')").run();
  meta.softDelete('a');
  const r = meta.getById('a');
  assert.notEqual(r, undefined);                 // row kept for statistics
  assert.notEqual(r.deleted_at, null);           // marked deleted
  const p = meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 10 });
  assert.deepEqual(p.sessions, []);              // hidden from lists
  assert.equal(meta.countsByProjectForUser(1).get('C--Projects-x'), undefined); // hidden from counts
  assert.equal(db.prepare("SELECT COUNT(*) n FROM session_ownership WHERE session_id='a'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM session_names WHERE session_id='a'").get().n, 1);
});

test('migrateSessionsMetaSoftDelete adds deleted_at to pre-existing tables, idempotent', () => {
  const old = new Database(':memory:');
  // table shape as deployed BEFORE the soft-delete decision (no deleted_at)
  old.exec(`CREATE TABLE sessions_meta (
    session_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'claude',
    project TEXT NOT NULL, file_path TEXT NOT NULL, cwd TEXT, title TEXT,
    message_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    last_activity TEXT NOT NULL, updated_at TEXT NOT NULL, superseded_by TEXT NULL,
    PRIMARY KEY (session_id, provider));
    CREATE TABLE session_ownership (session_id TEXT, provider TEXT DEFAULT 'claude', user_id INTEGER, UNIQUE(session_id, provider));
    CREATE TABLE session_names (id INTEGER PRIMARY KEY, session_id TEXT, provider TEXT DEFAULT 'claude', custom_name TEXT, UNIQUE(session_id, provider));`);
  migrateSessionsMetaSoftDelete(old);
  migrateSessionsMetaSoftDelete(old); // idempotent
  const migrated = createSessionsMetaDb(old); // prepared statements referencing deleted_at must not throw
  migrated.upsertCreated({ sessionId: 'a', project: 'p', filePath: '/x/a.jsonl', now: '2026-07-01T10:00:00.000Z' });
  migrated.softDelete('a');
  assert.notEqual(migrated.getById('a').deleted_at, null);
});

test('softDeleteProject hides all project sessions, leaves other projects intact', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z')); own('a', 1);
  meta.upsertCreated({ ...row('z', '2026-07-01T10:00:00.000Z'), project: 'other' }); own('z', 1);
  meta.softDeleteProject('C--Projects-x');
  assert.notEqual(meta.getById('a')?.deleted_at, null);   // marked, not removed
  assert.equal(meta.getById('z').deleted_at, null);       // untouched
  assert.deepEqual(meta.listPage({ userId: 1, project: 'C--Projects-x', limit: 10 }).sessions, []);
  assert.equal(meta.listPage({ userId: 1, project: 'other', limit: 10 }).sessions.length, 1);
});

test('latestCwdByProject returns most recent cwd per project', () => {
  meta.upsertCreated({ ...row('a', '2026-07-01T10:00:00.000Z'), cwd: '/old' });
  meta.upsertCreated({ ...row('b', '2026-07-01T12:00:00.000Z'), cwd: '/new' });
  assert.equal(meta.latestCwdByProject().get('C--Projects-x'), '/new');
});

test('latestCwdForProject returns newest cwd for project; null for unknown project', () => {
  meta.upsertCreated({ ...row('a', '2026-07-01T10:00:00.000Z'), cwd: '/older' });
  meta.upsertCreated({ ...row('b', '2026-07-01T12:00:00.000Z'), cwd: '/newer' });
  assert.equal(meta.latestCwdForProject('C--Projects-x'), '/newer');
  assert.equal(meta.latestCwdForProject('no-such-project'), null);
});

test('allSessionIds returns the set of known session ids for a provider', () => {
  meta.upsertCreated(row('a', '2026-07-01T10:00:00.000Z'));
  meta.upsertCreated(row('b', '2026-07-01T11:00:00.000Z'));
  assert.deepEqual([...meta.allSessionIds()].sort(), ['a', 'b']);
});
