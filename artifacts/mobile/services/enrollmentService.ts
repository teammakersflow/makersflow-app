import { apiClient } from '@/lib/auth/apiClient';

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
 * Fetches all active/valid enrollments for the authenticated student via GET /enrollments/my.
 * Identity is derived purely from JWT.
 */
export async function fetchEnrolledCourses(userId?: string) {
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
    const REJECTED_PAYMENT_STATES = ['pending', 'failed', 'cancelled', 'refunded'];

    const enrollments = (Array.isArray(data) ? data : []).filter((enr: any) => {
      if (!enr || !enr.courses) return false;
      if (enr.courses.is_free === true) return true;
      const status = enr.payment_status;
      if (status == null) return true;
      return !REJECTED_PAYMENT_STATES.includes(status);
    });

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
 * Checks if the authenticated student is actively enrolled in a course.
 */
export async function isEnrolled(userId?: string, courseId?: string | number): Promise<boolean> {
  if (!courseId) return false;

  const enrollments = await fetchEnrolledCourses(userId);
  const match = enrollments.find(
    (enr: any) => String(enr.course_id) === String(courseId) || String(enr.courses?.id) === String(courseId),
  );

  if (!match) return false;

  return (
    ['completed', 'free', 'paid'].includes(match.payment_status) ||
    match.courses?.is_free === true
  );
}
/**
 * Gets enrollment details for the authenticated student and course.
 */
export async function getEnrollment(userId?: string, courseId?: string | number) {
  if (!courseId) return null;

  const enrollments = await fetchEnrolledCourses(userId);
  return (
    enrollments.find(
      (enr: any) => String(enr.course_id) === String(courseId) || String(enr.courses?.id) === String(courseId),
    ) || null
  );
}
export function isExpired(enrollment: any): boolean {
  if (!enrollment || !enrollment.expires_at) return false;
  const expiryDate = new Date(enrollment.expires_at);
  return expiryDate.getTime() < Date.now();
}

/**
 * Marks course completion if supported. In the backend, course completion is automatically
 * triggered upon 100% lesson progress sync.
 */
export async function completeCourse(_userId?: string, _courseId?: string | number) {
  await invalidateCaches();
}
