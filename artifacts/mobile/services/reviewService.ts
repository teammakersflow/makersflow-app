import { apiClient, ApiError } from "@/lib/auth/apiClient";
import { supabase } from "@/lib/supabase";

function isNetworkOrUnavailable(err: any): boolean {
  if (!err) return false;
  if (err instanceof ApiError) {
    return (
      err.status === 0 ||
      err.status === 408 ||
      err.status === 502 ||
      err.status === 503 ||
      err.status === 504
    );
  }
  return (
    err.name === "AbortError" ||
    (typeof err.message === "string" &&
      (err.message.toLowerCase().includes("network") ||
        err.message.toLowerCase().includes("failed to fetch")))
  );
}

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
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function fetchCourseReviews(courseId: string | number): Promise<Review[]> {
  const numericCourseId = Number(courseId);
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
    if (!isNetworkOrUnavailable(error)) {
      console.warn(`[ReviewService] Backend /reviews/course/${courseId} application error:`, error?.message || error);
      return [];
    }

    console.warn(`[ReviewService] Backend unavailable, attempting Supabase fallback for course reviews ${courseId}:`, error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("reviews")
        .select("id, user_id, course_id, rating, comment, status, created_at, users!user_id(id, full_name, avatar_url)")
        .eq("course_id", numericCourseId)
        .eq("status", "approved")
        .order("created_at", { ascending: false });

      if (sbError) {
        console.warn("[ReviewService] Supabase course reviews fallback error:", sbError);
        return [];
      }

      return (data || []).map((r: any) => {
        const userInfo = r.users || null;
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
    } catch (fallbackErr) {
      console.warn("[ReviewService] Supabase course reviews fallback unexpected error:", fallbackErr);
      return [];
    }
  }
}

/**
 * Fetch the current authenticated student's review for a course (or null) via GET /reviews/course/:courseId/my.
 * Student identity is derived exclusively from JWT.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function fetchMyReview(
  userId?: string,
  courseId?: string | number,
): Promise<Review | null> {
  if (!courseId) return null;
  const numericCourseId = Number(courseId);

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
    if (!isNetworkOrUnavailable(error)) {
      console.warn(`[ReviewService] Backend /reviews/course/${courseId}/my application error:`, error?.message || error);
      return null;
    }

    if (!userId) return null;

    console.warn(`[ReviewService] Backend unavailable, attempting Supabase fallback for my review ${courseId}:`, error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("reviews")
        .select("id, user_id, course_id, rating, comment, status, created_at")
        .eq("course_id", numericCourseId)
        .eq("user_id", userId)
        .maybeSingle();

      if (sbError || !data) return null;

      return {
        id: String(data.id),
        user_id: String(data.user_id),
        course_id: Number(data.course_id),
        rating: Number(data.rating) || 5,
        comment: data.comment ?? null,
        status: data.status,
        created_at: data.created_at || new Date().toISOString(),
        user: null,
        users: null,
      };
    } catch (fallbackErr) {
      console.warn("[ReviewService] Supabase my review fallback unexpected error:", fallbackErr);
      return null;
    }
  }
}

/**
 * Insert or update current student's review for a course via POST /reviews/course/:courseId.
 * Student identity is derived exclusively from JWT on the backend.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function upsertReview(
  userId: string | undefined,
  courseId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  const numericCourseId = Number(courseId);

  try {
    await apiClient.post<any>(`/reviews/course/${encodeURIComponent(String(courseId))}`, {
      rating: Math.round(rating),
      comment: comment?.trim() || undefined,
    });
    // On success: do NOT write to Supabase (no dual writes)
  } catch (error: any) {
    if (!isNetworkOrUnavailable(error)) {
      // Real application/validation error: rethrow directly
      console.error(`[ReviewService] upsertReview application error for ${courseId}:`, error?.message || error);
      throw error;
    }

    console.warn(`[ReviewService] Backend unavailable on upsertReview for ${courseId}, attempting bounded Supabase fallback:`, error?.message || error);
    if (!userId) {
      throw error;
    }

    const { error: sbError } = await supabase
      .from("reviews")
      .upsert(
        {
          user_id: userId,
          course_id: numericCourseId,
          rating: Math.round(rating),
          comment: comment?.trim() || null,
          status: "pending",
        },
        { onConflict: "user_id,course_id" }
      );

    if (sbError) {
      console.error("[ReviewService] Supabase upsertReview fallback error:", sbError);
      throw sbError;
    }
  }
}

/**
 * Fetch lightweight course ratings summary via GET /reviews/ratings/courses.
 * Normalizes backend Prisma groupBy format (_avg, _count) into compatible individual entries.
 * Falls back to Supabase only on genuine backend/network unavailability.
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
    if (!isNetworkOrUnavailable(error)) {
      console.warn("[ReviewService] Backend /reviews/ratings/courses application error:", error?.message || error);
      return [];
    }

    console.warn("[ReviewService] Backend unavailable, attempting Supabase fallback for course ratings summary:", error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("reviews")
        .select("course_id, rating")
        .eq("status", "approved");

      if (sbError) {
        console.warn("[ReviewService] Supabase course ratings summary fallback error:", sbError);
        return [];
      }

      return (data || []).map((r: any) => ({
        course_id: Number(r.course_id),
        rating: Number(r.rating) || 0,
      }));
    } catch (fallbackErr) {
      console.warn("[ReviewService] Supabase course ratings fallback unexpected error:", fallbackErr);
      return [];
    }
  }
}
