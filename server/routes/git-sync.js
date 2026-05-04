import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';

const router = express.Router();

const REPO_ROOT = process.env.REPO_ROOT || path.join(process.env.HOME || '/home/node', 'repos');
const LOG_FILE = path.join(REPO_ROOT, 'sync.log');

// Regex patterns for log parsing
const LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (.+)$/;
const PULL_RE = /^PULL\s+(.+?) \((.+?)\) \.\.\.$/;
const CLONE_RE = /^CLONE (.+?) \((.+?)\) \.\.\.$/;
const REPO_ERROR_RE = /^ERROR ([^:]+): (.+)$/;
const GLOBAL_ERROR_RE = /^ERROR: (.+)$/;
const CYCLE_FINISHED_RE = /^--- Sync cycle finished: (\d+) OK, (\d+) FAILED \(of (\d+)\) ---$/;
const NEXT_SYNC_RE = /^Next sync in (\d+) seconds \.\.\.$/;

const EMPTY_STATUS = { lastCycle: null, nextSyncIn: null, nextSyncAt: null, repos: [] };

function parseSyncLog(content) {
  const lines = content.split('\n');
  const repoHistory = {};
  let currentCycle = null;
  let lastCycleResult = null;
  let nextSyncTimestamp = null;
  let nextSyncInterval = null;

  for (const line of lines) {
    const match = line.match(LINE_RE);
    if (!match) continue;

    const [, timestamp, message] = match;

    if (message === '--- Sync cycle started ---') {
      currentCycle = { attempts: {} };
      continue;
    }

    const pullMatch = message.match(PULL_RE) || message.match(CLONE_RE);
    if (pullMatch) {
      const [, name, branch] = pullMatch;
      if (currentCycle) {
        currentCycle.attempts[name] = { branch, timestamp, failed: false };
      }
      continue;
    }

    const repoErrorMatch = message.match(REPO_ERROR_RE);
    if (repoErrorMatch && !message.match(GLOBAL_ERROR_RE)) {
      const [, name, error] = repoErrorMatch;
      if (currentCycle && currentCycle.attempts[name]) {
        currentCycle.attempts[name].failed = true;
        currentCycle.attempts[name].error = error;
      }
      continue;
    }

    const cycleFinishedMatch = message.match(CYCLE_FINISHED_RE);
    if (cycleFinishedMatch) {
      const [, success, failed, total] = cycleFinishedMatch;
      lastCycleResult = {
        timestamp,
        success: parseInt(success, 10),
        failed: parseInt(failed, 10),
        total: parseInt(total, 10),
      };

      if (currentCycle) {
        for (const [name, attempt] of Object.entries(currentCycle.attempts)) {
          if (!repoHistory[name]) {
            repoHistory[name] = { branch: attempt.branch, lastSyncedAt: null, lastFailedAt: null, error: null };
          }
          repoHistory[name].branch = attempt.branch;

          if (attempt.failed) {
            repoHistory[name].lastFailedAt = attempt.timestamp;
            repoHistory[name].error = attempt.error;
          } else {
            repoHistory[name].lastSyncedAt = attempt.timestamp;
            repoHistory[name].lastFailedAt = null;
            repoHistory[name].error = null;
          }
        }
      }
      currentCycle = null;
      continue;
    }

    const nextSyncMatch = message.match(NEXT_SYNC_RE);
    if (nextSyncMatch) {
      nextSyncInterval = parseInt(nextSyncMatch[1], 10);
      nextSyncTimestamp = timestamp;
      continue;
    }
  }

  const repos = Object.entries(repoHistory).map(([name, info]) => {
    const hasRecentFailure = info.lastFailedAt !== null;
    const hasEverSynced = info.lastSyncedAt !== null;

    let status;
    if (hasRecentFailure) {
      status = 'failed';
    } else if (hasEverSynced) {
      status = 'ok';
    } else {
      status = 'failed';
    }

    const repo = { name, branch: info.branch, status, lastSyncedAt: info.lastSyncedAt };
    if (hasRecentFailure) {
      repo.lastFailedAt = info.lastFailedAt;
      repo.error = info.error;
    }
    return repo;
  });

  repos.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'failed' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  let nextSyncAt = null;
  if (nextSyncTimestamp && nextSyncInterval) {
    const base = new Date(nextSyncTimestamp.replace(' ', 'T'));
    nextSyncAt = new Date(base.getTime() + nextSyncInterval * 1000).toISOString();
  }

  return { lastCycle: lastCycleResult, nextSyncIn: nextSyncInterval, nextSyncAt, repos };
}

router.get('/status', async (req, res) => {
  try {
    const content = await fs.readFile(LOG_FILE, 'utf-8');
    if (!content.trim()) {
      return res.json(EMPTY_STATUS);
    }
    res.json(parseSyncLog(content));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json(EMPTY_STATUS);
    }
    console.error('Failed to read sync log:', err);
    res.status(500).json({ error: 'Failed to read sync log' });
  }
});

export default router;
