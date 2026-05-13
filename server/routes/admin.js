import express from 'express';
import { permissionsDb, userDb } from '../database/db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_PERMISSIONS = ['view_all_usage'];

// All routes require admin
router.use(requireAdmin);

/**
 * GET /api/admin/permissions
 * List all users with their permissions.
 */
router.get('/permissions', (req, res) => {
  try {
    const users = permissionsDb.getAllUsersWithPermissions();
    res.json({ users, allowedPermissions: ALLOWED_PERMISSIONS });
  } catch (error) {
    console.error('Error fetching permissions:', error.message);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * POST /api/admin/permissions
 * Grant a permission to a user.
 * Body: { userId: number, permissionKey: string }
 */
router.post('/permissions', (req, res) => {
  try {
    const { userId, permissionKey } = req.body;

    if (!userId || !permissionKey) {
      return res.status(400).json({ error: 'userId and permissionKey are required' });
    }

    if (!ALLOWED_PERMISSIONS.includes(permissionKey)) {
      return res.status(400).json({ error: `Invalid permission. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}` });
    }

    const user = userDb.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    permissionsDb.grantPermission(userId, permissionKey, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error granting permission:', error.message);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

/**
 * DELETE /api/admin/permissions
 * Revoke a permission from a user.
 * Body: { userId: number, permissionKey: string }
 */
router.delete('/permissions', (req, res) => {
  try {
    const { userId, permissionKey } = req.body;

    if (!userId || !permissionKey) {
      return res.status(400).json({ error: 'userId and permissionKey are required' });
    }

    permissionsDb.revokePermission(userId, permissionKey);
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking permission:', error.message);
    res.status(500).json({ error: 'Failed to revoke permission' });
  }
});

export default router;
