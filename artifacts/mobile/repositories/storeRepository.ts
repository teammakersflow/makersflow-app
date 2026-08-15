/**
 * storeRepository.ts
 *
 * Provides all product data for the Store screen.
 * The screen calls only storeRepository.get() — it never knows if data came
 * from Supabase or the local cache.
 *
 * Cache strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Store products are entirely public (no user-specific data).
 *   - Key: CACHED_PRODUCTS_CATALOG   TTL: 30 min   (CACHE_POLICY.STORE_PRODUCTS_TTL_MS)
 *
 * Refresh strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Online:  fetch → write cache → return live data
 * Offline: read cache → return stale (or empty if cold)
 *
 * Invalidation
 * ─────────────────────────────────────────────────────────────────────────────
 * cacheManager evicts version-mismatched entries on read.
 * TTL expiry returns stale=true on RepositoryResult; next online load overwrites.
 */

import { supabase } from '@/lib/supabase';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { CACHE_POLICY } from '@/constants/cachePolicy';
import { cacheManager, networkResult, cacheResult, RepositoryResult } from '@/services/cacheManager';
import { isNetworkError } from '@/lib/networkUtils';
import { firstThumbnailUrl } from '@/lib/thumbnailUtils';
import { Product } from '@/data/mockData';

// ── Types ────────────────────────────────────────────────────────────────────
export interface StoreData {
  products: Product[];
}

export const EMPTY_STORE_DATA: StoreData = { products: [] };

// ── Product mapper (lifted from screen — single source of truth) ─────────────
const productFallbacks: Record<string, any[]> = {
  physical: [
    require('@/assets/images/products/product_kit_1.webp'),
    require('@/assets/images/products/product_kit_2.webp'),
    require('@/assets/images/products/product_kit_3.webp'),
  ],
  digital: [
    require('@/assets/images/product_notes_1.webp'),
    require('@/assets/images/product_notes_2.webp'),
    require('@/assets/images/product_notes_3.webp'),
  ],
};

function mapRow(row: any, index: number): Product {
  const isCourse =
    row.is_course === true ||
    row.category?.toLowerCase() === 'courses' ||
    row.subcategory?.toLowerCase() === 'courses';

  const isPhysical =
    !isCourse &&
    (row.category?.toLowerCase() === 'physical' ||
      row.subcategory?.toLowerCase() === 'physical kits' ||
      row.subcategory?.toLowerCase() === 'kit' ||
      row.subcategory?.toLowerCase() === 'kits');

  const isDigital =
    isCourse ||
    row.category?.toLowerCase() === 'digital' ||
    row.subcategory?.toLowerCase() === 'notes' ||
    row.subcategory?.toLowerCase() === 'premium resources';

  const category: 'physical' | 'digital' = isPhysical ? 'physical' : isDigital ? 'digital' : 'physical';

  let subcategory: string;
  if (isCourse)                                          subcategory = 'Courses';
  else if (isPhysical)                                   subcategory = 'Physical Kits';
  else if (row.subcategory?.toLowerCase() === 'notes')   subcategory = 'Notes';
  else if (row.subcategory?.toLowerCase() === 'premium resources') subcategory = 'Premium Resources';
  else subcategory = row.subcategory || (category === 'digital' ? 'Notes' : 'Physical Kits');

  const firstUrl = firstThumbnailUrl(row.thumbnail_url);
  const thumbnail = firstUrl
    ? { uri: firstUrl }
    : (productFallbacks[category] || productFallbacks.physical)[index % 3];

  // Build images array from the images column (saved by admin as array of URLs)
  let images: { uri: string }[] = [];
  if (row.images) {
    let raw = row.images;
    // Handle string (JSON), array of strings, or array of objects
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
    if (Array.isArray(raw)) {
      const urls: string[] = raw.map((item: any) => {
        // If item is already a plain URL string
        if (typeof item === 'string') return item;
        // If item is an object {uri: "..."} or {url: "..."}
        if (item && typeof item === 'object') return item.uri || item.url || item.src || '';
        return '';
      }).filter((u: string) => u.startsWith('http'));
      const thumbUrl = firstUrl || '';
      const ordered = thumbUrl ? [thumbUrl, ...urls.filter((u: string) => u !== thumbUrl)] : urls;
      images = Array.from(new Set(ordered)).map((u: string) => ({ uri: u }));
    }
  }
  // Always ensure thumbnail is in images
  if (images.length === 0 && firstUrl) images = [{ uri: firstUrl }];

  return {
    id: String(row.id),
    title: row.title || 'Untitled Product',
    category,
    subcategory,
    price: Number(row.price) || 0,
    originalPrice: Number(row.original_price) || Number(row.price) || 0,
    thumbnail,
    images: images.length > 0 ? images : undefined,
    description: row.description || 'No description available.',
    rating: Number(row.rating) || 0,
    reviews: Number(row.total_reviews) || 0,
    inStock: (row.in_stock === false || row.status === 'sold_out' || row.status === 'out_of_stock') ? false : Boolean(row.in_stock ?? true),
    weight_kg: row.weight_kg ? Number(row.weight_kg) : undefined,
    badge: row.badge || undefined,
    features: Array.isArray(row.features) ? row.features : [],
  };
}

// ── Remote fetcher ───────────────────────────────────────────────────────────
async function fetchProducts(): Promise<Product[]> {
  // TECH DEBT NOTE: Allowlist filter for public product statuses.
  // Consider switching to denylist (.neq status draft/archived/inactive) in future refactors.
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, title, slug, description, price, original_price, category, subcategory, thumbnail_url, images, videos, in_stock, status, is_course, course_id, weight_kg'
    )
    .or('status.eq.available,status.eq.active,status.eq.sold_out,status.eq.out_of_stock');

  if (error) throw error;
  return (data ?? []).map((row, idx) => mapRow(row, idx));
}

// ── Public API ───────────────────────────────────────────────────────────────
export const storeRepository = {
  /**
   * get() — the only method the screen calls.
   *
   * Online:  fetchRemote → write cache → return live data
   * Offline: read cache  → return stale (or empty if cold)
   *
   * The screen does not know which path was taken.
   */
  async get(isOffline: boolean, forceRefresh = false): Promise<RepositoryResult<StoreData>> {
    if (isOffline) {
      return storeRepository.loadFromCache();
    }

    if (!forceRefresh) {
      try {
        const cached = await cacheManager.readWithMeta<Product[]>(
          STORAGE_KEYS.CACHED_PRODUCTS_CATALOG,
          CACHE_POLICY.STORE_PRODUCTS_TTL_MS
        );
        if (cached && !cached.stale) {
          return cacheResult({ products: cached.data }, cached.updatedAt, CACHE_POLICY.STORE_PRODUCTS_TTL_MS);
        }
      } catch (err) {
        console.warn('[storeRepo] Error checking public cache:', err);
      }
    }

    try {
      const products = await fetchProducts();
      cacheManager.write(STORAGE_KEYS.CACHED_PRODUCTS_CATALOG, products);
      return networkResult({ products });
    } catch (err: any) {
      if (isNetworkError(err)) {
        console.warn('[storeRepo] Network error — falling back to cache');
      } else {
        console.error('[storeRepo] Unexpected fetch error:', err);
      }
      return storeRepository.loadFromCache();
    }
  },

  /** Load StoreData entirely from local cache. */
  async loadFromCache(): Promise<RepositoryResult<StoreData>> {
    const result = await cacheManager.readWithMeta<Product[]>(
      STORAGE_KEYS.CACHED_PRODUCTS_CATALOG,
      CACHE_POLICY.STORE_PRODUCTS_TTL_MS
    );

    const products = result?.data ?? [];
    const updatedAt = result?.updatedAt ?? new Date().toISOString();
    return cacheResult({ products }, updatedAt, CACHE_POLICY.STORE_PRODUCTS_TTL_MS);
  },

  // No clearUserCache() — store data is entirely public.
};
