// server/services/sessionsBackfill.js
// Full backfill/rebuild: parses ALL non-agent JSONL, upserts owned sessions.
// Upsert-only: rows whose files vanished are kept, never reconciled away
// (decision 2026-07-03 — DB rows are removed only by explicit UI soft-deletes).
import path from 'path';
import os from 'os';
import { parseJsonlSessions } from '../projects.js';
import { listSessionFiles, uiMessageCountsBySession, titleFromSummary } from './sessionsLiveness.js';

export async function backfillSessionsMeta({ sessionsMetaDb, ownedSessionIds, projectsRoot = path.join(os.homedir(), '.claude', 'projects') }) {
  const stats = { scannedFiles: 0, upserted: 0, skippedOrphans: 0 };
  console.log('[BACKFILL] sessions_meta full scan started');

  for (const { project, filePath } of await listSessionFiles(projectsRoot)) {
    stats.scannedFiles++;
    const parsed = await parseJsonlSessions(filePath);
    // build counts once per file — O(n) not O(n×m)
    const uiCounts = uiMessageCountsBySession(parsed.entries);
    for (const s of parsed.sessions) {
      if (!ownedSessionIds.has(s.id)) { stats.skippedOrphans++; continue; }
      sessionsMetaDb.upsertFromFile({
        sessionId: s.id, project, filePath, cwd: s.cwd || null,
        title: titleFromSummary(s.summary),
        messageCount: uiCounts.get(s.id) || 0,
        lastActivity: new Date(s.lastActivity).toISOString(),
      });
      stats.upserted++;
    }
  }

  console.log(`[BACKFILL] done: ${JSON.stringify(stats)}`);
  return stats;
}
