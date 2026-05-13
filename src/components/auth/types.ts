import type { ReactNode } from 'react';

export type AuthUser = {
  id?: number | string;
  username: string;
  email?: string;
  permissions?: string[];
  isAdmin?: boolean;
  [key: string]: unknown;
};

export type AuthActionResult = { success: true } | { success: false; error: string };

export type AuthSessionPayload = {
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

export type AuthStatusPayload = {
  authConfigured?: boolean;
};

export type AuthUserPayload = {
  user?: AuthUser;
};

export type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  authConfigured: boolean;
  hasCompletedOnboarding: boolean;
  error: string | null;
  loginWithMicrosoft: () => void;
  logout: () => void;
  refreshOnboardingStatus: () => Promise<void>;
  hasPermission: (key: string) => boolean;
};

export type AuthProviderProps = {
  children: ReactNode;
};
