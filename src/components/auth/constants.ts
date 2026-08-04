export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

// Single source for reading the auth token. REST responses auto-refresh the token
// into localStorage (X-Refreshed-Token), so storage is always fresher than React state.
export const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

// Fired by authenticatedFetch when a request that carried a token gets a 401 —
// the session is dead (expired JWT / rotated secret) and the user must re-login.
export const AUTH_EXPIRED_EVENT = 'claude-ui:auth-session-expired';

// Stale tokens can arrive from the outside — a leftover #auth_token in a
// restored/history URL, or an X-Refreshed-Token header replayed from the HTTP
// cache on a 304 — and persisting one would overwrite a live session's fresh
// token. A genuine token is always freshly issued, so anything expired is
// garbage. 60s of leeway covers client clock skew; the server stays the judge.
export const isUsableToken = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp > Date.now() / 1000 - 60;
  } catch {
    return false;
  }
};

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  authFailed: 'Authentication failed. Please try again.',
  loginCancelled: 'Login was cancelled.',
  networkError: 'Network error. Please try again.',
  notConfigured: 'Microsoft authentication is not configured. Contact your administrator.',
  sessionExpired: 'Your session has expired. Please sign in again.',
} as const;

export const AUTH_FRAGMENT_ERRORS: Record<string, string> = {
  login_cancelled: AUTH_ERROR_MESSAGES.loginCancelled,
  auth_failed: AUTH_ERROR_MESSAGES.authFailed,
  auth_url_failed: AUTH_ERROR_MESSAGES.authFailed,
  invalid_state: AUTH_ERROR_MESSAGES.authFailed,
  no_code: AUTH_ERROR_MESSAGES.authFailed,
  missing_identity: AUTH_ERROR_MESSAGES.authFailed,
  tenant_mismatch: AUTH_ERROR_MESSAGES.authFailed,
  callback_failed: AUTH_ERROR_MESSAGES.authFailed,
};
