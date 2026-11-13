import { tokenStorage } from './tokenStorage';
import { emitSessionExpired } from '@/lib/sessionEvents';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { createRateLimitGate, runWithRateLimitRetry } from './retryPolicy';

export function getApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
      throw new Error(
        'CRITICAL CONFIGURATION ERROR: EXPO_PUBLIC_API_URL must be explicitly configured with a remote server URL for production builds.'
      );
    }
    // L-20: tokens must never travel over plain HTTP in production.
    if (!/^https:\/\//i.test(envUrl)) {
      throw new Error('CRITICAL CONFIGURATION ERROR: EXPO_PUBLIC_API_URL must use https:// in production builds.');
    }
    return envUrl.replace(/\/+$/, '');
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
    public data?: any,
    /** Raw Retry-After header of a 429 response (lib/auth/retryPolicy.ts). */
    public retryAfter?: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// One gate for the whole app: a 429 seen by any screen makes every other
// read of that endpoint wait (short block) or fail fast (long block).
const rateLimitGate = createRateLimitGate();

/** M-6: upper bound for POST /auth/refresh. */
const REFRESH_TIMEOUT_MS = 15_000;

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

  // M-6: the refresh call is time-limited. Previously a hung request kept
  // `isRefreshing` true forever and every later 401 waited on it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const baseUrl = getApiBaseUrl();
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      await tokenStorage.clearTokens();
      emitSessionExpired();
      throw new ApiError(401, 'Refresh token is invalid. Please log in again.');
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        `Token refresh failed with status ${response.status}. Saved credentials were preserved.`
      );
    }

    const payload = await response.json();
    const data = payload?.data || payload;
    const newAccessToken = data?.accessToken;
    const newRefreshToken = data?.refreshToken || refreshToken;

    if (!newAccessToken) {
      throw new ApiError(502, 'Token refresh returned an invalid response.');
    }

    await tokenStorage.saveTokens(newAccessToken, newRefreshToken);
    return newAccessToken;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if ((error as any)?.name === 'AbortError') {
      throw new ApiError(408, 'Token refresh timed out. Saved credentials were preserved.');
    }

    throw new ApiError(
      0,
      error instanceof Error
        ? `Token refresh network error: ${error.message}`
        : 'Token refresh network error. Saved credentials were preserved.'
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * M-6: single-flight refresh. All concurrent 401s await the same promise,
 * which always settles (it has a timeout) and is then cleared.
 */
let refreshPromise: Promise<string | null> | null = null;
function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** L-19: only send the bearer token to our own API origin. */
export function isApiOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Centralized fetch HTTP API Client with timeout, auth header injection, and 401 token refresh interceptor.
 *
 * HTTP 429 (2026-11-13): reads are retried at most once, honouring
 * Retry-After (or a short backoff with jitter); writes are never retried; a
 * shared gate stops other screens piling onto a rate-limited endpoint
 * (lib/auth/retryPolicy.ts). The error keeps its status so screens can say
 * "server is busy" instead of "check your connection".
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  return runWithRateLimitRetry<T>({
    method: options.method || 'GET',
    endpoint,
    send: () => sendApiRequest<T>(endpoint, options, isRetry),
    gate: rateLimitGate,
    blockedError: (waitMs) =>
      new ApiError(429, 'Too many requests. Please try again shortly.', undefined, String(Math.ceil(waitMs / 1000))),
    signal: options.signal,
  });
}

/** One attempt (with the existing 401 refresh-and-retry-once behaviour). */
async function sendApiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let baseUrl: string;
  try {
    baseUrl = getApiBaseUrl(); // L-20: configuration errors surface as ApiError, not raw throws
  } catch (e: any) {
    clearTimeout(timeoutId);
    throw new ApiError(0, e?.message || 'API is not configured.');
  }
  const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers: Record<string, string> = {
    ...(options.body !== undefined && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  // L-19: never attach our bearer token to a third-party URL.
  const accessToken = await tokenStorage.getAccessToken();
  if (accessToken && !headers['Authorization'] && isApiOrigin(url, baseUrl)) {
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
    // 401 → refresh once (single-flight) and retry. Auth endpoints and logout
    // never trigger a refresh (L-16: no "session expired" alert while logging out).
    const noRefresh = ['/auth/refresh', '/auth/google', '/auth/login', '/auth/logout'].some((p) => endpoint.includes(p));
    if (response.status === 401 && !isRetry && !noRefresh && isApiOrigin(url, baseUrl)) {
      const newToken = await refreshOnce();
      if (!newToken) {
        throw new ApiError(401, 'Session expired. Please log in again.');
      }
      // Single attempt: the outer 429 policy already wraps this request.
      return sendApiRequest<T>(endpoint, options, true);
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        errorData?.message || errorData?.error || `HTTP request failed with status ${response.status}`,
        errorData,
        response.status === 429 ? response.headers?.get?.('retry-after') ?? null : undefined,
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
