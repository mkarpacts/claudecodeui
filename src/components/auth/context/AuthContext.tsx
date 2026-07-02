import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { api } from '../../../utils/api';
import { AUTH_ERROR_MESSAGES, AUTH_FRAGMENT_ERRORS, AUTH_TOKEN_STORAGE_KEY, readStoredToken } from '../constants';
import type {
  AuthContextValue,
  AuthProviderProps,
  AuthStatusPayload,
  AuthUser,
  AuthUserPayload,
  OnboardingStatusPayload,
} from '../types';
import { parseJsonSafely } from '../utils';

const AuthContext = createContext<AuthContextValue | null>(null);

const persistToken = (token: string) => {
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
};

const clearStoredToken = () => {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};

/**
 * Extract auth_token or auth_error from URL fragment once.
 * Clears the fragment after reading. Subsequent calls return nulls.
 */
let fragmentConsumed = false;
function extractAuthFragment(): { token: string | null; error: string | null } {
  if (fragmentConsumed) return { token: null, error: null };

  const hash = window.location.hash;
  if (!hash || hash.length < 2) return { token: null, error: null };

  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('auth_token');
  const errorCode = params.get('auth_error');

  if (token || errorCode) {
    fragmentConsumed = true;
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const error = errorCode ? (AUTH_FRAGMENT_ERRORS[errorCode] || AUTH_ERROR_MESSAGES.authFailed) : null;

  return { token, error };
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSession = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    persistToken(nextToken);
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearStoredToken();
  }, []);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = await parseJsonSafely<OnboardingStatusPayload>(response);
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (caughtError) {
      console.error('Error checking onboarding status:', caughtError);
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  const checkAuthStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Check URL fragment for token or error from Microsoft callback
      const fragment = extractAuthFragment();
      if (fragment.error) {
        setError(fragment.error);
      }
      if (fragment.token) {
        persistToken(fragment.token);
        setToken(fragment.token);
      }

      const activeToken = fragment.token || token;

      const statusResponse = await api.auth.status();
      const statusPayload = await parseJsonSafely<AuthStatusPayload>(statusResponse);

      setAuthConfigured(statusPayload?.authConfigured ?? false);

      if (!activeToken) {
        return;
      }

      const userResponse = await api.auth.user();
      if (!userResponse.ok) {
        clearSession();
        return;
      }

      const userPayload = await parseJsonSafely<AuthUserPayload>(userResponse);
      if (!userPayload?.user) {
        clearSession();
        return;
      }

      setUser(userPayload.user);
      if (!fragment.token) {
        setToken(activeToken);
      }
      await checkOnboardingStatus();
    } catch (caughtError) {
      console.error('[Auth] Auth status check failed:', caughtError);
      setError(AUTH_ERROR_MESSAGES.authStatusCheckFailed);
    } finally {
      setIsLoading(false);
    }
  }, [checkOnboardingStatus, clearSession, token]);

  useEffect(() => {
    if (IS_PLATFORM) {
      setUser({ username: 'platform-user' });
      setAuthConfigured(true);
      void checkOnboardingStatus().finally(() => {
        setIsLoading(false);
      });
      return;
    }

    void checkAuthStatus();
  }, [checkAuthStatus, checkOnboardingStatus]);

  const loginWithMicrosoft = useCallback(() => {
    window.location.href = '/api/auth/microsoft';
  }, []);

  const logout = useCallback(() => {
    const tokenToInvalidate = token;
    clearSession();

    if (tokenToInvalidate) {
      void api.auth.logout().catch((caughtError: unknown) => {
        console.error('Logout endpoint error:', caughtError);
      });
    }
  }, [clearSession, token]);

  const hasPermission = useCallback(
    (key: string): boolean => {
      if (!user) return false;
      if (user.isAdmin) return true;
      return user.permissions?.includes(key) ?? false;
    },
    [user],
  );

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      authConfigured,
      hasCompletedOnboarding,
      error,
      loginWithMicrosoft,
      logout,
      refreshOnboardingStatus,
      hasPermission,
    }),
    [
      authConfigured,
      error,
      hasCompletedOnboarding,
      hasPermission,
      isLoading,
      loginWithMicrosoft,
      logout,
      refreshOnboardingStatus,
      token,
      user,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
