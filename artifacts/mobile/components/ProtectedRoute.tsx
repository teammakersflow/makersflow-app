import { useSegments, router } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { decideAuthGate } from '@/lib/authGate';

/**
 * Fixes H-4 and M-8 (2026-11-10). See lib/authGate.ts for the decision table.
 *  - Signed-in users may use (auth)/onboarding (profile completion) without
 *    being blanked or bounced.
 *  - The redirect guard resets when the user signs out, so the next sign-in
 *    redirects again.
 *  - The spinner appears only during the initial session restore. Login and
 *    logout no longer unmount the navigator.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAuthenticatedLocally, authInitialized } = useAuth();
  const segments = useSegments();
  const colors = useColors();
  const redirecting = useRef(false);

  const authed = !!(isAuthenticated || isAuthenticatedLocally);
  const decision = decideAuthGate({ authInitialized: !!authInitialized, authed, segments });

  useEffect(() => {
    if (!authed) {
      redirecting.current = false;
      return;
    }
    if (decision === 'redirect_to_tabs' && !redirecting.current) {
      redirecting.current = true;
      router.replace('/(tabs)');
    } else if (decision !== 'redirect_to_tabs') {
      redirecting.current = false;
    }
  }, [authed, decision]);

  if (decision === 'spinner') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Keep the navigator mounted. While a redirect is pending we still render the
  // children (the login screen) for one frame, rather than blanking the whole tree.
  return <>{children}</>;
}
