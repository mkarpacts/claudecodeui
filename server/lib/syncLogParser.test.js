import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSyncLog, EMPTY_STATUS } from './syncLogParser.js';

const FINISHED_CYCLE_LOG = `[2026-07-21 10:00:00] --- Sync cycle started ---
[2026-07-21 10:00:00] Fetching repository list from TFS API...
[2026-07-21 10:00:01] PULL  RepoA (master) ...
[2026-07-21 10:00:02] PULL  RepoB (master) ...
[2026-07-21 10:00:03] ERROR RepoB: pull failed: connection reset
[2026-07-21 10:00:04] --- Sync cycle finished: 1 OK, 1 FAILED (of 2) ---
[2026-07-21 10:00:04] Next sync in 3600 seconds ...
`;

test('parses a finished cycle: lastCycle, repo statuses, nextSyncAt', () => {
  const result = parseSyncLog(FINISHED_CYCLE_LOG);
  assert.deepEqual(result.lastCycle, {
    timestamp: '2026-07-21 10:00:04',
    success: 1,
    failed: 1,
    total: 2,
  });
  assert.equal(result.nextSyncIn, 3600);
  assert.equal(result.repos.length, 2);
  const repoA = result.repos.find((r) => r.name === 'RepoA');
  const repoB = result.repos.find((r) => r.name === 'RepoB');
  assert.equal(repoA.status, 'ok');
  assert.equal(repoA.lastSyncedAt, '2026-07-21 10:00:01');
  assert.equal(repoB.status, 'failed');
  assert.equal(repoB.error, 'pull failed: connection reset');
  // failed repos sort first
  assert.equal(result.repos[0].name, 'RepoB');
});

test('empty log content yields EMPTY_STATUS shape', () => {
  const result = parseSyncLog('');
  assert.deepEqual(result.lastCycle, EMPTY_STATUS.lastCycle);
  assert.deepEqual(result.repos, []);
});

test('running=false after a finished cycle', () => {
  assert.equal(parseSyncLog(FINISHED_CYCLE_LOG).running, false);
});

test('running=true when log ends mid-cycle', () => {
  const midCycle = FINISHED_CYCLE_LOG + `[2026-07-21 11:00:00] --- Sync cycle started ---
[2026-07-21 11:00:01] PULL  RepoA (master) ...
`;
  assert.equal(parseSyncLog(midCycle).running, true);
});

test('EMPTY_STATUS has running=false', () => {
  assert.equal(EMPTY_STATUS.running, false);
});
