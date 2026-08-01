import { apiRequest } from './apiClient';

export interface AuthUserResponse {
  id: string;
  name: string;
  email: string;
  profileImage?: string | null;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthLoginResponse {
  success: boolean;
  message?: string;
  data: AuthTokens & {
    user: AuthUserResponse;
  };
}

export interface AuthRefreshResponse {
  success: boolean;
  message?: string;
  data: AuthTokens;
}

export interface AuthMeResponse {
  success: boolean;
  data: AuthUserResponse;
}

/**
 * Custom Backend Authentication Service
 */
export const customAuthService = {
  /**
   * Authenticate user with Google idToken (POST /auth/google)
   */
  async loginWithGoogle(idToken: string): Promise<AuthLoginResponse> {
    return await apiRequest<AuthLoginResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  },

  /**
   * Refresh session tokens (POST /auth/refresh)
   */
  async refreshTokens(refreshToken: string): Promise<AuthRefreshResponse> {
    return await apiRequest<AuthRefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  /**
   * Fetch authenticated user profile (GET /auth/me)
   */
  async getCurrentUser(): Promise<AuthMeResponse> {
    return await apiRequest<AuthMeResponse>('/auth/me', {
      method: 'GET',
    });
  },

  /**
   * Revoke active session on server (POST /auth/logout)
   */
  async logout(): Promise<void> {
    try {
      await apiRequest('/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Ignore network errors on local session cleanup
    }
  },
};
