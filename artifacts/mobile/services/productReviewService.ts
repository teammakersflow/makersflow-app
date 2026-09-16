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

export interface ProductReview {
  id: string;
  user_id: string;
  product_id: number;
  rating: number;
  comment: string | null;
  status?: "pending" | "approved" | "rejected";
  created_at: string;
  user?: {
    id: string;
    email?: string | null;
    full_name?: string | null;
  } | null;
}

export interface ProductRatingItem {
  product_id: number;
  rating: number;
}

/**
 * Fetch all approved reviews for a product, newest first via GET /reviews/product/:productId.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function fetchProductReviews(productId: string | number): Promise<ProductReview[]> {
  const numericProductId = Number(productId);
  try {
    const res = await apiClient.get<any>(`/reviews/product/${encodeURIComponent(String(productId))}`);
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;
    const list = Array.isArray(raw) ? raw : [];

    return list.map((r: any) => {
      const userInfo = r.users || r.user || (r.user_id ? { id: String(r.user_id) } : null);
      return {
        id: String(r.id),
        user_id: String(r.user_id),
        product_id: Number(r.product_id),
        rating: Number(r.rating) || 5,
        comment: r.comment ?? null,
        status: r.status,
        created_at: r.created_at || new Date().toISOString(),
        user: userInfo,
      };
    });
  } catch (error: any) {
    if (!isNetworkOrUnavailable(error)) {
      console.warn(`[ProductReviewService] Backend /reviews/product/${productId} application error:`, error?.message || error);
      return [];
    }

    console.warn(`[ProductReviewService] Backend unavailable, attempting Supabase fallback for product reviews ${productId}:`, error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("product_reviews")
        .select("id, user_id, product_id, rating, comment, status, created_at")
        .eq("product_id", numericProductId)
        .eq("status", "approved")
        .order("created_at", { ascending: false });

      if (sbError) {
        console.warn("[ProductReviewService] Supabase product reviews fallback error:", sbError);
        return [];
      }

      return (data || []).map((r: any) => ({
        id: String(r.id),
        user_id: String(r.user_id),
        product_id: Number(r.product_id),
        rating: Number(r.rating) || 5,
        comment: r.comment ?? null,
        status: r.status,
        created_at: r.created_at || new Date().toISOString(),
        user: { id: String(r.user_id) },
      }));
    } catch (fallbackErr) {
      console.warn("[ProductReviewService] Supabase product reviews fallback unexpected error:", fallbackErr);
      return [];
    }
  }
}

/**
 * Fetch the current student's review for a product (or null) via GET /reviews/product/:productId/my.
 * Student identity is derived exclusively from JWT.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function fetchMyProductReview(
  userId?: string,
  productId?: string | number,
): Promise<ProductReview | null> {
  if (!productId) return null;
  const numericProductId = Number(productId);

  try {
    const res = await apiClient.get<any>(`/reviews/product/${encodeURIComponent(String(productId))}/my`);
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;

    if (!raw || typeof raw !== "object" || !raw.id) {
      return null;
    }

    const userInfo = raw.users || raw.user || (raw.user_id ? { id: String(raw.user_id) } : null);
    return {
      id: String(raw.id),
      user_id: String(raw.user_id),
      product_id: Number(raw.product_id),
      rating: Number(raw.rating) || 5,
      comment: raw.comment ?? null,
      status: raw.status,
      created_at: raw.created_at || new Date().toISOString(),
      user: userInfo,
    };
  } catch (error: any) {
    if (!isNetworkOrUnavailable(error)) {
      console.warn(`[ProductReviewService] Backend /reviews/product/${productId}/my application error:`, error?.message || error);
      return null;
    }

    if (!userId) return null;

    console.warn(`[ProductReviewService] Backend unavailable, attempting Supabase fallback for my product review ${productId}:`, error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("product_reviews")
        .select("id, user_id, product_id, rating, comment, status, created_at")
        .eq("product_id", numericProductId)
        .eq("user_id", userId)
        .maybeSingle();

      if (sbError || !data) return null;

      return {
        id: String(data.id),
        user_id: String(data.user_id),
        product_id: Number(data.product_id),
        rating: Number(data.rating) || 5,
        comment: data.comment ?? null,
        status: data.status,
        created_at: data.created_at || new Date().toISOString(),
        user: { id: String(data.user_id) },
      };
    } catch (fallbackErr) {
      console.warn("[ProductReviewService] Supabase my product review fallback unexpected error:", fallbackErr);
      return null;
    }
  }
}

/**
 * Insert or update current student's review for a product via POST /reviews/product/:productId.
 * Student identity is derived exclusively from JWT on the backend.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function upsertProductReview(
  userId: string | undefined,
  productId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  const numericProductId = Number(productId);

  try {
    await apiClient.post<any>(`/reviews/product/${encodeURIComponent(String(productId))}`, {
      rating: Math.round(rating),
      comment: comment?.trim() || undefined,
    });
    // On success: do NOT write to Supabase (no dual writes)
  } catch (error: any) {
    if (!isNetworkOrUnavailable(error)) {
      // Real application/validation error: rethrow directly
      console.error(`[ProductReviewService] upsertProductReview application error for ${productId}:`, error?.message || error);
      throw error;
    }

    console.warn(`[ProductReviewService] Backend unavailable on upsertProductReview for ${productId}, attempting bounded Supabase fallback:`, error?.message || error);
    if (!userId) {
      throw error;
    }

    const { error: sbError } = await supabase
      .from("product_reviews")
      .upsert(
        {
          user_id: userId,
          product_id: numericProductId,
          rating: Math.round(rating),
          comment: comment?.trim() || null,
          status: "pending",
        },
        { onConflict: "user_id,product_id" }
      );

    if (sbError) {
      console.error("[ProductReviewService] Supabase upsertProductReview fallback error:", sbError);
      throw sbError;
    }
  }
}

/**
 * Fetch lightweight product ratings summary via GET /reviews/ratings/products.
 * Normalizes backend Prisma groupBy format (_avg, _count) into compatible individual entries.
 * Falls back to Supabase only on genuine backend/network unavailability.
 */
export async function fetchProductRatingsSummary(): Promise<ProductRatingItem[]> {
  try {
    const res = await apiClient.get<any>("/reviews/ratings/products");
    const raw = res?.data !== undefined && res?.success !== undefined ? res.data : res;
    const list = Array.isArray(raw) ? raw : [];

    const items: ProductRatingItem[] = [];
    list.forEach((entry: any) => {
      const pId = Number(entry.product_id);
      const avg = entry._avg?.rating != null ? Number(entry._avg.rating) : Number(entry.rating) || 0;
      const count = entry._count?.id != null ? Number(entry._count.id) : 1;

      if (count > 0 && avg > 0) {
        for (let i = 0; i < count; i++) {
          items.push({ product_id: pId, rating: avg });
        }
      } else if (avg > 0) {
        items.push({ product_id: pId, rating: avg });
      }
    });

    return items;
  } catch (error: any) {
    if (!isNetworkOrUnavailable(error)) {
      console.warn("[ProductReviewService] Backend /reviews/ratings/products application error:", error?.message || error);
      return [];
    }

    console.warn("[ProductReviewService] Backend unavailable, attempting Supabase fallback for product ratings summary:", error?.message || error);
    try {
      const { data, error: sbError } = await supabase
        .from("product_reviews")
        .select("product_id, rating")
        .eq("status", "approved");

      if (sbError) {
        console.warn("[ProductReviewService] Supabase product ratings summary fallback error:", sbError);
        return [];
      }

      return (data || []).map((r: any) => ({
        product_id: Number(r.product_id),
        rating: Number(r.rating) || 0,
      }));
    } catch (fallbackErr) {
      console.warn("[ProductReviewService] Supabase product ratings fallback unexpected error:", fallbackErr);
      return [];
    }
  }
}
