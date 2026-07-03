// server/database/sessionsMeta.js
// Write-through session metadata (see docs/superpowers/specs/2026-07-02-sessions-meta-write-through-design.md)
import path from 'path';
import os from 'os';

export const SESSIONS_META_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions_meta (
  session_id    TEXT NOT NULL,
  provider      TEXT NOT NULL DEFAULT 'claude',
  project       TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  cwd           TEXT,
  title         TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  superseded_by TEXT NULL,
  deleted_at    TEXT NULL,
  PRIMARY KEY (session_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_sessions_meta_project_activity
  ON sessions_meta(project, last_activity DESC, session_id);
`;

// Must be exec'd AFTER the session_ownership table exists (created by db.js migrations).
export const SESSION_OWNERSHIP_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_session_ownership_user_session
  ON session_ownership(user_id, provider, session_id);
`;

// Idempotent column migration for DBs created before the soft-delete decision
// (2026-07-03). CREATE TABLE IF NOT EXISTS won't add columns to existing tables.
export function migrateSessionsMetaSoftDelete(db) {
  const cols = db.prepare('PRAGMA table_info(sessions_meta)').all().map(c => c.name);
  if (!cols.includes('deleted_at')) {
    db.exec('ALTER TABLE sessions_meta ADD COLUMN deleted_at TEXT NULL');
  }
}

// Matches Claude CLI encoding: every non-alphanumeric char becomes '-'
// (verified: /tmp -> -tmp, C:\Projects\claudecodeui -> C--Projects-claudecodeui)
export function encodeProjectName(cwd) {
  return String(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

export function sessionFilePath(cwd, sessionId) {
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectName(cwd), `${sessionId}.jsonl`);
}

export function createSessionsMetaDb(db) {
  const nowIso = () => new Date().toISOString();

  const INSERT_COLUMNS_SQL = `
    (session_id, provider, project, file_path, cwd, title, message_count, created_at, last_activity, updated_at)
    VALUES (@sessionId, @provider, @project, @filePath, @cwd, @title, @messageCount, @createdAt, @lastActivity, @lastActivity)`;
  const insertStmt = db.prepare(`INSERT OR IGNORE INTO sessions_meta ${INSERT_COLUMNS_SQL}`);
  const upsertFileStmt = db.prepare(`
    INSERT INTO sessions_meta ${INSERT_COLUMNS_SQL}
    ON CONFLICT(session_id, provider) DO UPDATE SET
      project = excluded.project, file_path = excluded.file_path,
      cwd = COALESCE(excluded.cwd, sessions_meta.cwd),
      title = COALESCE(excluded.title, sessions_meta.title),
      message_count = excluded.message_count,
      last_activity = excluded.last_activity, updated_at = excluded.updated_at`);
  const recordActivityStmt = db.prepare(`
    UPDATE sessions_meta SET last_activity = @now, updated_at = @now, message_count = message_count + @n
    WHERE session_id = @sessionId AND provider = @provider RETURNING *`);
  const supersedeStmt = db.prepare(
    'UPDATE sessions_meta SET superseded_by = ?, updated_at = ? WHERE session_id = ? AND provider = ?');
  const getStmt = db.prepare('SELECT * FROM sessions_meta WHERE session_id = ? AND provider = ?');
  const firstPageStmt = db.prepare(`
    SELECT sm.* FROM sessions_meta sm
    JOIN session_ownership so ON so.session_id = sm.session_id AND so.provider = sm.provider
    WHERE so.user_id = @userId AND sm.project = @project AND sm.provider = @provider
      AND sm.superseded_by IS NULL AND sm.deleted_at IS NULL
    ORDER BY sm.last_activity DESC, sm.session_id DESC
    LIMIT @limitPlusOne`);
  const nextPageStmt = db.prepare(`
    SELECT sm.* FROM sessions_meta sm
    JOIN session_ownership so ON so.session_id = sm.session_id AND so.provider = sm.provider
    WHERE so.user_id = @userId AND sm.project = @project AND sm.provider = @provider
      AND sm.superseded_by IS NULL AND sm.deleted_at IS NULL
      AND (sm.last_activity, sm.session_id) < (@cursorLast, @cursorId)
    ORDER BY sm.last_activity DESC, sm.session_id DESC
    LIMIT @limitPlusOne`);
  const countsStmt = db.prepare(`
    SELECT sm.project AS project, COUNT(*) AS n, MAX(sm.last_activity) AS last_activity FROM sessions_meta sm
    JOIN session_ownership so ON so.session_id = sm.session_id AND so.provider = sm.provider
    WHERE so.user_id = ? AND sm.provider = ? AND sm.superseded_by IS NULL AND sm.deleted_at IS NULL
    GROUP BY sm.project`);
  // Bare column + MAX() is defined in SQLite: cwd comes from the max-last_activity row.
  const latestCwdStmt = db.prepare(`
    SELECT project, cwd, MAX(last_activity) FROM sessions_meta
    WHERE cwd IS NOT NULL GROUP BY project`);
  const latestCwdForProjectStmt = db.prepare(
    'SELECT cwd FROM sessions_meta WHERE project = ? AND cwd IS NOT NULL ORDER BY last_activity DESC, session_id DESC LIMIT 1');
  const allIdsStmt = db.prepare('SELECT session_id FROM sessions_meta WHERE provider = ?');
  // Soft delete only (decision 2026-07-03): nothing is ever DELETEd from the DB —
  // rows plus their ownership/name records stay forever for statistics.
  const softDeleteStmt = db.prepare(
    'UPDATE sessions_meta SET deleted_at = ?, updated_at = ? WHERE session_id = ? AND provider = ? AND deleted_at IS NULL');
  const softDeleteProjectStmt = db.prepare(
    'UPDATE sessions_meta SET deleted_at = ?, updated_at = ? WHERE project = ? AND deleted_at IS NULL');

  return {
    upsertCreated({ sessionId, provider = 'claude', project, filePath, cwd = null, title = null, messageCount = 0, now = nowIso() }) {
      return insertStmt.run({ sessionId, provider, project, filePath, cwd, title, messageCount, createdAt: now, lastActivity: now });
    },
    // true upsert for backfill/rebuild — refreshes stale rows (upsertCreated's OR IGNORE skips them)
    upsertFromFile({ sessionId, provider = 'claude', project, filePath, cwd = null, title = null, messageCount = 0, lastActivity, createdAt = lastActivity }) {
      return upsertFileStmt.run({ sessionId, provider, project, filePath, cwd, title, messageCount, createdAt, lastActivity });
    },
    // One statement per chat turn: bump activity + count and return the fresh row
    // (undefined when the session has no row yet — caller self-heals and retries).
    recordActivity(sessionId, provider = 'claude', n = 1, now = nowIso()) {
      return recordActivityStmt.get({ sessionId, provider, n, now });
    },
    supersede(oldId, newId, provider = 'claude', now = nowIso()) { supersedeStmt.run(newId, now, oldId, provider); },
    getById(sessionId, provider = 'claude') { return getStmt.get(sessionId, provider); },
    countsByProjectForUser(userId, provider = 'claude') {
      return new Map(countsStmt.all(userId, provider).map(r => [r.project, { total: r.n, lastActivity: r.last_activity }]));
    },
    latestCwdByProject() {
      return new Map(latestCwdStmt.all().map(r => [r.project, r.cwd]));
    },
    latestCwdForProject(project) { return latestCwdForProjectStmt.get(project)?.cwd ?? null; },
    listPage({ userId, project, provider = 'claude', limit = 20, cursor = null }) {
      const params = { userId, project, provider, limitPlusOne: limit + 1 };
      const rows = cursor
        ? nextPageStmt.all({ ...params, cursorLast: cursor.lastActivity, cursorId: cursor.sessionId })
        : firstPageStmt.all(params);
      const hasMore = rows.length > limit;
      const sessions = hasMore ? rows.slice(0, limit) : rows;
      const last = sessions[sessions.length - 1];
      return {
        sessions,
        hasMore,
        nextCursor: hasMore && last ? { lastActivity: last.last_activity, sessionId: last.session_id } : null,
      };
    },
    allSessionIds(provider = 'claude') { return new Set(allIdsStmt.all(provider).map(r => r.session_id)); },
    softDelete(sessionId, provider = 'claude', now = nowIso()) { softDeleteStmt.run(now, now, sessionId, provider); },
    softDeleteProject(project, now = nowIso()) { softDeleteProjectStmt.run(now, now, project); },
  };
}
