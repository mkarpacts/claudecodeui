// Shared helpers for deriving session metadata from parsed JSONL files.
// NOTE: there is deliberately NO "delete dead rows" helper here anymore —
// sessions_meta rows are never auto-deleted (decision 2026-07-03): a missing
// JSONL (CLI 30-day cleanup, unmounted volume, transient FS error) must never
// cascade into deleting session_ownership/session_names. Rows are removed only
// by explicit user actions (session/project delete in the UI), and even those
// are soft deletes.
import { promises as fs } from 'fs';
import path from 'path';

// Single definition of "what counts as a session transcript" (agent-*.jsonl
// files hold subagent tool history and are read on demand by exact name).
export function isSessionTranscript(fileName) {
  return fileName.endsWith('.jsonl') && !fileName.startsWith('agent-');
}

// Walk <projectsRoot>/<project>/<sessionId>.jsonl — shared by startup repair
// and admin backfill so the dir/file filtering rules live in one place.
// Returns [{ project, fileName, filePath }]; missing root/dirs yield [].
export async function listSessionFiles(projectsRoot) {
  let projectDirs = [];
  try {
    projectDirs = (await fs.readdir(projectsRoot, { withFileTypes: true })).filter(e => e.isDirectory());
  } catch (e) { if (e.code !== 'ENOENT') throw e; return []; }

  const result = [];
  for (const dirEnt of projectDirs) {
    const projectDir = path.join(projectsRoot, dirEnt.name);
    let files;
    try {
      files = (await fs.readdir(projectDir)).filter(isSessionTranscript);
    } catch (e) { if (e.code !== 'ENOENT') throw e; continue; } // dir deleted mid-scan
    for (const fileName of files) {
      result.push({ project: dirEnt.name, fileName, filePath: path.join(projectDir, fileName) });
    }
  }
  return result;
}

// Session title rule shared by the live write-through (claude-sdk.js) and the
// parse/backfill path — keep the two producers from drifting.
const TITLE_MAX_LENGTH = 50;
export function truncateTitle(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  return t.length > TITLE_MAX_LENGTH ? t.slice(0, TITLE_MAX_LENGTH) + '...' : t;
}

// UI-visible message counts (user/assistant messages only — same semantics as
// the live pipeline's best-effort badge) for every session in a parsed file, one pass.
export function uiMessageCountsBySession(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (e.sessionId && (e.message?.role === 'user' || e.message?.role === 'assistant')) {
      counts.set(e.sessionId, (counts.get(e.sessionId) || 0) + 1);
    }
  }
  return counts;
}

export function titleFromSummary(summary) {
  return summary === 'New Session' ? null : summary;
}
