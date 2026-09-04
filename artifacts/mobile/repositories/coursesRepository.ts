/**
 * coursesRepository.ts
 *
 * Provides all data for the Courses screen.
 * The screen calls only coursesRepository.get() — it never knows if data came
 * from Supabase or the local cache.
 *
 * Cache strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Public:  course catalog (all courses + ratings)
 *   - Key: CACHED_COURSES_CATALOG   TTL: 30 min
 *
 * Private: enrollments + per-course progress (user-scoped)
 *   - Key: CACHED_COURSES_ENROLLMENTS   TTL: 5 min
 *   - Cleared on logout
 *
 * Refresh strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Online:  fetch → write cache → return live data
 * Offline: read cache → return stale (or empty if cold)
 *
 * Invalidation
 * ─────────────────────────────────────────────────────────────────────────────
 * cacheManager evicts version-mismatched entries automatically.
 * TTL expiry returns null; next online load overwrites.
 */

import { STORAGE_KEYS } from '@/constants/storageKeys';
import { CACHE_POLICY } from '@/constants/cachePolicy';
import { cacheManager, networkResult, cacheResult, RepositoryResult } from '@/services/cacheManager';
import { isNetworkError } from '@/lib/networkUtils';
import { firstThumbnailUrl, parseThumbnailUrls } from '@/lib/thumbnailUtils';
import { fetchAllCourses } from '@/services/courseDataProvider';
import { fetchEnrolledCourses } from '@/services/enrollmentService';
import { fetchCourseProgress } from '@/lib/progressStorage';
import { fetchCourseRatingsSummary } from '@/services/reviewService';

// ── Types ────────────────────────────────────────────────────────────────────
export interface CourseCatalogItem {
  id: string;
  title: string;
  category: string;
  level: string;
  price: number;
  isFree: boolean;
  thumbnail: any;
  instructor: string;
  rating: number;
  reviews: number;
  description: string;
  modules: any[];
}

export interface EnrolledCourseDetail {
  courseId: string;
  courseTitle: string;
  instructor: string;
  thumbnail: any;
  progress: number;
  totalModules: number;
  completedModules: number;
  lastAccessedAt: string;
  timeSpent: number;
}

export interface CoursesData {
  /** All public courses the user can browse (excludes already enrolled). */
  catalog: CourseCatalogItem[];
  /** Courses the user is currently enrolled in, with per-course progress. */
  enrollments: EnrolledCourseDetail[];
}

export const EMPTY_COURSES_DATA: CoursesData = {
  catalog: [],
  enrollments: [],
};

// ── Remote fetchers ──────────────────────────────────────────────────────────

async function fetchCatalog(): Promise<CourseCatalogItem[]> {
  let reviewStats: Record<string, { ratingSum: number; count: number }> = {};
  try {
    const data = await fetchCourseRatingsSummary();
    if (data && data.length > 0) {
      data.forEach((rev: any) => {
        const id = String(rev.course_id);
        if (!reviewStats[id]) reviewStats[id] = { ratingSum: 0, count: 0 };
        reviewStats[id].ratingSum += Number(rev.rating) || 0;
        reviewStats[id].count += 1;
      });
    }
  } catch { /* reviews are non-critical */ }

  const all = await fetchAllCourses();
  return all.map((c: any) => {
    const stats  = reviewStats[String(c.id)];
    const rating  = stats ? Number((stats.ratingSum / stats.count).toFixed(1)) : 0;
    const reviews = stats ? stats.count : 0;
    return {
      id: String(c.id),
      title: c.title,
      category: c.category || 'General',
      level: c.level
        ? c.level.charAt(0).toUpperCase() + c.level.slice(1)
        : 'Beginner',
      price: c.price || 0,
      isFree: c.is_free,
      thumbnail: firstThumbnailUrl(c.thumbnail_url)
        ? { uri: firstThumbnailUrl(c.thumbnail_url)! }
        : require('@/assets/images/courses/course_robotics.webp'),
      images: parseThumbnailUrls(c.thumbnail_url),
      instructor: c.profiles?.full_name || '',
      rating,
      reviews,
      description: c.description || '',
      modules: [],
    };
  });
}

async function fetchEnrollments(userId: string): Promise<EnrolledCourseDetail[]> {
  const enrollments = await fetchEnrolledCourses(userId);
  return Promise.all(
    enrollments
      .filter((enr: any) => enr.courses)
      .map(async (enr: any) => {
        const c    = enr.courses;
        const prog = await fetchCourseProgress(userId, String(c.id));
        return {
          courseId:         String(c.id),
          courseTitle:      c.title,
          instructor:       c.profiles?.full_name || '',
          thumbnail:        firstThumbnailUrl(c.thumbnail_url)
                              ? { uri: firstThumbnailUrl(c.thumbnail_url)! }
                              : require('@/assets/images/courses/course_robotics.webp'),
          images:           parseThumbnailUrls(c.thumbnail_url),
          progress:         prog.percentage,
          totalModules:     prog.total,
          completedModules: prog.completed,
          lastAccessedAt:   enr.enrolled_at || new Date().toISOString(),
          timeSpent:        0,
        };
      })
  );
}

// ── Public API ───────────────────────────────────────────────────────────────
export const coursesRepository = {
  /**
   * get() — the only method the screen calls.
   *
   * The repository assembles CoursesData from remote or cache.
   * The screen does not know the data origin.
   */
  async get(
    userId: string | undefined,
    isOffline: boolean,
    forceRefresh = false,
    onBackgroundUpdate?: (data: CoursesData) => void
  ): Promise<RepositoryResult<CoursesData>> {
    if (isOffline) {
      return coursesRepository.loadFromCache(userId);
    }

    // Cache-first optimization: check public catalog first
    if (!forceRefresh) {
      try {
        const catalogResult = await cacheManager.readWithMeta<CourseCatalogItem[]>(
          STORAGE_KEYS.CACHED_COURSES_CATALOG,
          CACHE_POLICY.COURSES_CATALOG_TTL_MS
        );

        if (catalogResult && !catalogResult.stale) {
          const enrollmentsResult = userId
            ? await cacheManager.readWithMeta<EnrolledCourseDetail[]>(
                STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS,
                CACHE_POLICY.COURSES_ENROLLMENTS_TTL_MS
              )
            : null;

          const cachedEnrollments = enrollmentsResult?.data ?? [];
          const enrolledIds = new Set(cachedEnrollments.map((e) => e.courseId));
          const cachedData: CoursesData = {
            catalog: catalogResult.data.filter((c) => !enrolledIds.has(c.id)),
            enrollments: cachedEnrollments,
          };

          // Mixed-TTL: if enrollments cache is stale/expired or empty for a logged-in user, kick off background refetch
          const enrollmentsStale = userId && (!enrollmentsResult || enrollmentsResult.stale || cachedEnrollments.length === 0);

          if (userId && enrollmentsStale && onBackgroundUpdate) {
            fetchEnrollments(userId)
              .then((newEnrollments) => {
                cacheManager.write(STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS, newEnrollments);
                const newEnrolledIds = new Set(newEnrollments.map((e) => e.courseId));
                onBackgroundUpdate({
                  catalog: catalogResult.data.filter((c) => !newEnrolledIds.has(c.id)),
                  enrollments: newEnrollments,
                });
              })
              .catch(() => {});
          }

          return cacheResult(cachedData, catalogResult.updatedAt, CACHE_POLICY.COURSES_CATALOG_TTL_MS);
        }
      } catch (err) {
        console.warn('[coursesRepo] Error checking public cache:', err);
      }
    }

    try {
      const catalog = await fetchCatalog().catch(() => []);
      cacheManager.write(STORAGE_KEYS.CACHED_COURSES_CATALOG, catalog);

      let enrollments: EnrolledCourseDetail[] = [];
      if (userId) {
        enrollments = await fetchEnrollments(userId).catch(() => []);
        cacheManager.write(STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS, enrollments);
      }

      const enrolledIds = new Set(enrollments.map((e) => e.courseId));
      return networkResult({
        catalog: catalog.filter((c) => !enrolledIds.has(c.id)),
        enrollments,
      });
    } catch (err: any) {
      if (isNetworkError(err)) {
        console.warn('[coursesRepo] Network error — falling back to cache');
      } else {
        console.error('[coursesRepo] Unexpected fetch error:', err);
      }
      return coursesRepository.loadFromCache(userId);
    }
  },

  async loadFromCache(userId: string | undefined): Promise<RepositoryResult<CoursesData>> {
    const [catalogResult, enrollmentsResult] = await Promise.all([
      cacheManager.readWithMeta<CourseCatalogItem[]>(
        STORAGE_KEYS.CACHED_COURSES_CATALOG,
        CACHE_POLICY.COURSES_CATALOG_TTL_MS
      ),
      userId
        ? cacheManager.readWithMeta<EnrolledCourseDetail[]>(
            STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS,
            CACHE_POLICY.COURSES_ENROLLMENTS_TTL_MS
          )
        : Promise.resolve(null),
    ]);

    const cachedEnrollments = enrollmentsResult?.data ?? [];
    const enrolledIds = new Set(cachedEnrollments.map((e) => e.courseId));
    const data: CoursesData = {
      catalog:     (catalogResult?.data ?? []).filter((c) => !enrolledIds.has(c.id)),
      enrollments: cachedEnrollments,
    };

    // Use catalog as the primary timestamp (public data)
    const updatedAt = catalogResult?.updatedAt ?? new Date().toISOString();
    return cacheResult(data, updatedAt, CACHE_POLICY.COURSES_CATALOG_TTL_MS);
  },

  /** Clear only user-specific caches. Called on logout. */
  async clearUserCache(): Promise<void> {
    await cacheManager.clear(STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS);
  },

  /** Invalidate enrollments cache so next screen load fetches fresh data. */
  async invalidateEnrollmentsCache(): Promise<void> {
    await cacheManager.clear(STORAGE_KEYS.CACHED_COURSES_ENROLLMENTS);
  },
};
