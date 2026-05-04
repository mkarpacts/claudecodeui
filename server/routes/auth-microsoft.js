import express from 'express';
import * as msal from '@azure/msal-node';
import crypto from 'crypto';
import { userDb } from '../database/db.js';
import { generateToken } from '../middleware/auth.js';

const router = express.Router();

// In-memory store for CSRF state tokens (keyed by state value, value is timestamp)
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MSAL_SCOPES = ['openid', 'profile', 'email'];

function cleanExpiredStates() {
  const now = Date.now();
  for (const [state, timestamp] of pendingStates) {
    if (now - timestamp > STATE_TTL_MS) {
      pendingStates.delete(state);
    }
  }
}

function isConfigured() {
  return !!(
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_REDIRECT_URI
  );
}

// Lazy singleton — created on first use so env vars are resolved at request time
let msalClient = null;
function getMsalClient() {
  if (!msalClient) {
    msalClient = new msal.ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      },
    });
  }
  return msalClient;
}

// Redirect to Microsoft login
router.get('/', (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Microsoft authentication is not configured' });
  }

  const state = crypto.randomBytes(32).toString('hex');

  cleanExpiredStates();
  pendingStates.set(state, Date.now());

  getMsalClient().getAuthCodeUrl({
    scopes: MSAL_SCOPES,
    redirectUri: process.env.AZURE_REDIRECT_URI,
    state,
  }).then((authUrl) => {
    res.redirect(authUrl);
  }).catch((error) => {
    console.error('Error generating auth URL:', error);
    res.redirect('/#auth_error=auth_url_failed');
  });
});

// Handle Microsoft callback
router.get('/callback', async (req, res) => {
  // Handle user cancellation or errors from Microsoft
  if (req.query.error) {
    console.error('Microsoft auth error:', req.query.error, req.query.error_description);
    const errorMsg = req.query.error === 'access_denied' ? 'login_cancelled' : 'auth_failed';
    return res.redirect(`/#auth_error=${errorMsg}`);
  }

  const { code, state } = req.query;

  // Verify CSRF state
  if (!state || !pendingStates.has(state)) {
    console.error('Invalid or missing state parameter');
    return res.redirect('/#auth_error=invalid_state');
  }
  pendingStates.delete(state);

  if (!code) {
    return res.redirect('/#auth_error=no_code');
  }

  try {
    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code,
      scopes: MSAL_SCOPES,
      redirectUri: process.env.AZURE_REDIRECT_URI,
    });

    // Extract user identity from id token claims
    const claims = tokenResponse.idTokenClaims;
    if (!claims || !claims.oid) {
      console.error('Missing oid in token claims');
      return res.redirect('/#auth_error=missing_identity');
    }

    // Validate tenant
    if (claims.tid !== process.env.AZURE_TENANT_ID) {
      console.error('Tenant ID mismatch:', claims.tid);
      return res.redirect('/#auth_error=tenant_mismatch');
    }

    const microsoftId = claims.oid;
    const email = claims.preferred_username || claims.email || null;
    const displayName = claims.name || email || microsoftId;

    // Find or create user
    let user = userDb.getUserByMicrosoftId(microsoftId);

    if (!user) {
      // Generate unique username: try displayName, fall back to email prefix, then oid
      let username = displayName;
      try {
        user = userDb.createMicrosoftUser(username, microsoftId, email);
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          // Username collision — use email prefix or oid
          username = email ? email.split('@')[0] + '_' + microsoftId.slice(0, 6) : microsoftId;
          user = userDb.createMicrosoftUser(username, microsoftId, email);
        } else {
          throw err;
        }
      }
      userDb.completeOnboarding(user.id);
    }

    // Update last login
    userDb.updateLastLogin(user.id);

    // Generate our own JWT
    const token = generateToken(user);

    // Redirect to frontend with token in fragment (never logged by proxies)
    res.redirect(`/#auth_token=${token}`);
  } catch (error) {
    console.error('Microsoft auth callback error:', error);
    res.redirect('/#auth_error=callback_failed');
  }
});

export { isConfigured };
export default router;
