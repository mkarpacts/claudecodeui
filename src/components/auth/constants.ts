export const AUTH_TOKEN_STORAGE_KEY = 'auth-token';

// Single source for reading the auth token. REST responses auto-refresh the token
// into localStorage (X-Refreshed-Token), so storage is always fresher than React state.
export const readStoredToken = (): string | null => localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

export const AUTH_ERROR_MESSAGES = {
  authStatusCheckFailed: 'Failed to check authentication status',
  authFailed: 'Authentication failed. Please try again.',
  loginCancelled: 'Login was cancelled.',
  networkError: 'Network error. Please try again.',
  notConfigured: 'Microsoft authentication is not configured. Contact your administrator.',
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
