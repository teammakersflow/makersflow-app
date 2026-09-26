import { apiClient } from "@/lib/auth/apiClient";

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
 * Source of truth: Backend (6) REST API.
 */
export async function fetchProductReviews(productId: string | number): Promise<ProductReview[]> {
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
    console.warn(`[ProductReviewService] Backend /reviews/product/${productId} error:`, error?.message || error);
    return [];
  }
}

/**
 * Fetch the current student's review for a product (or null) via GET /reviews/product/:productId/my.
 * Student identity is derived exclusively from JWT on Backend (6).
 */
export async function fetchMyProductReview(
  _userId?: string,
  productId?: string | number,
): Promise<ProductReview | null> {
  if (!productId) return null;

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
    console.warn(`[ProductReviewService] Backend /reviews/product/${productId}/my error:`, error?.message || error);
    return null;
  }
}

/**
 * Insert or update current student's review for a product via POST /reviews/product/:productId.
 * Student identity is derived exclusively from JWT on the backend.
 */
export async function upsertProductReview(
  _userId: string | undefined,
  productId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  try {
    await apiClient.post<any>(`/reviews/product/${encodeURIComponent(String(productId))}`, {
      rating: Math.round(rating),
      comment: comment?.trim() || undefined,
    });
  } catch (error: any) {
    console.error(`[ProductReviewService] upsertProductReview error for ${productId}:`, error?.message || error);
    throw error;
  }
}

/**
 * Fetch lightweight product ratings summary via GET /reviews/ratings/products.
 * Normalizes backend Prisma groupBy format (_avg, _count) into compatible individual entries.
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
    console.warn("[ProductReviewService] Backend /reviews/ratings/products error:", error?.message || error);
    return [];
  }
}
