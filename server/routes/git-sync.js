import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { parseSyncLog, EMPTY_STATUS } from '../lib/syncLogParser.js';
import { triggerGitSync } from '../lib/gitSyncTrigger.js';

const router = express.Router();

const REPO_ROOT = process.env.REPO_ROOT || path.join(process.env.HOME || '/home/node', 'repos');
const LOG_FILE = path.join(REPO_ROOT, 'sync.log');
const GIT_SYNC_HOST = process.env.GIT_SYNC_HOST || 'cts-git-sync';
const GIT_SYNC_TRIGGER_PORT = parseInt(process.env.GIT_SYNC_TRIGGER_PORT || '9000', 10);

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

router.post('/trigger', async (req, res) => {
  try {
    const result = await triggerGitSync({ host: GIT_SYNC_HOST, port: GIT_SYNC_TRIGGER_PORT });
    if (result.ok) {
      return res.status(202).json({ triggered: true });
    }
    if (result.reason === 'refused') {
      // Nothing listens while a cycle runs — a sync is already in progress.
      return res.status(409).json({ error: 'sync_in_progress' });
    }
    console.error('Git-sync trigger failed:', result.reason, result.code);
    return res.status(503).json({ error: 'sync_unavailable' });
  } catch (err) {
    console.error('Git-sync trigger failed:', err);
    return res.status(503).json({ error: 'sync_unavailable' });
  }
});

export default router;
