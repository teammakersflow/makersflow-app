import { apiClient } from '@/lib/apiClient';

export interface SettingItem {
  id?: string;
  key: string;
  value: string | any;
  label?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SellerSettings {
  name: string;
  tradeName: string;
  address1?: string;
  address2?: string;
  state: string;
  stateCode: string;
  gstin: string | null;
  cin: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export interface ShippingConfig {
  fee: number;
  remoteFee: number;
  threshold: number;
}

export const DEFAULT_SELLER_SETTINGS: SellerSettings = {
  name: "EDODWAJA PRIVATE LIMITED",
  tradeName: "MAKERSFLOW",
  state: "Andhra Pradesh",
  stateCode: "37",
  gstin: null,
  cin: null,
  phone: null,
  email: null,
  website: "www.makersflow.in",
};

export const DEFAULT_SHIPPING_CONFIG: ShippingConfig = {
  fee: 49,
  remoteFee: 149,
  threshold: 999,
};

let cachedSellerSettings: SellerSettings | null = null;

/**
 * Fetches a single setting by key from the NestJS backend (GET /settings/:key).
 */
export async function getSetting(key: string): Promise<SettingItem | null> {
  if (!key) return null;
  try {
    const response = await apiClient.get<any>(`/settings/${encodeURIComponent(key)}`);
    const raw = response?.data !== undefined && response?.success !== undefined ? response.data : response;

    if (!raw || typeof raw !== 'object') {
      return null;
    }

    return {
      id: raw.id ? String(raw.id) : undefined,
      key: String(raw.key || key),
      value: raw.value,
      label: raw.label ?? undefined,
      created_at: raw.created_at ? String(raw.created_at) : undefined,
      updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
    };
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }
    console.warn(`[settingsService] Failed to fetch setting '${key}':`, error?.message || error);
    return null;
  }
}

/**
 * Fetches multiple settings from the NestJS backend (GET /settings?keys=...).
 */
export async function getSettings(keys?: string[]): Promise<SettingItem[]> {
  try {
    const query = keys && keys.length > 0 ? `?keys=${encodeURIComponent(keys.join(','))}` : '';
    const response = await apiClient.get<any>(`/settings${query}`);
    const rawList = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    if (!rawList || rawList.length === 0) return [];

    return rawList.map((raw: any) => ({
      id: raw.id ? String(raw.id) : undefined,
      key: String(raw.key),
      value: raw.value,
      label: raw.label ?? undefined,
      created_at: raw.created_at ? String(raw.created_at) : undefined,
      updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
    }));
  } catch (error: any) {
    console.warn('[settingsService] Failed to fetch settings list:', error?.message || error);
    return [];
  }
}

/**
 * Fetches and resolves seller configuration for invoice generation.
 * Checks for composite 'seller_settings' key first, then falls back to individual seller keys,
 * and finally defaults to honest constant defaults.
 */
export async function getSellerSettings(forceRefresh = false): Promise<SellerSettings> {
  if (cachedSellerSettings && !forceRefresh) {
    return cachedSellerSettings;
  }

  try {
    // 1. Try composite 'seller_settings' key first
    const compositeSetting = await getSetting('seller_settings');
    if (compositeSetting?.value) {
      let parsedValue = compositeSetting.value;
      if (typeof parsedValue === 'string') {
        try {
          parsedValue = JSON.parse(parsedValue);
        } catch {
          // If not valid JSON, proceed to individual check
        }
      }

      if (parsedValue && typeof parsedValue === 'object') {
        cachedSellerSettings = {
          name: parsedValue.name || parsedValue.seller_name || parsedValue.store_name || DEFAULT_SELLER_SETTINGS.name,
          tradeName: parsedValue.tradeName || parsedValue.seller_trade_name || DEFAULT_SELLER_SETTINGS.tradeName,
          address1: parsedValue.address1 || parsedValue.seller_address1 || undefined,
          address2: parsedValue.address2 || parsedValue.seller_address2 || undefined,
          state: parsedValue.state || parsedValue.seller_state || DEFAULT_SELLER_SETTINGS.state,
          stateCode: parsedValue.stateCode || parsedValue.seller_state_code || DEFAULT_SELLER_SETTINGS.stateCode,
          gstin: parsedValue.gstin || parsedValue.gst_number || null,
          cin: parsedValue.cin || parsedValue.cin_number || null,
          phone: parsedValue.phone || parsedValue.store_phone || parsedValue.seller_phone || null,
          email: parsedValue.email || parsedValue.support_email || parsedValue.seller_email || null,
          website: parsedValue.website || DEFAULT_SELLER_SETTINGS.website,
        };
        return cachedSellerSettings;
      }
    }

    // 2. Fallback: check individual keys
    const individualKeys = [
      'seller_name',
      'store_name',
      'seller_trade_name',
      'seller_address1',
      'seller_address2',
      'seller_state',
      'seller_state_code',
      'gst_number',
      'cin_number',
      'store_phone',
      'seller_phone',
      'support_email',
      'seller_email',
      'website',
    ];

    const settingsList = await getSettings(individualKeys);
    if (settingsList.length > 0) {
      const map: Record<string, string> = {};
      for (const item of settingsList) {
        if (item.key && item.value !== undefined && item.value !== null) {
          map[item.key] = typeof item.value === 'string' ? item.value.trim() : String(item.value);
        }
      }

      cachedSellerSettings = {
        name: map['seller_name'] || map['store_name'] || DEFAULT_SELLER_SETTINGS.name,
        tradeName: map['seller_trade_name'] || DEFAULT_SELLER_SETTINGS.tradeName,
        address1: map['seller_address1'] || undefined,
        address2: map['seller_address2'] || undefined,
        state: map['seller_state'] || DEFAULT_SELLER_SETTINGS.state,
        stateCode: map['seller_state_code'] || DEFAULT_SELLER_SETTINGS.stateCode,
        gstin: map['gst_number'] && map['gst_number'].length > 0 ? map['gst_number'] : null,
        cin: map['cin_number'] && map['cin_number'].length > 0 ? map['cin_number'] : null,
        phone: map['store_phone'] || map['seller_phone'] || null,
        email: map['support_email'] || map['seller_email'] || null,
        website: map['website'] || DEFAULT_SELLER_SETTINGS.website,
      };
      return cachedSellerSettings;
    }
  } catch (err) {
    console.warn('[settingsService] Error resolving seller settings:', err);
  }

  // 3. Honest fallback default
  cachedSellerSettings = { ...DEFAULT_SELLER_SETTINGS };
  return cachedSellerSettings;
}

/**
 * Fetches admin shipping configuration from backend settings.
 */
export async function getShippingSettings(): Promise<ShippingConfig> {
  try {
    const keys = ['shipping_fee', 'shipping_fee_remote', 'free_shipping_threshold'];
    const items = await getSettings(keys);

    if (items.length > 0) {
      const map: Record<string, number> = {};
      for (const item of items) {
        const num = Number(item.value);
        if (!isNaN(num)) {
          map[item.key] = num;
        }
      }

      return {
        fee: map['shipping_fee'] ?? DEFAULT_SHIPPING_CONFIG.fee,
        remoteFee: map['shipping_fee_remote'] ?? DEFAULT_SHIPPING_CONFIG.remoteFee,
        threshold: map['free_shipping_threshold'] ?? DEFAULT_SHIPPING_CONFIG.threshold,
      };
    }
  } catch (err) {
    console.warn('[settingsService] Error fetching shipping settings:', err);
  }

  return { ...DEFAULT_SHIPPING_CONFIG };
}

export const settingsService = {
  getSetting,
  getSettings,
  getSellerSettings,
  getShippingSettings,
};
