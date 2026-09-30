import express from 'express';
import { modelsCache } from '../lib/modelsCache.js';
import { ensureModelsCached } from '../claude-sdk.js';
import { CLAUDE_MODELS, toModelOptions } from '../../shared/modelConstants.js';

const router = express.Router();

router.get('/claude', async (req, res) => {
  let live = modelsCache.get();

  if (!live) {
    try {
      live = await ensureModelsCached();
    } catch {
      live = null;
    }
  }

  if (live?.length) {
    const extras = CLAUDE_MODELS.OPTIONS.filter(
      (o) => o.alwaysOffer && !live.some((m) => m.value === o.value),
    );
    return res.json({ source: 'sdk', models: toModelOptions([...live, ...extras]) });
  }

  res.json({ source: 'fallback', models: toModelOptions(CLAUDE_MODELS.OPTIONS) });
});

export default router;
