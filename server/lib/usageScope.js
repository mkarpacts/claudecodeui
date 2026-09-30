import { isAdmin } from '../middleware/auth.js';
import { permissionsDb, usageDb } from '../database/db.js';

export function canViewAllUsage(user) {
  return Boolean(user) && (isAdmin(user) || permissionsDb.hasPermission(user.id, 'view_all_usage'));
}

export function usageScopeFor(user) {
  if (!user) return null;
  return { userId: canViewAllUsage(user) ? null : user.id };
}

export function sessionCostFor(sessionId, scope) {
  return scope ? usageDb.getSessionCost(sessionId, scope) : null;
}
