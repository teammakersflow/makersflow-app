import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiClient } from '@/lib/auth/apiClient';
import { getCourseModules } from '@/services/courseDataProvider';
import { emitSessionExpired, isAuthError } from './sessionEvents';

// Cache progress IDs so playback updates do not repeatedly fetch all course progress.
const lessonProgressIdCache = new Map<string, string>();
// Prevent repeated course-progress GETs after temporary API failures.
const courseProgressLookupRetryAfter = new Map<string, number>();
const courseProgressLookupInFlight = new Map<string, Promise<boolean>>();
const pendingLessonProgressResolution = new Set<string>();
const lessonProgressUpsertInFlight = new Map<string, Promise<void>>();
const pendingLessonProgressUpdates = new Map<string, { userId: string; courseId: string | number; lessonId: string | number; currentTimeSecs: number; watchPercentage: number }>();

async function lookupCourseProgressIds(
  userId: string,
  courseId: string | number,
): Promise<boolean> {
  const courseKey = `${userId}:${courseId}`;

  const existingRequest = courseProgressLookupInFlight.get(courseKey);
  if (existingRequest) return existingRequest;

  const retryAfter = courseProgressLookupRetryAfter.get(courseKey) || 0;
  if (Date.now() < retryAfter) return false;

  const request = (async () => {
    try {
      const response = await apiClient.get<any>(
        `/lesson-progress/my/course/${Number(courseId)}`,
      );
      cacheCourseProgressIds(userId, courseId, response);
      courseProgressLookupRetryAfter.delete(courseKey);
      return true;
    } catch {
      courseProgressLookupRetryAfter.set(courseKey, Date.now() + 30000);
      return false;
    } finally {
      courseProgressLookupInFlight.delete(courseKey);
    }
  })();

  courseProgressLookupInFlight.set(courseKey, request);
  return request;
}

function lessonProgressCacheKey(userId: string, courseId: string | number, lessonId: string | number) {
  return `${userId}:${courseId}:${lessonId}`;
}

function findLessonProgressId(response: any, lessonId: string | number): string | undefined {
  const data = response?.data || response;

  if (Array.isArray(data?.lessons)) {
    const matched = data.lessons.find(
      (lesson: any) => String(lesson.lesson_id) === String(lessonId),
    );
    if (matched?.progress?.id != null) return String(matched.progress.id);
  }

  if (Array.isArray(data?.lessonsProgress)) {
    const matched = data.lessonsProgress.find(
      (progress: any) => String(progress.lesson_id) === String(lessonId),
    );
    if (matched?.id != null) return String(matched.id);
  }

  return undefined;
}

function findCreatedProgressId(response: any): string | undefined {
  const data = response?.data || response;
  const record = data?.progress || data?.lessonProgress || data?.lesson_progress || data;
  return record?.id != null ? String(record.id) : undefined;
}

function cacheCourseProgressIds(userId: string, courseId: string | number, response: any) {
  const data = response?.data || response;

  if (Array.isArray(data?.lessons)) {
    data.lessons.forEach((lesson: any) => {
      if (lesson?.lesson_id != null && lesson?.progress?.id != null) {
        lessonProgressIdCache.set(
          lessonProgressCacheKey(userId, courseId, lesson.lesson_id),
          String(lesson.progress.id),
        );
      }
    });
  }

  if (Array.isArray(data?.lessonsProgress)) {
    data.lessonsProgress.forEach((progress: any) => {
      if (progress?.lesson_id != null && progress?.id != null) {
        lessonProgressIdCache.set(
          lessonProgressCacheKey(userId, courseId, progress.lesson_id),
          String(progress.id),
        );
      }
    });
  }
}

/**
 * Single source of truth for "how far through a course is this learner".
 *
 * Rule: completed lessons / total lessons, rounded. If nothing is completed but
 * some watching has happened, floor at 1% so an in-progress course never looks
 * untouched. Mirrors web/src/lib/learn-data.ts so both platforms agree.
 */
export function computeCoursePercentage(
  completed: number,
  total: number,
  avgWatchPercentage = 0,
): number {
  if (total <= 0) return 0;
  if (completed >= total) return 100;
  const ratio = Math.round((completed / total) * 100);
  if (ratio > 0) return Math.min(ratio, 99);
  return avgWatchPercentage > 0 ? 1 : 0;
}

export interface UserCourseProgress {
  userId: string;
  courseId: string;
  progress: number;
  enrolledAt: string;
  lastAccessedAt: string;
  completedAt?: string;
  totalTimeSpent: number;
  modules: {
    [moduleId: string]: ModuleProgress;
  };
}

export interface ModuleProgress {
  moduleId: string;
  isCompleted: boolean;
  isStarted: boolean;
  videoProgress: VideoProgress;
  lastAccessedAt: string;
  completedAt?: string;
  timeSpent: number;
  totalLessons?: number;
  completedLessons?: number;
}

export interface VideoProgress {
  videoUrl: string;
  currentTime: number;
  duration: number;
  watchedPercentage: number;
  isCompleted: boolean;
  lastWatchedAt: string;
}

export interface WatchlistItem {
  courseId: string;
  moduleId: string;
  courseTitle: string;
  moduleTitle: string;
  courseThumbnail: any;
  lastWatchedAt: string;
  videoProgress: VideoProgress;
  courseProgress: number;
}

const STORAGE_KEYS = {
  courseProgress: (userId: string, courseId: string) =>
    `@progress:user:${userId}:course:${courseId}`,
  watchlist: (userId: string) => `@progress:user:${userId}:watchlist`,
};

export const ProgressStorage = {
  async saveCourseProgress(
    progress: UserCourseProgress
  ): Promise<void> {
    try {
      const key = STORAGE_KEYS.courseProgress(progress.userId, progress.courseId);
      await AsyncStorage.setItem(key, JSON.stringify(progress));
    } catch (error) {
      console.error("Failed to save course progress:", error);
    }
  },

  async loadCourseProgress(
    userId: string,
    courseId: string
  ): Promise<UserCourseProgress | null> {
    try {
      const key = STORAGE_KEYS.courseProgress(userId, courseId);
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Failed to load course progress:", error);
      return null;
    }
  },

  async loadAllCourseProgress(
    userId: string
  ): Promise<UserCourseProgress[]> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const progressKeys = keys.filter((key) =>
        key.startsWith(`@progress:user:${userId}:course:`)
      );
      const progressData = await AsyncStorage.multiGet(progressKeys);
      return progressData
        .map(([_, value]) => (value ? JSON.parse(value) : null))
        .filter(Boolean) as UserCourseProgress[];
    } catch (error) {
      console.error("Failed to load all course progress:", error);
      return [];
    }
  },

  async saveWatchlist(
    userId: string,
    watchlist: WatchlistItem[]
  ): Promise<void> {
    try {
      const key = STORAGE_KEYS.watchlist(userId);
      await AsyncStorage.setItem(key, JSON.stringify(watchlist));
    } catch (error) {
      console.error("Failed to save watchlist:", error);
    }
  },

  async loadWatchlist(userId: string): Promise<WatchlistItem[]> {
    try {
      const key = STORAGE_KEYS.watchlist(userId);
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error("Failed to load watchlist:", error);
      return [];
    }
  },

  async clearProgress(userId: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const userKeys = keys.filter((key) =>
        key.startsWith(`@progress:user:${userId}`)
      );
      await AsyncStorage.multiRemove(userKeys);
    } catch (error) {
      console.error("Failed to clear progress:", error);
    }
  },
};

/**
 * Marks a lesson complete via backend lesson-progress API.
 * Uses PATCH /lesson-progress/:id if record exists, or POST /lesson-progress if new.
 * Identity is derived purely from JWT bearer token.
 */
export async function markLessonComplete(
  userId: string,
  courseId: string | number,
  lessonId: string | number,
) {
  try {
    const numCourseId = Number(courseId);
    const numLessonId = Number(lessonId);

    let existingProgressId: string | undefined;
    try {
      const res = await apiClient.get<any>(`/lesson-progress/my/course/${numCourseId}`);
      const data = res?.data || res;
      if (data && Array.isArray(data.lessons)) {
        const matched = data.lessons.find((l: any) => String(l.lesson_id) === String(numLessonId));
        if (matched?.progress?.id) {
          existingProgressId = String(matched.progress.id);
        }
      }
    } catch {
      // ignore fetch error and attempt POST
    }

    if (existingProgressId) {
      await apiClient.patch(`/lesson-progress/${existingProgressId}`, {
        is_completed: true,
        watch_percentage: 100,
        last_watched_at: new Date().toISOString(),
      });
    } else {
      try {
        await apiClient.post('/lesson-progress', {
          course_id: numCourseId,
          lesson_id: numLessonId,
          is_completed: true,
          watch_percentage: 100,
          last_watched_at: new Date().toISOString(),
        });
      } catch (postErr: any) {
        if (postErr?.status === 409 || postErr?.statusCode === 409) {
          const res = await apiClient.get<any>(`/lesson-progress/my/course/${numCourseId}`);
          const data = res?.data || res;
          if (data && Array.isArray(data.lessons)) {
            const matched = data.lessons.find((l: any) => String(l.lesson_id) === String(numLessonId));
            if (matched?.progress?.id) {
              await apiClient.patch(`/lesson-progress/${matched.progress.id}`, {
                is_completed: true,
                watch_percentage: 100,
                last_watched_at: new Date().toISOString(),
              });
            }
          }
        } else {
          throw postErr;
        }
      }
    }
  } catch (error: any) {
    if (isAuthError(error)) emitSessionExpired();
    console.warn('[progressStorage] markLessonComplete error:', error);
  }
}

/**
 * Upserts lesson playback progress via backend lesson-progress API.
 * Uses PATCH /lesson-progress/:id if record exists, or POST /lesson-progress if new.
 * Identity is derived purely from JWT bearer token.
 */
async function performUpsertLessonProgress(
  userId: string,
  courseId: string | number,
  lessonId: string | number,
  currentTimeSecs: number,
  watchPercentage: number,
): Promise<void> {
  try {
    const numCourseId = Number(courseId);
    const numLessonId = Number(lessonId);
    const cacheKey = lessonProgressCacheKey(userId, numCourseId, numLessonId);
    const courseKey = `${userId}:${numCourseId}`;
    const isCompleted = watchPercentage >= 90;

    let existingProgressId = lessonProgressIdCache.get(cacheKey);

    if (!existingProgressId) {
      const lookupSucceeded = await lookupCourseProgressIds(userId, numCourseId);

      // Never POST when the lookup failed; the record may already exist.
      if (!lookupSucceeded) return;

      existingProgressId = lessonProgressIdCache.get(cacheKey);

      // A previous POST succeeded but its ID could not be resolved.
      // Retry lookup after the cooldown instead of creating another record.
      if (!existingProgressId && pendingLessonProgressResolution.has(cacheKey)) {
        courseProgressLookupRetryAfter.set(courseKey, Date.now() + 30000);
        return;
      }
    }

    if (existingProgressId) {
      pendingLessonProgressResolution.delete(cacheKey);
    }

    const payload: Record<string, any> = {
      current_time_secs: Math.max(0, Math.floor(currentTimeSecs)),
      watch_percentage: Math.max(0, Math.min(100, Math.round(watchPercentage))),
      time_spent_secs: Math.max(0, Math.floor(currentTimeSecs)),
      last_watched_at: new Date().toISOString(),
    };

    if (isCompleted) {
      payload.is_completed = true;
    }

    if (existingProgressId) {
      await apiClient.patch(`/lesson-progress/${existingProgressId}`, payload);
      return;
    }

    try {
      const created = await apiClient.post<any>('/lesson-progress', {
        course_id: numCourseId,
        lesson_id: numLessonId,
        ...payload,
      });

      const createdId = findCreatedProgressId(created);

      if (createdId) {
        lessonProgressIdCache.set(cacheKey, createdId);
        pendingLessonProgressResolution.delete(cacheKey);
      } else {
        pendingLessonProgressResolution.add(cacheKey);

        const lookupSucceeded = await lookupCourseProgressIds(userId, numCourseId);
        const resolvedId = lessonProgressIdCache.get(cacheKey);

        if (resolvedId) {
          pendingLessonProgressResolution.delete(cacheKey);
        } else if (lookupSucceeded) {
          courseProgressLookupRetryAfter.set(courseKey, Date.now() + 30000);
        }
      }
    } catch (postErr: any) {
      if (postErr?.status === 409 || postErr?.statusCode === 409) {
        pendingLessonProgressResolution.add(cacheKey);

        const lookupSucceeded = await lookupCourseProgressIds(userId, numCourseId);
        const resolvedId = lessonProgressIdCache.get(cacheKey);

        if (resolvedId) {
          pendingLessonProgressResolution.delete(cacheKey);
          await apiClient.patch(`/lesson-progress/${resolvedId}`, payload);
        } else if (lookupSucceeded) {
          courseProgressLookupRetryAfter.set(courseKey, Date.now() + 30000);
        }
      } else {
        throw postErr;
      }
    }
  } catch (error: any) {
    console.error('[progress] upsert error', error);
    if (isAuthError(error)) emitSessionExpired();
  }
}

export function upsertLessonProgress(
  userId: string,
  courseId: string | number,
  lessonId: string | number,
  currentTimeSecs: number,
  watchPercentage: number,
): Promise<void> {
  const cacheKey = lessonProgressCacheKey(userId, courseId, lessonId);

  const update = { userId, courseId, lessonId, currentTimeSecs, watchPercentage };

  const existingRequest = lessonProgressUpsertInFlight.get(cacheKey);
  if (existingRequest) {
    // Keep the newest playback position for processing after the current request.
    pendingLessonProgressUpdates.set(cacheKey, update);
    return existingRequest;
  }

  let request: Promise<void>;

  request = (async () => {
    let nextUpdate: typeof update | undefined = update;

    while (nextUpdate) {
      await performUpsertLessonProgress(
        nextUpdate.userId,
        nextUpdate.courseId,
        nextUpdate.lessonId,
        nextUpdate.currentTimeSecs,
        nextUpdate.watchPercentage,
      );

      nextUpdate = pendingLessonProgressUpdates.get(cacheKey);
      pendingLessonProgressUpdates.delete(cacheKey);
    }
  })().finally(() => {
    if (lessonProgressUpsertInFlight.get(cacheKey) === request) {
      lessonProgressUpsertInFlight.delete(cacheKey);
    }
  });

  lessonProgressUpsertInFlight.set(cacheKey, request);
  return request;
}
/**
 * Fetches course-level progress via GET /lesson-progress/my/course/:courseId
 */
export async function fetchCourseProgress(
  _userId: string,
  courseId: string | number,
) {
  try {
    const res = await apiClient.get<any>(`/lesson-progress/my/course/${courseId}`);
    const data = res?.data || res;

    if (data && (data.total_lessons !== undefined || data.totalLessons !== undefined)) {
      const completed = data.completed_lessons ?? data.completedLessonsCount ?? 0;
      const total = data.total_lessons ?? data.totalLessons ?? 0;
      const percentage = data.completion_percentage ?? data.completionPercentage ?? 0;
      const watchMinutes =
        (data.lessons || []).reduce(
          (sum: number, l: any) => sum + (Number(l.progress?.time_spent_secs) || 0),
          0,
        ) / 60 || (data.totalTimeSpentSecs || 0) / 60;

      return { completed, total, percentage, watchMinutes };
    }

    return { completed: 0, total: 0, percentage: 0, watchMinutes: 0 };
  } catch (error) {
    console.warn('[progressStorage] fetchCourseProgress error, returning 0:', error);
    return { completed: 0, total: 0, percentage: 0, watchMinutes: 0 };
  }
}

/**
 * Fetches per-lesson progress for a course via GET /lesson-progress/my/course/:courseId
 */
export async function fetchCourseLessonsProgress(
  userId: string,
  courseId: string | number,
) {
  try {
    const res = await apiClient.get<any>(`/lesson-progress/my/course/${courseId}`);
    const data = res?.data || res;
    cacheCourseProgressIds(userId, courseId, data);

    if (data && Array.isArray(data.lessons)) {
      return data.lessons
        .filter((l: any) => l.progress != null)
        .map((l: any) => ({
          id: l.progress.id ? String(l.progress.id) : undefined,
          lesson_id: l.lesson_id,
          current_time_secs: Number(l.progress.current_time_secs) || 0,
          watch_percentage: Number(l.progress.watch_percentage) || 0,
          is_completed: Boolean(l.progress.is_completed),
          time_spent_secs: Number(l.progress.time_spent_secs) || 0,
          last_watched_at: l.progress.last_watched_at,
        }));
    }

    if (data && Array.isArray(data.lessonsProgress)) {
      return data.lessonsProgress.map((p: any) => ({
        id: p.id ? String(p.id) : undefined,
        lesson_id: p.lesson_id,
        current_time_secs: Number(p.current_time_secs) || 0,
        watch_percentage: Number(p.watch_percentage) || 0,
        is_completed: Boolean(p.is_completed),
        time_spent_secs: Number(p.time_spent_secs) || 0,
        last_watched_at: p.last_watched_at,
      }));
    }

    return [];
  } catch (error) {
    console.warn('[progressStorage] fetchCourseLessonsProgress error:', error);
    return [];
  }
}

/**
 * Fetches complete multi-course progress for student via backend APIs
 */
export async function fetchRemoteProgress(userId: string): Promise<UserCourseProgress[]> {
  try {
    const { fetchEnrolledCourses } = require('@/services/enrollmentService');
    const enrollments = await fetchEnrolledCourses(userId);

    if (!enrollments || !Array.isArray(enrollments)) return [];

    const results: UserCourseProgress[] = [];

    for (const enrollment of enrollments) {
      const courseId = String(enrollment.course_id || enrollment.courses?.id);
      if (!courseId) continue;

      const [modules, courseProgRes] = await Promise.all([
        getCourseModules(courseId).catch(() => []),
        apiClient.get<any>(`/lesson-progress/my/course/${courseId}`).catch(() => null),
      ]);

      const courseProgData = courseProgRes?.data || courseProgRes;
      const progressList: any[] =
        courseProgData?.lessonsProgress ||
        (courseProgData?.lessons
          ? courseProgData.lessons
              .filter((l: any) => l.progress != null)
              .map((l: any) => ({ ...l.progress, lesson_id: l.lesson_id }))
          : []);

      const courseProgressObj: UserCourseProgress = {
        userId,
        courseId,
        progress: courseProgData?.completionPercentage || 0,
        enrolledAt: enrollment.enrolled_at || new Date().toISOString(),
        lastAccessedAt: enrollment.enrolled_at || new Date().toISOString(),
        completedAt: enrollment.completed_at || undefined,
        totalTimeSpent: courseProgData?.totalTimeSpentSecs || 0,
        modules: {},
      };

      (modules || []).forEach((mod: any) => {
        const modLessons = mod.lessons ?? [];
        let modTimeSpent = 0;
        let modLastAccessed = enrollment.enrolled_at || new Date().toISOString();
        let modIsCompleted = modLessons.length > 0;
        let modIsStarted = false;

        modLessons.forEach((les: any) => {
          const lp = progressList.find((p) => String(p.lesson_id) === String(les.id));
          if (lp) {
            modTimeSpent += lp.time_spent_secs || 0;
            if (lp.last_watched_at && new Date(lp.last_watched_at) > new Date(modLastAccessed)) {
              modLastAccessed = lp.last_watched_at;
            }
            if (!lp.is_completed) {
              modIsCompleted = false;
            }
            if (lp.watch_percentage > 0) {
              modIsStarted = true;
            }
          } else {
            modIsCompleted = false;
          }
        });

        if (modLessons.length === 0) {
          modIsCompleted = false;
          modIsStarted = false;
        }

        const firstLesson = modLessons[0];
        const lastWatchedLesson =
          modLessons.find((les: any) => {
            const lp = progressList.find((p) => String(p.lesson_id) === String(les.id));
            return lp && !lp.is_completed;
          }) || firstLesson;

        const lp = lastWatchedLesson
          ? progressList.find((p) => String(p.lesson_id) === String(lastWatchedLesson.id))
          : null;

        courseProgressObj.modules[mod.id] = {
          moduleId: mod.id,
          isCompleted: modIsCompleted,
          isStarted: modIsStarted,
          videoProgress: {
            videoUrl: lastWatchedLesson?.video_url || "",
            currentTime: lp?.current_time_secs || 0,
            duration: lp?.current_time_secs
              ? Math.round(lp.current_time_secs / ((lp.watch_percentage || 1) / 100))
              : 0,
            watchedPercentage: lp?.watch_percentage || 0,
            isCompleted: lp?.is_completed || false,
            lastWatchedAt: lp?.last_watched_at || modLastAccessed,
          },
          lastAccessedAt: modLastAccessed,
          completedAt: modIsCompleted ? modLastAccessed : undefined,
          timeSpent: modTimeSpent,
          totalLessons: modLessons.length,
          completedLessons: modLessons.filter((les: any) => {
            const p = progressList.find((x) => String(x.lesson_id) === String(les.id));
            return p && p.is_completed;
          }).length,
        };

        if (new Date(modLastAccessed) > new Date(courseProgressObj.lastAccessedAt)) {
          courseProgressObj.lastAccessedAt = modLastAccessed;
        }
      });

      // Save to local ProgressStorage for offline support
      await ProgressStorage.saveCourseProgress(courseProgressObj);
      results.push(courseProgressObj);
    }

    return results;
  } catch (err) {
    console.error('[progressStorage] fetchRemoteProgress failed:', err);
    return [];
  }
}
