/**
 * Route gate decisions for components/ProtectedRoute.tsx (fixes H-4 and M-8,
 * 2026-11-10). Pure and unit-tested.
 *
 * H-4: signed-in users who still need to finish their profile (for example a
 * new Google user without a grade) are sent to /(auth)/onboarding. Before this
 * fix, ProtectedRoute treated every (auth) screen as "must leave", rendered null
 * and never redirected again, so the user saw a blank screen. Screens a signed-in
 * user may legitimately use inside (auth) are now allowed.
 *
 * M-8: the full-screen spinner is shown only during the initial session
 * restore, not on every login or logout isLoading change. The old behaviour
 * unmounted the whole navigator and lost screen state such as error messages.
 */

/** (auth) screens a signed-in user may stay on. */
export const AUTHED_ALLOWED_AUTH_SCREENS = ["onboarding", "verify-otp", "reset-password"] as const;

export type GateDecision = "spinner" | "render" | "redirect_to_tabs";

export function decideAuthGate(input: {
  authInitialized: boolean;
  authed: boolean;          // isAuthenticated || isAuthenticatedLocally
  segments: readonly string[];
}): GateDecision {
  if (!input.authInitialized && !input.authed) return "spinner";
  const inAuthGroup = input.segments[0] === "(auth)";
  if (!input.authed || !inAuthGroup) return "render";
  const screen = input.segments[1] ?? "";
  if ((AUTHED_ALLOWED_AUTH_SCREENS as readonly string[]).includes(screen)) return "render";
  return "redirect_to_tabs";
}

/** Where to go after a successful sign-in (H-4). */
export function postLoginRoute(profile: { grade?: unknown; onboarding_completed?: unknown } | null | undefined): "/(tabs)" | "/(auth)/onboarding" {
  if (!profile) return "/(tabs)"; // profile unknown: do not trap the user; tabs can prompt later
  if (profile.onboarding_completed === true) return "/(tabs)";
  return profile.grade ? "/(tabs)" : "/(auth)/onboarding";
}
