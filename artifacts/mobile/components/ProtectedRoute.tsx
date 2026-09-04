import { useSegments, router } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isAuthenticatedLocally } = useAuth();
  const segments = useSegments();
  const colors = useColors();
  const hasRedirected = useRef(false);

  const inAuthGroup = segments[0] === '(auth)';

  useEffect(() => {
    // FIX: redirect as soon as we know auth state — don't wait for full profile load.
    // isAuthenticatedLocally is set from the restored session token (instant from
    // SecureStore) before the profile network fetch completes.
    if ((isAuthenticated || isAuthenticatedLocally) && inAuthGroup && !hasRedirected.current) {
      hasRedirected.current = true;
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isAuthenticatedLocally, inAuthGroup]);

  // FIX: only show the loading spinner on a true cold start (no local session at all).
  // If the user has a locally cached session (isAuthenticatedLocally = true),
  // skip the spinner entirely — they'll land on home instantly while the
  // profile finishes loading in the background.
  if (isLoading && !isAuthenticatedLocally) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Hide children while authenticated user is being redirected away from auth group
  if ((isAuthenticated || isAuthenticatedLocally) && inAuthGroup) {
    return null;
  }

  return <>{children}</>;
}
