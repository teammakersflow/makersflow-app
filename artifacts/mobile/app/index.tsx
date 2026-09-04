import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View, Text } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useNetwork } from "@/context/NetworkContext";
import { hasSeenOnboarding } from "@/lib/onboardingStorage";

// ── resolveStartupRoute ──────────────────────────────────────────────────────
// Pure function — no side effects, no state mutations, no router calls.
// Accepts all required startup state as parameters so it is fully unit-testable.
//
// Decision matrix:
//   Offline + local session       → /(tabs)     (user was already logged in)
//   Offline + no local session    → /(auth)/login (never authenticated)
//   Online + authenticated        → /(tabs)
//   Online + unauthenticated + onboarding incomplete → /onboarding
//   Online + unauthenticated + onboarding complete   → /(auth)/login
export function resolveStartupRoute(params: {
  isOffline: boolean;
  isAuthenticatedLocally: boolean;
  isAuthenticated: boolean;
  onboardingSeen: boolean;
}): string {
  const { isOffline, isAuthenticatedLocally, isAuthenticated, onboardingSeen } = params;

  if (isOffline) {
    // Offline: only allow entry if we know a local session exists.
    // isAuthenticatedLocally is set before any network call, using the
    // locally stored Supabase token — it does not depend on a live profile fetch.
    return isAuthenticatedLocally ? "/(tabs)" : "/(auth)/login";
  }

  if (isAuthenticated) {
    // Online and fully authenticated (session + profile loaded).
    return "/(tabs)";
  }

  // Online but not authenticated — route to onboarding or login.
  return onboardingSeen ? "/(auth)/login" : "/onboarding";
}

// ── SplashRedirect ───────────────────────────────────────────────────────────
// Responsibilities:
//   1. Wait for ALL startup checks to complete.
//   2. Call resolveStartupRoute() with fully-settled state.
//   3. Call router.replace() exactly once via a navigation guard.
export default function SplashRedirect() {
  const { isAuthenticated, isAuthenticatedLocally, isOffline, authInitialized } = useAuth();
  const { isConnected } = useNetwork();
  const colors = useColors();

  // Navigation guard — prevents duplicate router.replace() calls.
  const hasNavigated = useRef(false);

  // Onboarding state — tracks whether the user has seen the welcome flow.
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [onboardingCheckDone, setOnboardingCheckDone] = useState(false);

  // Load onboarding flag from persistent storage once on mount.
  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      setOnboardingSeen(seen);
      setOnboardingCheckDone(true);
    });
  }, []);

  // Navigate when ALL startup checks have settled.
  useEffect(() => {
    // Guard 1: Do not navigate if any dependency is still loading.
    if (!authInitialized || !onboardingCheckDone || isConnected === null) return;

    // Guard 2: Prevent duplicate navigation.
    if (hasNavigated.current) return;
    hasNavigated.current = true;

    const destination = resolveStartupRoute({
      isOffline,
      isAuthenticatedLocally,
      isAuthenticated,
      onboardingSeen,
    });

    router.replace(destination as any);
  }, [authInitialized, onboardingCheckDone, isConnected, isOffline, isAuthenticatedLocally, isAuthenticated, onboardingSeen]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={{ marginTop: 12, color: colors.foreground, fontWeight: "500" }}>
        Loading...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});
