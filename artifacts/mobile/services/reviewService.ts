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
  users?: {
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
 * Fetch all approved reviews for a course, newest first via GET /reviews/course/:courseId.
 * Source of truth: Backend (6) REST API.
 */
export async function fetchCourseReviews(courseId: string | number): Promise<Review[]> {
  try {
    const res = await apiClient.get<any>(`/reviews/course/${encodeURIComponent(String(courseId))}`);
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;
    const list = Array.isArray(raw) ? raw : [];

    return list.map((r: any) => {
      const userInfo = r.users || r.user || null;
      return {
        id: String(r.id),
        user_id: String(r.user_id),
        course_id: Number(r.course_id),
        rating: Number(r.rating) || 5,
        comment: r.comment ?? null,
        status: r.status,
        created_at: r.created_at || new Date().toISOString(),
        user: userInfo,
        users: userInfo,
      };
    });
  } catch (error: any) {
    console.warn(`[ReviewService] Backend /reviews/course/${courseId} error:`, error?.message || error);
    return [];
  }
}

/**
 * Fetch the current authenticated student's review for a course (or null) via GET /reviews/course/:courseId/my.
 * Student identity is derived exclusively from JWT on Backend (6).
 */
export async function fetchMyReview(
  _userId?: string,
  courseId?: string | number,
): Promise<Review | null> {
  if (!courseId) return null;

  try {
    const res = await apiClient.get<any>(`/reviews/course/${encodeURIComponent(String(courseId))}/my`);
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;

    if (!raw || typeof raw !== "object" || !raw.id) {
      return null;
    }

    const userInfo = raw.users || raw.user || null;
    return {
      id: String(raw.id),
      user_id: String(raw.user_id),
      course_id: Number(raw.course_id),
      rating: Number(raw.rating) || 5,
      comment: raw.comment ?? null,
      status: raw.status,
      created_at: raw.created_at || new Date().toISOString(),
      user: userInfo,
      users: userInfo,
    };
  } catch (error: any) {
    console.warn(`[ReviewService] Backend /reviews/course/${courseId}/my error:`, error?.message || error);
    return null;
  }
}

/**
 * Insert or update current student's review for a course via POST /reviews/course/:courseId.
 * Student identity is derived exclusively from JWT on Backend (6).
 */
export async function upsertReview(
  _userId: string | undefined,
  courseId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  try {
    await apiClient.post<any>(`/reviews/course/${encodeURIComponent(String(courseId))}`, {
      rating: Math.round(rating),
      comment: comment?.trim() || undefined,
    });
  } catch (error: any) {
    console.error(`[ReviewService] upsertReview error for ${courseId}:`, error?.message || error);
    throw error;
  }
}

/**
 * Fetch lightweight course ratings summary via GET /reviews/ratings/courses.
 * Normalizes backend Prisma groupBy format (_avg, _count) into compatible individual entries.
 */
export async function fetchCourseRatingsSummary(): Promise<CourseRatingItem[]> {
  try {
    const res = await apiClient.get<any>("/reviews/ratings/courses");
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;
    const list = Array.isArray(raw) ? raw : [];

    const items: CourseRatingItem[] = [];
    list.forEach((entry: any) => {
      const cId = Number(entry.course_id);
      const avg = entry._avg?.rating != null ? Number(entry._avg.rating) : Number(entry.rating) || 0;
      const count = entry._count?.id != null ? Number(entry._count.id) : 1;

      if (count > 0 && avg > 0) {
        for (let i = 0; i < count; i++) {
          items.push({ course_id: cId, rating: avg });
        }
      } else if (avg > 0) {
        items.push({ course_id: cId, rating: avg });
      }
    });

    return items;
  } catch (error: any) {
    console.warn("[ReviewService] Backend /reviews/ratings/courses error:", error?.message || error);
    return [];
  }
}
