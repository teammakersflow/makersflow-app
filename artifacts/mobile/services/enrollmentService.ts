import { apiClient } from '@/lib/auth/apiClient';

async function invalidateCaches() {
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
    let res: any;
    try {
      res = await apiClient.post('/enrollments/free', { course_id: Number(courseId) });
    } catch {
      res = await apiClient.post(`/courses/${courseId}/enroll`);
    }
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
export async function fetchEnrolledCourses(_userId?: string) {
  try {
    let res: any;
    try {
      res = await apiClient.get<any>('/enrollments/my');
    } catch {
      res = await apiClient.get<any>('/enrollments/me');
    }
    const data = res?.data || res || [];

    const REJECTED_PAYMENT_STATES = ['pending', 'failed', 'cancelled', 'refunded'];

    return (Array.isArray(data) ? data : []).filter((enr: any) => {
      if (!enr || !enr.courses) return false;
      if (enr.courses.is_free === true) return true;
      const status = enr.payment_status;
      if (status == null) return true;
      return !REJECTED_PAYMENT_STATES.includes(status);
    });
  } catch (error: any) {
    console.warn('[EnrollmentService] fetchEnrolledCourses error, returning empty list:', error);
    return [];
  }
}

/**
 * Checks if the authenticated student is actively enrolled in a course.
 */
export async function isEnrolled(_userId?: string, courseId?: string | number): Promise<boolean> {
  if (!courseId) return false;
  try {
    const enrollments = await fetchEnrolledCourses(_userId);
    const match = enrollments.find(
      (enr: any) => String(enr.course_id) === String(courseId) || String(enr.courses?.id) === String(courseId),
    );
    if (!match) return false;
    return (
      ['completed', 'free', 'paid'].includes(match.payment_status) ||
      match.courses?.is_free === true
    );
  } catch {
    return false;
  }
}

/**
 * Gets enrollment details for the authenticated student and course.
 */
export async function getEnrollment(_userId?: string, courseId?: string | number) {
  if (!courseId) return null;
  try {
    const enrollments = await fetchEnrolledCourses(_userId);
    return (
      enrollments.find(
        (enr: any) => String(enr.course_id) === String(courseId) || String(enr.courses?.id) === String(courseId),
      ) || null
    );
  } catch {
    return null;
  }
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
