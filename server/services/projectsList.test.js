import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listProjectsLight } from './projectsList.js';

const fakeMeta = ({ counts = new Map(), cwds = new Map() } = {}) => ({
  countsByProjectForUser: () => counts,
  latestCwdByProject: () => cwds,
});

// Regression: addProjectManually encodes paths differently than Claude CLI (dots survive),
// so a manual config entry can be a twin of an existing project directory. The old
// getProjects deduped these by resolved path (projects.js:482) — the light lister must too.
test('manual config twin of an existing project dir is deduped by resolved path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plist-'));
  fs.mkdirSync(path.join(root, '-home-node-repos-X-Y'));

  const projects = await listProjectsLight({
    sessionsMetaDb: fakeMeta({
      counts: new Map([['-home-node-repos-X-Y', { total: 3, lastActivity: '2026-07-03T10:00:00.000Z' }]]),
      cwds: new Map([['-home-node-repos-X-Y', '/home/node/repos/X.Y']]),
    }),
    userId: 1,
    projectsRoot: root,
    config: {
      // twin of the dir above (different encoding, same real path) -> must be skipped
      '-home-node-repos-X.Y': { manuallyAdded: true, originalPath: '/home/node/repos/X.Y' },
      // standalone manual project (no dir) -> must be kept
      '-home-node-docs': { manuallyAdded: true, originalPath: '/home/node/docs' },
    },
  });

  const names = projects.map(p => p.name).sort();
  assert.deepEqual(names, ['-home-node-docs', '-home-node-repos-X-Y']);
  const dirProject = projects.find(p => p.name === '-home-node-repos-X-Y');
  assert.equal(dirProject.fullPath, '/home/node/repos/X.Y');
  assert.equal(dirProject.sessionMeta.total, 3);
  const manual = projects.find(p => p.name === '-home-node-docs');
  assert.equal(manual.fullPath, '/home/node/docs');
  assert.equal(manual.isManuallyAdded, true);
  fs.rmSync(root, { recursive: true, force: true });
});
