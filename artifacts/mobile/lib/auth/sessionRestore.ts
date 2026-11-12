/**
 * Session-restore fallback decision (fix M-7, 2026-11-10). Pure and unit-tested.
 *
 * Previously ANY non-401 failure of GET /auth/me restored the cached profile
 * with session = null, even when online. A deleted account (404), a forbidden
 * account (403) or a malformed response then left the app looking signed in,
 * while every protected call failed.
 *
 * Now:
 *  - cached profile: only for transient failures (no network, timeout,
 *    gateway/server unavailability). The stored tokens are kept so the session
 *    resumes when the server is reachable again.
 *  - sign out: for definitive answers (400/401/403/404/409/410/422, or a
 *    successful response with an invalid body).
 */
export type RestoreFallback = "use_cached_profile" | "sign_out";

const TRANSIENT = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export function decideRestoreFallback(input: { status?: number | null; confirmedOffline: boolean; invalidBody?: boolean }): RestoreFallback {
  if (input.confirmedOffline) return "use_cached_profile";
  if (input.invalidBody) return "sign_out";
  const s = typeof input.status === "number" ? input.status : 0; // no status → network-level failure
  return TRANSIENT.has(s) ? "use_cached_profile" : "sign_out";
}
