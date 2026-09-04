import { apiClient } from "@/lib/auth/apiClient";

export interface WishlistItem {
  id: string;
  user_id?: string;
  product_id: number | string;
  created_at?: string;
  product?: any;
}

export interface WishlistApiResponse {
  success?: boolean;
  message?: string;
  data?: WishlistItem[] | number[] | string[] | any;
}

/**
 * Canonical Wishlist Service for MakersFlow Mobile App.
 *
 * All requests route through `apiClient.ts` which automatically:
 * - Injects JWT Bearer authorization headers from SecureStore token storage.
 * - Handles token refresh on 401 Unauthorized responses.
 * - Derives student identity securely on the backend from the authenticated JWT.
 * - NEVER sends or accepts client-provided `userId` / `user_id`.
 */
export const wishlistService = {
  /**
   * Fetch the current authenticated student's wishlisted product IDs.
   * Endpoint: GET /wishlist/me or GET /wishlist
   */
  async getWishlist(): Promise<string[]> {
    try {
      const res = await apiClient.get<WishlistApiResponse | WishlistItem[] | any>('/wishlist/me');
      const payload = res?.data ?? res;

      if (Array.isArray(payload)) {
        return payload.map((item: any) => {
          if (typeof item === 'object' && item !== null) {
            return String(item.product_id ?? item.productId ?? item.id);
          }
          return String(item);
        });
      }

      if (payload && Array.isArray(payload.items)) {
        return payload.items.map((item: any) => {
          if (typeof item === 'object' && item !== null) {
            return String(item.product_id ?? item.productId ?? item.id);
          }
          return String(item);
        });
      }

      return [];
    } catch (error: any) {
      console.warn('[WishlistService] Failed to fetch wishlist from backend:', error?.message || error);
      return [];
    }
  },

  /**
   * Add a product to the authenticated student's wishlist.
   * Endpoint: POST /wishlist/:productId
   */
  async addToWishlist(productId: string | number): Promise<void> {
    try {
      await apiClient.post(`/wishlist/${productId}`);
    } catch (error: any) {
      console.error('[WishlistService] Failed to add product to wishlist:', error?.message || error);
      throw error;
    }
  },

  /**
   * Remove a product from the authenticated student's wishlist.
   * Endpoint: DELETE /wishlist/:productId
   */
  async removeFromWishlist(productId: string | number): Promise<void> {
    try {
      await apiClient.delete(`/wishlist/${productId}`);
    } catch (error: any) {
      console.error('[WishlistService] Failed to remove product from wishlist:', error?.message || error);
      throw error;
    }
  },

  /**
   * Helper to toggle wishlist state for a product.
   * Returns the new wishlisted boolean state.
   */
  async toggleWishlist(productId: string | number, isCurrentlyWishlisted: boolean): Promise<boolean> {
    if (isCurrentlyWishlisted) {
      await this.removeFromWishlist(productId);
      return false;
    } else {
      await this.addToWishlist(productId);
      return true;
    }
  },
};

