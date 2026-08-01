/**
 * lib/auth/authFeatureFlags.ts
 *
 * Feature flags controlling authentication migration rollout.
 */

export const AUTH_FEATURE_FLAGS = {
  /**
   * Toggle between legacy Supabase Auth (false) and Custom Backend Auth (true).
   * Can be driven via EXPO_PUBLIC_USE_CUSTOM_AUTH environment variable.
   */
  USE_CUSTOM_BACKEND_AUTH: process.env.EXPO_PUBLIC_USE_CUSTOM_AUTH === 'true',
};
