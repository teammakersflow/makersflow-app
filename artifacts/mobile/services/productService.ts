import { apiClient } from '@/lib/auth/apiClient';
import { Product } from '@/data/mockData';
import { firstThumbnailUrl } from '@/lib/thumbnailUtils';

export interface ProductPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GetProductsParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface GetProductsResponse {
  products: Product[];
  pagination: ProductPagination;
}

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

const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|m4v|m3u8)(\?.*)?$/i;

/**
 * Universal mapping layer for backend products to mobile Product model.
 */
export function mapBackendProduct(row: any, index = 0): Product {
  if (!row) {
    return {
      id: '0',
      title: 'Unknown Product',
      category: 'physical',
      subcategory: 'Physical Kits',
      price: 0,
      originalPrice: 0,
      thumbnail: productFallbacks.physical[0],
      description: 'No description available.',
      rating: 0,
      reviews: 0,
      inStock: false,
      features: [],
    };
  }

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
    row.subcategory?.toLowerCase() === 'question banks' ||
    row.subcategory?.toLowerCase() === 'premium resources';

  const category: 'physical' | 'digital' = isPhysical ? 'physical' : isDigital ? 'digital' : 'physical';

  let subcategory: string;
  if (isCourse) {
    subcategory = 'Courses';
  } else if (isPhysical) {
    subcategory = 'Physical Kits';
  } else if (row.subcategory?.toLowerCase() === 'notes') {
    subcategory = 'Notes';
  } else if (row.subcategory?.toLowerCase() === 'premium resources') {
    subcategory = 'Premium Resources';
  } else {
    subcategory = row.subcategory || (category === 'digital' ? 'Notes' : 'Physical Kits');
  }

  // Consistent index hashing for stable fallback thumbnail per product
  let hashIndex = index;
  if (row.id) {
    const idStr = String(row.id);
    let hash = 0;
    for (let i = 0; i < idStr.length; i++) {
      hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    hashIndex = Math.abs(hash);
  }

  const firstUrl = firstThumbnailUrl(row.thumbnail_url);
  const thumbnail = firstUrl
    ? { uri: firstUrl }
    : (productFallbacks[category] || productFallbacks.physical)[hashIndex % 3];

  // Build images array
  let urls: string[] = [];
  if (row.images) {
    let raw = row.images;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = [];
      }
    }
    if (Array.isArray(raw)) {
      for (const item of raw) {
        let u: string | null = null;
        if (typeof item === 'string') {
          u = item;
        } else if (item && typeof item === 'object') {
          if (typeof item.type === 'string' && item.type.toLowerCase().includes('video')) continue;
          u = item.url || item.uri || item.src || item.publicUrl || item.public_url || item.path || null;
        }
        if (u && typeof u === 'string' && u.startsWith('http') && !VIDEO_EXT_RE.test(u)) {
          urls.push(u);
        }
      }
    }
  }

  const thumbUrl: string | null = firstUrl || (thumbnail && thumbnail.uri ? thumbnail.uri : null);
  const ordered = thumbUrl ? [thumbUrl, ...urls.filter((u) => u !== thumbUrl)] : urls;
  const uniqueUrls = Array.from(new Set(ordered));
  const images = uniqueUrls.length > 0 ? uniqueUrls.map((u) => ({ uri: u })) : [thumbnail];

  return {
    id: String(row.id),
    title: row.title || 'Untitled Product',
    category,
    subcategory,
    price: Number(row.price) || 0,
    originalPrice: Number(row.original_price) || Number(row.price) || 0,
    thumbnail,
    images,
    description: row.description || 'No description available.',
    rating: Number(row.rating) || 0,
    reviews: Number(row.total_reviews) || 0,
    inStock: (row.in_stock === false || row.status === 'sold_out' || row.status === 'out_of_stock') ? false : Boolean(row.in_stock ?? true),
    badge: row.badge || undefined,
    features: Array.isArray(row.features) ? row.features : [],
    weight_kg: row.weight_kg ? Number(row.weight_kg) : undefined,
    gst_rate: row.gst_rate !== undefined && row.gst_rate !== null ? Number(row.gst_rate) : undefined,
    course_id: row.course_id !== undefined && row.course_id !== null ? Number(row.course_id) : undefined,
  };
}

export const productService = {
  /**
   * Fetch paginated products from GET /products
   */
  async getProducts(params?: GetProductsParams): Promise<GetProductsResponse> {
    const queryParts: string[] = [];
    if (params?.page !== undefined) queryParts.push(`page=${encodeURIComponent(params.page)}`);
    if (params?.limit !== undefined) queryParts.push(`limit=${encodeURIComponent(params.limit)}`);
    if (params?.search && params.search.trim()) queryParts.push(`search=${encodeURIComponent(params.search.trim())}`);

    const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    const response = await apiClient.get<any>(`/products${queryString}`);

    const rawList = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    const rawPagination = response?.pagination;
    const pagination: ProductPagination = {
      total: rawPagination?.total ?? rawList.length,
      page: rawPagination?.page ?? (params?.page || 1),
      limit: rawPagination?.limit ?? (params?.limit || rawList.length || 10),
      totalPages: rawPagination?.totalPages ?? (rawList.length > 0 ? 1 : 0),
    };

    const products = rawList.map((row: any, idx: number) => mapBackendProduct(row, idx));

    return {
      products,
      pagination,
    };
  },

  /**
   * Fetch a single product by ID from GET /products/:id
   */
  async getProductById(id: string | number): Promise<Product | null> {
    if (!id || String(id) === 'undefined' || String(id) === 'null') {
      return null;
    }

    try {
      const response = await apiClient.get<any>(`/products/${id}`);
      const raw = response?.data !== undefined && response?.success !== undefined ? response.data : response;
      if (!raw || typeof raw !== 'object' || !raw.id) {
        return null;
      }
      return mapBackendProduct(raw);
    } catch (err: any) {
      if (err?.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * Search products using backend search parameter
   */
  async searchProducts(query: string, limit = 20): Promise<Product[]> {
    if (!query || !query.trim()) {
      return [];
    }
    const result = await this.getProducts({ search: query.trim(), limit });
    return result.products;
  },
};
