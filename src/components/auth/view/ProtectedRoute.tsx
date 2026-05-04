import type { ReactNode } from 'react';
import { IS_PLATFORM } from '../../../constants/config';
import { useAuth } from '../context/AuthContext';
import Onboarding from '../../onboarding/view/Onboarding';
import AuthLoadingScreen from './AuthLoadingScreen';
import AuthErrorAlert from './AuthErrorAlert';
import AuthScreenLayout from './AuthScreenLayout';

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, authConfigured, hasCompletedOnboarding, refreshOnboardingStatus, loginWithMicrosoft, error } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return <Onboarding onComplete={refreshOnboardingStatus} />;
    }

    return <>{children}</>;
  }

  if (!user) {
    return (
      <AuthScreenLayout
        title="Welcome"
        description="Sign in to access Claude Code UI"
        footerText=""
      >
        <div className="space-y-4">
          <AuthErrorAlert errorMessage={error || ''} />
          {authConfigured ? (
            <button
              type="button"
              onClick={loginWithMicrosoft}
              className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700"
            >
              Sign in with Microsoft
            </button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Microsoft authentication is not configured. Contact your administrator.
            </p>
          )}
        </div>
      </AuthScreenLayout>
    );
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
