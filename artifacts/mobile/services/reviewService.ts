import { apiClient } from "@/lib/auth/apiClient";

export interface Review {
  id: string;
  user_id: string;
  course_id: number;
  rating: number;
  comment: string | null;
  status?: "pending" | "approved" | "rejected";
  created_at: string;
  user?: {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

export interface CourseRatingItem {
  course_id: number;
  rating: number;
}

/**
 * Fetch all reviews for a course, newest first via GET /reviews/course/:courseId
 */
export async function fetchCourseReviews(courseId: string | number): Promise<Review[]> {
  try {
    const res = await apiClient.get<any>(`/reviews/course/${courseId}`);
    const data = res?.data || res;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`[ReviewService] fetchCourseReviews error for ${courseId}:`, error);
    return [];
  }
}

/**
 * Fetch the current authenticated student's review for a course (or null) via GET /reviews/course/:courseId/my.
 * Student identity is derived exclusively from JWT.
 */
export async function fetchMyReview(
  _userId?: string,
  courseId?: string | number,
): Promise<Review | null> {
  if (!courseId) return null;
  try {
    const res = await apiClient.get<any>(`/reviews/course/${courseId}/my`);
    const data = res?.data !== undefined ? res.data : res;
    return data || null;
  } catch (error) {
    console.error(`[ReviewService] fetchMyReview error for ${courseId}:`, error);
    return null;
  }
}

/**
 * Insert or update current student's review for a course via POST /reviews/course/:courseId.
 * Student identity is derived exclusively from JWT.
 */
export async function upsertReview(
  _userId: string | undefined,
  courseId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  try {
    await apiClient.post<any>(`/reviews/course/${courseId}`, {
      rating,
      comment: comment?.trim() || undefined,
    });
  } catch (error) {
    console.error(`[ReviewService] upsertReview error for ${courseId}:`, error);
    throw error;
  }
}

/**
 * Fetch lightweight course ratings summary via GET /reviews/ratings/courses
 */
export async function fetchCourseRatingsSummary(): Promise<CourseRatingItem[]> {
  try {
    const res = await apiClient.get<any>('/reviews/ratings/courses');
    const data = res?.data || res;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[ReviewService] fetchCourseRatingsSummary error:', error);
    return [];
  }
}
