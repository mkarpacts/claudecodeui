import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseJsonlSessions, probeProjectCwd } from './projects.js';

// Regression: real CLI transcripts can start with queue-operation entries that carry
// a sessionId but NO cwd — the session's cwd must still be picked up from a later entry.
test('parseJsonlSessions: cwd picked from a later entry when first entry lacks it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwd-'));
  const file = path.join(dir, 's1.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-07-02T15:40:53.547Z', sessionId: 's1' }),
    JSON.stringify({ type: 'queue-operation', operation: 'dequeue', timestamp: '2026-07-02T15:40:53.548Z', sessionId: 's1' }),
    JSON.stringify({ sessionId: 's1', cwd: '/home/node/repos/CTS.Adaptation/CTS.Adaptation', type: 'user', timestamp: '2026-07-02T15:40:53.564Z', message: { role: 'user', content: 'hi' } }),
  ].join('\n') + '\n');

  const parsed = await parseJsonlSessions(file);
  const s = parsed.sessions.find(x => x.id === 's1');
  assert.equal(s.cwd, '/home/node/repos/CTS.Adaptation/CTS.Adaptation');
  fs.rmSync(dir, { recursive: true, force: true });
});

// Fallback for projects with no cwd in sessions_meta (e.g. orphan-only projects):
// probe the newest JSONL file for the first cwd entry instead of lossy name decoding.
test('probeProjectCwd: reads cwd from newest non-agent JSONL, null when absent', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const proj = path.join(root, '-home-node-repos-CTS-Adaptation-CTS-Adaptation');
  fs.mkdirSync(proj);

  fs.writeFileSync(path.join(proj, 'old.jsonl'),
    JSON.stringify({ sessionId: 'old', cwd: '/stale/path', type: 'user', timestamp: '2026-07-01T10:00:00.000Z' }) + '\n');
  fs.writeFileSync(path.join(proj, 'agent-x.jsonl'),
    JSON.stringify({ sessionId: 'agent', cwd: '/agent/path', type: 'user' }) + '\n');
  fs.writeFileSync(path.join(proj, 'newest.jsonl'), [
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: 'n1' }),
    JSON.stringify({ sessionId: 'n1', cwd: '/home/node/repos/CTS.Adaptation/CTS.Adaptation', type: 'user' }),
  ].join('\n') + '\n');
  const now = new Date();
  fs.utimesSync(path.join(proj, 'old.jsonl'), now, new Date(now.getTime() - 60_000));
  fs.utimesSync(path.join(proj, 'newest.jsonl'), now, now);

  const cwd = await probeProjectCwd('-home-node-repos-CTS-Adaptation-CTS-Adaptation', { projectsRoot: root });
  assert.equal(cwd, '/home/node/repos/CTS.Adaptation/CTS.Adaptation');

  const empty = path.join(root, 'no-cwd-project');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, 'a.jsonl'),
    JSON.stringify({ type: 'queue-operation', sessionId: 'a' }) + '\n');
  assert.equal(await probeProjectCwd('no-cwd-project', { projectsRoot: root }), null);

  assert.equal(await probeProjectCwd('missing-project', { projectsRoot: root }), null);
  fs.rmSync(root, { recursive: true, force: true });
});
