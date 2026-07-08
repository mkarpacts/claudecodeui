import express from 'express';
import { usageDb, permissionsDb } from '../database/db.js';
import { isAdmin } from '../middleware/auth.js';
import { buildSessionsSummaryCsv } from '../lib/usageCsv.js';

const router = express.Router();

function getDefaultDateRange() {
  const now = new Date();
  return {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}

// Every authenticated user may access usage stats; non-privileged users
// are restricted to their own sessions via resolveUserScope below.
router.use((req, res, next) => {
  req.canViewAllUsage = isAdmin(req.user) || permissionsDb.hasPermission(req.user.id, 'view_all_usage');
  next();
});

// Resolve the user_id the query must be scoped to:
// - regular user: always their own id
// - admin / view_all_usage: optional ?userId= filter, otherwise all users (null)
function resolveUserScope(req) {
  if (!req.canViewAllUsage) return req.user.id;
  const requested = parseInt(req.query.userId, 10);
  return Number.isNaN(requested) ? null : requested;
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
      userId: resolveUserScope(req),
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
      userId: resolveUserScope(req),
    });

    res.json(totals);
  } catch (error) {
    console.error('Error fetching usage summary:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage summary' });
  }
});

/**
 * GET /api/usage-stats/users
 * Users that have usage rows — feeds the user filter (privileged only).
 */
router.get('/users', (req, res) => {
  if (!req.canViewAllUsage) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    res.json(usageDb.getUsageUsers());
  } catch (error) {
    console.error('Error fetching usage users:', error.message);
    res.status(500).json({ error: 'Failed to fetch usage users' });
  }
});

/**
 * GET /api/usage-stats/sessions/export
 * Downloads the sessions summary (same filters as /sessions, no pagination) as CSV.
 * Must stay registered before /sessions/:sessionId.
 */
router.get('/sessions/export', (req, res) => {
  try {
    const { from, to, model, sortBy = 'total_tokens', sortDir = 'desc' } = req.query;
    const defaults = getDefaultDateRange();

    // LIMIT -1 = no limit in SQLite — export always covers all filtered sessions
    const { items } = usageDb.getSessionsSummary({
      from: from || defaults.from,
      to: to || defaults.to,
      model: model || null,
      userId: resolveUserScope(req),
      sortBy,
      sortDir,
      limit: -1,
      offset: 0,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="token-usage-sessions.csv"');
    res.send(buildSessionsSummaryCsv(items));
  } catch (error) {
    console.error('Error exporting usage sessions:', error.message);
    res.status(500).json({ error: 'Failed to export usage sessions' });
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
      userId: req.canViewAllUsage ? null : req.user.id,
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching session turns:', error.message);
    res.status(500).json({ error: 'Failed to fetch session turns' });
  }
});

export default router;
