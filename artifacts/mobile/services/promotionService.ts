import { apiClient } from '@/lib/auth/apiClient';

export interface Promotion {
  id: string;
  title: string;
  subtitle?: string;
  image_url: string;
  banner_url?: string;
  action_url?: string;
  link?: string;
  link_url?: string;
  is_active: boolean;
  expires_at?: string | null;
  display_order?: number;
  created_at?: string;
}

export function mapBackendPromotion(row: any): Promotion {
  if (!row) {
    return {
      id: '0',
      title: '',
      image_url: '',
      is_active: false,
    };
  }

  const imageUrl = row.image_url || row.banner_url || '';
  const actionUrl = row.action_url || row.link || row.link_url || '';

  return {
    id: String(row.id),
    title: row.title || '',
    subtitle: row.subtitle || undefined,
    image_url: imageUrl,
    banner_url: imageUrl,
    action_url: actionUrl || undefined,
    link: actionUrl || undefined,
    link_url: actionUrl || undefined,
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
    expires_at: row.expires_at || null,
    display_order: row.display_order !== undefined && row.display_order !== null ? Number(row.display_order) : 0,
    created_at: row.created_at || undefined,
  };
}

export async function fetchAllPromotions(): Promise<Promotion[]> {
  try {
    const response = await apiClient.get<any>('/promotions');
    const rawList = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    if (!rawList || rawList.length === 0) return [];

    const now = Date.now();
    return rawList
      .filter((row: any) => {
        const isActive = row.is_active !== undefined ? Boolean(row.is_active) : true;
        const notExpired = !row.expires_at || new Date(row.expires_at).getTime() > now;
        return isActive && notExpired;
      })
      .map((row: any) => mapBackendPromotion(row))
      .sort((a: Promotion, b: Promotion) => (a.display_order ?? 0) - (b.display_order ?? 0));
  } catch (error) {
    console.error('[promotionService] Error fetching promotions:', error);
    throw error;
  }
}

export async function fetchPromotionById(id: string | number): Promise<Promotion | null> {
  if (!id || String(id) === 'undefined' || String(id) === 'null') {
    return null;
  }

  try {
    const response = await apiClient.get<any>(`/promotions/${id}`);
    const raw = response?.data !== undefined && response?.success !== undefined ? response.data : response;

    if (!raw || typeof raw !== 'object' || !raw.id) {
      return null;
    }

    return mapBackendPromotion(raw);
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }
    console.error(`[promotionService] Error fetching promotion ${id}:`, error);
    throw error;
  }
}

export const promotionService = {
  getAll: fetchAllPromotions,
  getPromotions: fetchAllPromotions,
  getById: fetchPromotionById,
  getPromotionById: fetchPromotionById,
};
