/**
 * cachePolicy.ts
 *
 * Central registry of all cache TTLs (time-to-live) for the app.
 * Every repository imports TTLs from here — no magic numbers scattered across files.
 *
 * Naming convention: <SCOPE>_<DATASET>_TTL_MS
 */

export const CACHE_POLICY = {
  // ── Home tab ───────────────────────────────────────────────────────────────
  // Public datasets change infrequently; 30 min is safe.
  HOME_PROMOTIONS_TTL_MS:    30 * 60 * 1000,
  HOME_COURSES_TTL_MS:       30 * 60 * 1000,
  HOME_PRODUCTS_TTL_MS:      30 * 60 * 1000,
  // User-specific data (progress, streaks) must feel fresh; 5 min max.
  HOME_PROGRESS_TTL_MS:       5 * 60 * 1000,
  HOME_NOTIFICATIONS_TTL_MS:  5 * 60 * 1000,

  // ── Courses tab ────────────────────────────────────────────────────────────
  // Catalog can share the 30 min TTL.
  COURSES_CATALOG_TTL_MS:    30 * 60 * 1000,
  // Enrollments change when the user purchases; 5 min keeps it fresh.
  COURSES_ENROLLMENTS_TTL_MS: 5 * 60 * 1000,

  // ── Store tab ──────────────────────────────────────────────────────────────
  STORE_PRODUCTS_TTL_MS:     30 * 60 * 1000,
} as const;

/** Shared cache version. Bump this when any CachePayload schema changes. */
/** Bumped to 2: product queries now include images column **/
/**
 * Bumped to 3 (2026-11-13): cached course progress changed meaning.
 * `isCompleted` is now the LIVE lesson rule only; builds before it either had
 * no `isCompleted` (status guessed from a rounded/over-100 percentage) or
 * derived it partly from enrollments.completed_at. Dropping version-2 entries
 * on upgrade guarantees no cached completion status from an older build is
 * ever shown.
 */
export const CACHE_VERSION = 3;

/**
 * Decides what to do with a raw cached entry (pure; used by cacheManager).
 * - `payload`: the entry to use, or null.
 * - `discard`: true when the stored entry must be removed (corrupt or written
 *   by a different cache version, e.g. an older app build).
 */
export function decodeCachePayload<T>(
  raw: string | null,
): { payload: { version: number; updatedAt: string; data: T } | null; discard: boolean } {
  if (!raw) return { payload: null, discard: false };
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { payload: null, discard: true };
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== CACHE_VERSION) {
    return { payload: null, discard: true };
  }
  return { payload: parsed, discard: false };
}
