// server/services/sessionsRepair.js
// Startup repair: heals sessions_meta <-> disk drift. Fast path only —
// filename-derived ids; legacy multi-session files are handled by admin backfill.
// Insert-only: repair adds rows for owned sessions discovered on disk. It never
// deletes anything — DB rows for vanished files stay (decision 2026-07-03).
import path from 'path';
import os from 'os';
import { parseJsonlSessions } from '../projects.js';
import { listSessionFiles, uiMessageCountsBySession, titleFromSummary } from './sessionsLiveness.js';

export async function repairSessionsMeta({
  sessionsMetaDb, ownedSessionIds,
  projectsRoot = path.join(os.homedir(), '.claude', 'projects'),
}) {
  console.log('[REPAIR] sessions_meta scan started');
  const stats = { inserted: 0 };
  const knownIds = sessionsMetaDb.allSessionIds('claude');

  for (const { project, fileName, filePath } of await listSessionFiles(projectsRoot)) {
    const sessionId = fileName.replace(/\.jsonl$/, '');
    if (!ownedSessionIds.has(sessionId)) continue;   // orphans stay invisible (accepted)
    if (knownIds.has(sessionId)) continue;           // already known — no parsing
    const parsed = await parseJsonlSessions(filePath);
    const s = parsed.sessions.find(x => x.id === sessionId);
    if (!s) continue;                                // legacy naming — backfill's job
    // UI-visible count — one pass over all entries (O(n) not O(n×m))
    const uiCounts = uiMessageCountsBySession(parsed.entries);
    sessionsMetaDb.upsertCreated({
      sessionId, project, filePath, cwd: s.cwd || null,
      title: titleFromSummary(s.summary),
      messageCount: uiCounts.get(sessionId) || 0,
      now: new Date(s.lastActivity).toISOString(),
    });
    stats.inserted++;
  }

  return stats;
}
