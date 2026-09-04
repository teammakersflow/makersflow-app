/**
 * homeRepository.ts
 *
 * Provides all data for the Home screen.
 * The screen calls only homeRepository.get() — it never knows if data came from
 * Supabase or the local cache.
 *
 * Cache strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Public datasets  (promotions, courses, products)
 *   - TTL: 30 min   (CACHE_POLICY.HOME_*)
 *   - Cleared on:   schema version bump only
 *
 * Private datasets (progress, notifications)
 *   - TTL:  5 min   (CACHE_POLICY.HOME_*)
 *   - Cleared on:   logout (clearUserCache)
 *
 * Refresh strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Online:  fetch → write cache → return live data
 * Offline: read cache → return stale data (or EMPTY_HOME_DATA if cold)
 *
 * Invalidation
 * ─────────────────────────────────────────────────────────────────────────────
 * Version mismatch → cacheManager evicts the entry automatically on read.
 * TTL expiry       → cacheManager returns null; next online load overwrites.
 */

import { supabase } from '@/lib/supabase';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { CACHE_POLICY } from '@/constants/cachePolicy';
import { cacheManager, networkResult, cacheResult, RepositoryResult } from '@/services/cacheManager';
import { isNetworkError } from '@/lib/networkUtils';
import { firstThumbnailUrl, parseThumbnailUrls } from '@/lib/thumbnailUtils';
import { fetchAllCourses, fetchLessonDurations } from '@/services/courseDataProvider';
import { fetchEnrolledCourses } from '@/services/enrollmentService';
import { fetchCourseProgress, fetchCourseLessonsProgress } from '@/lib/progressStorage';
import { ProgressCalculator } from '@/lib/progressCalculator';
import { notificationService } from '@/services/notificationService';
import { announcementService } from '@/services/announcementService';
import { fetchCourseRatingsSummary } from '@/services/reviewService';
import { fetchProductRatingsSummary } from '@/services/productReviewService';
import { productService } from '@/services/productService';
import { promotionService } from '@/services/promotionService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ────────────────────────────────────────────────────────────────────
export interface EnrolledCourse {
  courseId: string;
  progress: number;
  completedAt: string | null;
}

export interface HomeProgress {
  enrolledCourses: EnrolledCourse[];
  learningStreak: number;
  longestStreak: number;
  totalLessonsCompleted: number;
  totalHoursLearned: number;
}

export interface HomeData {
  // Public
  promotions: any[];
  courses: any[];
  popularCourses: any[];
  popularKits: any[];
  // Private
  progress: HomeProgress;
  unreadNotifCount: number;
}

export const EMPTY_PROGRESS: HomeProgress = {
  enrolledCourses: [],
  learningStreak: 0,
  longestStreak: 0,
  totalLessonsCompleted: 0,
  totalHoursLearned: 0,
};

export const EMPTY_HOME_DATA: HomeData = {
  promotions: [],
  courses: [],
  popularCourses: [],
  popularKits: [],
  progress: EMPTY_PROGRESS,
  unreadNotifCount: 0,
};

// ── Remote fetchers ──────────────────────────────────────────────────────────

async function fetchPromotions(): Promise<any[]> {
  return promotionService.getPromotions();
}

async function fetchCourses(): Promise<{ courses: any[]; popularCourses: any[] }> {
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
  } catch { /* non-critical */ }

  const all = await fetchAllCourses();
  const mapped = all.map((c: any) => {
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
  return { courses: mapped, popularCourses: mapped.slice(0, 8) };
}

async function fetchProducts(): Promise<any[]> {
  let reviewStats: Record<string, { ratingSum: number; count: number }> = {};
  try {
    const revData = await fetchProductRatingsSummary();
    if (revData && revData.length > 0) {
      revData.forEach((rev: any) => {
        const id = String(rev.product_id);
        if (!reviewStats[id]) reviewStats[id] = { ratingSum: 0, count: 0 };
        reviewStats[id].ratingSum += Number(rev.rating) || 0;
        reviewStats[id].count += 1;
      });
    }
  } catch { /* non-critical */ }

  const { products } = await productService.getProducts({ limit: 16 });
  const physicalProducts = products.filter((p) => p.category !== 'digital').slice(0, 8);

  return physicalProducts.map((prod) => {
    const stats = reviewStats[prod.id];
    const rating = stats ? Number((stats.ratingSum / stats.count).toFixed(1)) : prod.rating;
    const reviews = stats ? stats.count : prod.reviews;

    return {
      ...prod,
      rating,
      reviews,
    };
  });
}

async function fetchProgress(userId: string): Promise<HomeProgress> {
  const enrollments = await fetchEnrolledCourses(userId);
  const lpData: any[] = [];

  const enrolledCourses = await Promise.all(
    enrollments
      .filter((enr: any) => enr.courses)
      .map(async (enr: any) => {
        const cId = String(enr.courses.id);
        const prog = await fetchCourseProgress(userId, cId);
        try {
          const lessons = await fetchCourseLessonsProgress(userId, cId);
          lessons.forEach((lp: any) => {
            lpData.push({
              course_id: Number(cId),
              lesson_id: Number(lp.lesson_id),
              time_spent_secs: lp.time_spent_secs || lp.current_time_secs || 0,
              is_completed: lp.is_completed,
              last_watched_at: lp.last_watched_at,
            });
          });
        } catch {
          // ignore
        }
        return {
          courseId: cId,
          progress: prog.percentage,
          completedAt: enr.completed_at || null,
        };
      })
  );

  const streakResult = lpData.length > 0 ? ProgressCalculator.calculateStreak(lpData) : { current: 0, longest: 0 };
  const learningStreak        = streakResult.current;
  const longestStreak         = streakResult.longest;
  const totalLessonsCompleted = lpData.filter((p) => p.is_completed).length;

  // Learning time reflects real lesson durations: a completed lesson credits
  // its full published duration; in-progress lessons credit actual watch time.
  let totalHoursLearned = 0;
  if (lpData.length > 0) {
    const touchedIds = Array.from(new Set(lpData.map((p) => p.lesson_id).filter(Boolean)));
    const durationById = touchedIds.length > 0
      ? await fetchLessonDurations(touchedIds)
      : new Map<number, number>();
    const creditedTotalSecs = lpData.reduce((s, p) => {
      const watched = p.time_spent_secs || 0;
      const duration = durationById.get(Number(p.lesson_id)) || 0;
      return s + (p.is_completed ? Math.max(watched, duration) : watched);
    }, 0);
    totalHoursLearned = Number((creditedTotalSecs / 3600).toFixed(1));
  }

  return { enrolledCourses, learningStreak, longestStreak, totalLessonsCompleted, totalHoursLearned };
}


async function fetchNotificationCount(_userId?: string): Promise<number> {
  try {
    const lastSeen = await AsyncStorage.getItem('announcements_last_seen');
    const [unreadCount, broadcast] = await Promise.all([
      notificationService.getUnreadCount().catch(() => 0),
      announcementService.getActiveAnnouncements().catch(() => []),
    ]);
    const unreadBroadcasts = broadcast.filter(
      (a: any) => !lastSeen || new Date(a.created_at) > new Date(lastSeen),
    ).length;
    return unreadCount + unreadBroadcasts;
  } catch {
    return 0;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
export const homeRepository = {
  /**
   * get() — the only method the screen calls.
   *
   * Online:  fetchRemote → write caches → return live data
   * Offline: readCache   → return stale data (or empty if cold)
   */
  async get(
    userId: string | undefined,
    isOffline: boolean,
    forceRefresh = false,
    onBackgroundUpdate?: (data: HomeData) => void
  ): Promise<RepositoryResult<HomeData>> {
    if (isOffline) {
      return homeRepository.loadFromCache(userId);
    }

    // Cache-first optimization: check public cache first
    if (!forceRefresh) {
      try {
        const coursesMeta = await cacheManager.readWithMeta<{ courses: any[]; popularCourses: any[] }>(
          STORAGE_KEYS.CACHED_HOME_COURSES,
          CACHE_POLICY.HOME_COURSES_TTL_MS
        );

        if (coursesMeta && !coursesMeta.stale) {
          // Public cache is fresh! Load the rest from cache and serve immediately.
          const [promotions, popularKits, progressMeta, unreadNotifMeta] = await Promise.all([
            cacheManager.read<any[]>(STORAGE_KEYS.CACHED_HOME_PROMOTIONS, CACHE_POLICY.HOME_PROMOTIONS_TTL_MS),
            cacheManager.read<any[]>(STORAGE_KEYS.CACHED_HOME_PRODUCTS, CACHE_POLICY.HOME_PRODUCTS_TTL_MS),
            userId
              ? cacheManager.readWithMeta<HomeProgress>(STORAGE_KEYS.CACHED_HOME_PROGRESS, CACHE_POLICY.HOME_PROGRESS_TTL_MS)
              : Promise.resolve(null),
            userId
              ? cacheManager.readWithMeta<number>(STORAGE_KEYS.CACHED_HOME_NOTIFICATIONS, CACHE_POLICY.HOME_NOTIFICATIONS_TTL_MS)
              : Promise.resolve(null),
          ]);

          const cachedData: HomeData = {
            promotions: promotions ?? [],
            courses: coursesMeta.data.courses ?? [],
            popularCourses: coursesMeta.data.popularCourses ?? [],
            popularKits: popularKits ?? [],
            progress: progressMeta?.data ?? EMPTY_PROGRESS,
            unreadNotifCount: unreadNotifMeta?.data ?? 0,
          };

          // Mixed-TTL: if private data is stale/expired or progress data is missing for a logged-in user, force refetch
          const hasValidProgress = progressMeta && progressMeta.data && progressMeta.data.enrolledCourses && progressMeta.data.enrolledCourses.length > 0;
          const progressStale = !progressMeta || progressMeta.stale || !hasValidProgress;
          const notificationsStale = !unreadNotifMeta || unreadNotifMeta.stale;

          if (userId && (progressStale || notificationsStale) && onBackgroundUpdate) {
            Promise.all([
              progressStale ? fetchProgress(userId).catch(() => null) : Promise.resolve(progressMeta?.data ?? null),
              notificationsStale ? fetchNotificationCount(userId).catch(() => null) : Promise.resolve(unreadNotifMeta?.data ?? null),
            ]).then(([newProgress, newNotifCount]) => {
              let updated = false;
              const nextProgress = newProgress !== null ? newProgress : (progressMeta?.data ?? EMPTY_PROGRESS);
              const nextNotifCount = newNotifCount !== null ? newNotifCount : (unreadNotifMeta?.data ?? 0);

              if (progressStale && newProgress !== null) {
                cacheManager.write(STORAGE_KEYS.CACHED_HOME_PROGRESS, newProgress);
                updated = true;
              }
              if (notificationsStale && newNotifCount !== null) {
                cacheManager.write(STORAGE_KEYS.CACHED_HOME_NOTIFICATIONS, newNotifCount);
                updated = true;
              }

              if (updated) {
                onBackgroundUpdate({
                  ...cachedData,
                  progress: nextProgress,
                  unreadNotifCount: nextNotifCount,
                });
              }
            }).catch(() => {});
          }

          return cacheResult(cachedData, coursesMeta.updatedAt, CACHE_POLICY.HOME_COURSES_TTL_MS);
        }
      } catch (err) {
        console.warn('[homeRepo] Error checking public cache:', err);
      }
    }

    try {
      const [promotions, courseResult, popularKits] = await Promise.all([
        fetchPromotions().catch(() => []),
        fetchCourses().catch(() => ({ courses: [], popularCourses: [] })),
        fetchProducts().catch(() => []),
      ]);

      // Write public caches (fire-and-forget)
      cacheManager.write(STORAGE_KEYS.CACHED_HOME_PROMOTIONS, promotions);
      cacheManager.write(STORAGE_KEYS.CACHED_HOME_COURSES, {
        courses: courseResult.courses,
        popularCourses: courseResult.popularCourses,
      });
      cacheManager.write(STORAGE_KEYS.CACHED_HOME_PRODUCTS, popularKits);

      let progress        = EMPTY_PROGRESS;
      let unreadNotifCount = 0;

      if (userId) {
        [progress, unreadNotifCount] = await Promise.all([
          fetchProgress(userId).catch(() => EMPTY_PROGRESS),
          fetchNotificationCount(userId).catch(() => 0),
        ]);
        cacheManager.write(STORAGE_KEYS.CACHED_HOME_PROGRESS,      progress);
        cacheManager.write(STORAGE_KEYS.CACHED_HOME_NOTIFICATIONS, unreadNotifCount);
      }

      return networkResult({
        promotions,
        courses: courseResult.courses,
        popularCourses: courseResult.popularCourses,
        popularKits,
        progress,
        unreadNotifCount,
      });
    } catch (err: any) {
      if (isNetworkError(err)) {
        console.warn('[homeRepo] Network error — falling back to cache');
      } else {
        console.error('[homeRepo] Unexpected fetch error:', err);
      }
      return homeRepository.loadFromCache(userId);
    }
  },

  /** Assemble HomeData entirely from local caches. */
  async loadFromCache(userId: string | undefined): Promise<RepositoryResult<HomeData>> {
    // Read all cache datasets in parallel, collecting metadata from the primary
    // (courses) entry to represent the overall cache timestamp.
    const [cachedCourseResult, promotions, popularKits, progress, unreadNotifCount] =
      await Promise.all([
        cacheManager.readWithMeta<{ courses: any[]; popularCourses: any[] }>(
          STORAGE_KEYS.CACHED_HOME_COURSES,
          CACHE_POLICY.HOME_COURSES_TTL_MS
        ),
        cacheManager.read<any[]>(
          STORAGE_KEYS.CACHED_HOME_PROMOTIONS,
          CACHE_POLICY.HOME_PROMOTIONS_TTL_MS
        ),
        cacheManager.read<any[]>(
          STORAGE_KEYS.CACHED_HOME_PRODUCTS,
          CACHE_POLICY.HOME_PRODUCTS_TTL_MS
        ),
        userId
          ? cacheManager.read<HomeProgress>(
              STORAGE_KEYS.CACHED_HOME_PROGRESS,
              CACHE_POLICY.HOME_PROGRESS_TTL_MS
            )
          : Promise.resolve(null),
        userId
          ? cacheManager.read<number>(
              STORAGE_KEYS.CACHED_HOME_NOTIFICATIONS,
              CACHE_POLICY.HOME_NOTIFICATIONS_TTL_MS
            )
          : Promise.resolve(null),
      ]);

    const data: HomeData = {
      promotions:       promotions                       ?? [],
      courses:          cachedCourseResult?.data.courses         ?? [],
      popularCourses:   cachedCourseResult?.data.popularCourses  ?? [],
      popularKits:      popularKits                      ?? [],
      progress:         progress                         ?? EMPTY_PROGRESS,
      unreadNotifCount: unreadNotifCount                 ?? 0,
    };

    if (!cachedCourseResult) {
      // Cold cache — return empty but mark as cache source
      return cacheResult(data, new Date().toISOString(), CACHE_POLICY.HOME_COURSES_TTL_MS);
    }
    return cacheResult(data, cachedCourseResult.updatedAt, CACHE_POLICY.HOME_COURSES_TTL_MS);
  },

  /** Clear only user-specific caches. Called on logout. */
  async clearUserCache(): Promise<void> {
    await cacheManager.clear([
      STORAGE_KEYS.CACHED_HOME_PROGRESS,
      STORAGE_KEYS.CACHED_HOME_NOTIFICATIONS,
    ]);
  },

  /** Invalidate progress cache so next screen load fetches fresh data. */
  async invalidateProgressCache(): Promise<void> {
    await cacheManager.clear(STORAGE_KEYS.CACHED_HOME_PROGRESS);
  },
};
