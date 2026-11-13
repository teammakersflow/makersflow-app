import { apiClient } from '@/lib/auth/apiClient';
import { expiryBlocksAccess, hasActiveAccess } from '@/lib/courseAccess';
import { markProgressChanged } from '@/lib/courseCompletion';

const ENROLLMENT_CACHE_TTL_MS = 10000;
let enrollmentCacheGeneration = 0;
const enrollmentCache = new Map<string, { data: any[]; timestamp: number }>();
const enrollmentRequests = new Map<string, Promise<any[]>>();

export function clearEnrollmentCache() {
  enrollmentCacheGeneration += 1;
  enrollmentCache.clear();
  enrollmentRequests.clear();
}

async function invalidateCaches() {
  clearEnrollmentCache();
  // Tab screens keep data in memory; this makes them reload on next focus.
  markProgressChanged();
  try {
    const { homeRepository } = require('@/repositories/homeRepository');
    const { coursesRepository } = require('@/repositories/coursesRepository');
    await Promise.all([
      homeRepository.invalidateProgressCache?.().catch(() => {}),
      coursesRepository.invalidateEnrollmentsCache?.().catch(() => {}),
    ]);
  } catch (e) {
    // non-fatal
  }
}

/**
 * Enrolls authenticated student in a free course via backend student-scoped API.
 * Identity is derived purely from JWT bearer token.
 */
export async function enrollInCourse(
  _userId?: string,
  courseId?: string | number,
  _isFree = true,
) {
  if (!courseId) throw new Error('courseId is required for enrollment');

  try {
    const res = await apiClient.post('/enrollments/free', {
      course_id: Number(courseId),
    });

    await invalidateCaches();
    return res?.data || res;
  } catch (error: any) {
    console.error('[EnrollmentService] enrollInCourse error:', error);
    throw error;
  }
}

/**
 * Fetches ALL of the student's enrollment rows via GET /enrollments/my,
 * including pending, expired and refunded ones. Used where the UI needs to
 * explain why access is missing (course page CTA, learn screen banner).
 * Identity is derived purely from JWT.
 */
async function fetchAllMyEnrollments(): Promise<any[]> {
  const cacheKey = '__authenticated__';
  const cached = enrollmentCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < ENROLLMENT_CACHE_TTL_MS) {
    return cached.data;
  }

  const existingRequest = enrollmentRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const generation = enrollmentCacheGeneration;

  const request = (async () => {
    const res = await apiClient.get<any>('/enrollments/my');
    const data = res?.data || res || [];

    const enrollments = (Array.isArray(data) ? data : []).filter(
      (enr: any) => !!enr && !!enr.courses,
    );

    if (generation === enrollmentCacheGeneration) {
      enrollmentCache.set(cacheKey, {
        data: enrollments,
        timestamp: Date.now(),
      });
    }

    return enrollments;
  })();

  enrollmentRequests.set(cacheKey, request);

  try {
    return await request;
  } finally {
    if (enrollmentRequests.get(cacheKey) === request) {
      enrollmentRequests.delete(cacheKey);
    }
  }
}
/**
 * Enrollments that grant access RIGHT NOW (My Courses, progress, home,
 * achievements). Same rule as the backend (B-2): payment_status in
 * completed/paid/free and not expired, free courses included. Expired,
 * pending, failed and refunded rows are never shown as active access.
 */
export async function fetchEnrolledCourses(_userId?: string) {
  const all = await fetchAllMyEnrollments();
  return all.filter((enr: any) => hasActiveAccess(enr, enr.courses));
}

/**
 * Checks if the authenticated student is actively enrolled in a course.
 */
export async function isEnrolled(userId?: string, courseId?: string | number): Promise<boolean> {
  if (!courseId) return false;
  const match = await getEnrollment(userId, courseId);
  return hasActiveAccess(match, match?.courses);
}
/**
 * Gets the student's enrollment row for a course, active or not (callers
 * decide with hasActiveAccess / decideCourseCta), or null if there is none.
 */
export async function getEnrollment(_userId?: string, courseId?: string | number) {
  if (!courseId) return null;

  const enrollments = await fetchAllMyEnrollments();
  return (
    enrollments.find(
      (enr: any) => String(enr.course_id) === String(courseId) || String(enr.courses?.id) === String(courseId),
    ) || null
  );
}
/**
 * True when the enrollment's expiry should block access in the UI (learn
 * screen banner, course page). Follows ENFORCE_ENROLLMENT_EXPIRY in
 * lib/courseAccess.ts, which is OFF (owner decision 2026-11-12), so this is
 * false for every enrollment for now, matching the backend.
 */
export function isExpired(enrollment: any): boolean {
  return expiryBlocksAccess(enrollment, Date.now());
}

/**
 * Called after the learner finishes the last lesson. There is no student API
 * that stamps enrollments.completed_at (only the admin PATCH does), so this
 * does not write anything: the app derives completion from lesson progress
 * (lib/courseCompletion.ts). It only drops cached enrollment/progress data so
 * every screen picks up the finished course.
 */
export async function completeCourse(_userId?: string, _courseId?: string | number) {
  await invalidateCaches();
}
