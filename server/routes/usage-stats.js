import express from 'express';
import { usageDb } from '../database/db.js';

const router = express.Router();

function getDefaultDateRange() {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

/**
 * GET /api/usage-stats/sessions
 * Returns paginated sessions list with aggregated token usage.
 */
router.get('/sessions', (req, res) => {
  try {
    const {
      from,
      to,
      model,
      sortBy = 'total_tokens',
      sortDir = 'desc',
      limit = '10',
      offset = '0',
    } = req.query;

    const defaults = getDefaultDateRange();

    const result = usageDb.getSessionsSummary({
      from: from || defaults.from,
      to: to || defaults.to,
      model: model || null,
      sortBy,
      sortDir,
      limit: Math.min(parseInt(limit, 10) || 10, 50),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching usage sessions:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage sessions' });
  }
});

/**
 * GET /api/usage-stats/summary
 * Returns aggregate totals for the header (tokens, cost, session count).
 */
router.get('/summary', (req, res) => {
  try {
    const { from, to, model } = req.query;

    const defaults = getDefaultDateRange();

    const totals = usageDb.getTotals({
      from: from || defaults.from,
      to: to || defaults.to,
      model: model || null,
    });

    res.json(totals);
  } catch (error) {
    console.error('Error fetching usage summary:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage summary' });
  }
});

/**
 * GET /api/usage-stats/sessions/:sessionId
 * Returns per-turn breakdown for a single session.
 */
router.get('/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const { limit = '10', offset = '0' } = req.query;

    const result = usageDb.getSessionTurns(sessionId, {
      limit: Math.min(parseInt(limit, 10) || 10, 50),
      offset: parseInt(offset, 10) || 0,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching session turns:', error.message);
    res.status(500).json({ error: 'Failed to fetch session turns' });
  }
});

export default router;
