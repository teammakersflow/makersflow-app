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
  } | null;
}

export interface ProductRatingItem {
  product_id: number;
  rating: number;
}

/**
 * Fetch all reviews for a product, newest first via GET /reviews/product/:productId
 */
export async function fetchProductReviews(productId: string | number): Promise<ProductReview[]> {
  try {
    const res = await apiClient.get<any>(`/reviews/product/${productId}`);
    const data = res?.data || res;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`[ProductReviewService] fetchProductReviews error for ${productId}:`, error);
    return [];
  }
}

/**
 * Fetch the current student's review for a product (or null) via GET /reviews/product/:productId/my.
 * Student identity is derived exclusively from JWT.
 */
export async function fetchMyProductReview(
  _userId?: string,
  productId?: string | number,
): Promise<ProductReview | null> {
  if (!productId) return null;
  try {
    const res = await apiClient.get<any>(`/reviews/product/${productId}/my`);
    const data = res?.data !== undefined ? res.data : res;
    return data || null;
  } catch (error) {
    console.error(`[ProductReviewService] fetchMyProductReview error for ${productId}:`, error);
    return null;
  }
}

/**
 * Insert or update current student's review for a product via POST /reviews/product/:productId.
 * Student identity is derived exclusively from JWT.
 */
export async function upsertProductReview(
  _userId: string | undefined,
  productId: string | number,
  rating: number,
  comment: string,
): Promise<void> {
  try {
    await apiClient.post<any>(`/reviews/product/${productId}`, {
      rating,
      comment: comment?.trim() || undefined,
    });
  } catch (error) {
    console.error(`[ProductReviewService] upsertProductReview error for ${productId}:`, error);
    throw error;
  }
}

/**
 * Fetch lightweight product ratings summary via GET /reviews/ratings/products
 */
export async function fetchProductRatingsSummary(): Promise<ProductRatingItem[]> {
  try {
    const res = await apiClient.get<any>('/reviews/ratings/products');
    const data = res?.data || res;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[ProductReviewService] fetchProductRatingsSummary error:', error);
    return [];
  }
}
