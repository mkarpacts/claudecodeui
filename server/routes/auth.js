import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { isConfigured as isMicrosoftConfigured } from './auth-microsoft.js';

const router = express.Router();

// Check auth status
router.get('/status', async (req, res) => {
  try {
    res.json({
      needsSetup: false,
      authConfigured: isMicrosoftConfigured(),
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
