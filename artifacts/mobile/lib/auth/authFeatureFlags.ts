/**
 * lib/auth/authFeatureFlags.ts
 *
 * Feature flags controlling authentication migration rollout.
 * Default is true as Mobile authentication is now unified on Custom Backend Auth.
 */

export const AUTH_FEATURE_FLAGS = {
  /**
   * Custom Backend Auth is active.
   */
  USE_CUSTOM_BACKEND_AUTH: true,
};
