import { tokenStorage } from './tokenStorage';
import { emitSessionExpired } from '@/lib/sessionEvents';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export function getApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
      throw new Error(
        'CRITICAL CONFIGURATION ERROR: EXPO_PUBLIC_API_URL must be explicitly configured with a remote server URL for production builds.'
      );
    }
    return envUrl;
  }

  const rawUrl = envUrl || 'http://localhost:3000';

  // If developer explicitly configured a remote/non-localhost URL, respect it directly
  if (!rawUrl.includes('localhost') && !rawUrl.includes('127.0.0.1')) {
    return rawUrl;
  }

  // Development runtime host resolution for localhost / 127.0.0.1:
  // 1. Android Emulator: map loopback to 10.0.2.2
  if (Platform.OS === 'android' && !Device.isDevice) {
    return rawUrl.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
  }

  // 2. Physical device (Android / iOS) running via Expo Go / dev client:
  // Dynamically resolve developer machine IP from Metro bundler hostUri if available
  if (Device.isDevice && Constants.expoConfig?.hostUri) {
    const hostIp = Constants.expoConfig.hostUri.split(':')[0];
    if (hostIp) {
      return rawUrl.replace('localhost', hostIp).replace('127.0.0.1', hostIp);
    }
  }

  // 3. iOS Simulator & Web: localhost is directly reachable
  return rawUrl;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let isRefreshing = false;
let refreshSubscribers: Array<(newToken: string | null) => void> = [];

function subscribeTokenRefresh(cb: (newToken: string | null) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(newToken: string | null) {
  refreshSubscribers.map((cb) => cb(newToken));
  refreshSubscribers = [];
}

/**
 * Executes token refresh via POST /auth/refresh
 */
async function performTokenRefresh(): Promise<string | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) {
    await tokenStorage.clearTokens();
    emitSessionExpired();
    return null;
  }

  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await tokenStorage.clearTokens();
      emitSessionExpired();
      return null;
    }

    const payload = await response.json();
    const data = payload?.data || payload;

    const newAccessToken = data?.accessToken;
    const nextRefreshToken = data?.refreshToken || refreshToken;

    if (newAccessToken && nextRefreshToken) {
      await tokenStorage.saveTokens(newAccessToken, nextRefreshToken);
      return newAccessToken;
    }

    await tokenStorage.clearTokens();
    emitSessionExpired();
    return null;
  } catch {
    await tokenStorage.clearTokens();
    emitSessionExpired();
    return null;
  }
}

/**
 * Centralized fetch HTTP API Client with timeout, auth header injection, and 401 token refresh interceptor.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const baseUrl = getApiBaseUrl();
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const accessToken = await tokenStorage.getAccessToken();
  if (accessToken && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle 401 Unauthorized (Token Expiry)
    if (response.status === 401 && !isRetry && !endpoint.includes('/auth/refresh') && !endpoint.includes('/auth/google') && !endpoint.includes('/auth/login')) {
      if (!isRefreshing) {
        isRefreshing = true;
        const newToken = await performTokenRefresh();
        isRefreshing = false;
        onRefreshed(newToken);

        if (!newToken) {
          throw new ApiError(401, 'Session expired. Please log in again.');
        }

        // Retry original request with new access token
        return apiRequest<T>(endpoint, options, true);
      } else {
        // Queue request while refresh is in progress
        return new Promise<T>((resolve, reject) => {
          subscribeTokenRefresh(async (newToken) => {
            if (!newToken) {
              reject(new ApiError(401, 'Session expired. Please log in again.'));
              return;
            }
            try {
              const retryResult = await apiRequest<T>(endpoint, options, true);
              resolve(retryResult);
            } catch (err) {
              reject(err);
            }
          });
        });
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        errorData?.message || errorData?.error || `HTTP request failed with status ${response.status}`,
        errorData
      );
    }

    const payload = await response.json().catch(() => null);
    return payload as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new ApiError(408, 'Request timed out after 15 seconds.');
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, error.message || 'Network request failed.');
  }
}

export const apiClient = {
  get: <T = any>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),
  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiRequest<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};
