import { apiRequest } from './apiClient';

export interface AuthUserResponse {
  id: string;
  name?: string | null;
  full_name?: string | null;
  email: string;
  profileImage?: string | null;
  avatar_url?: string | null;
  role: string;
  grade?: string | null;
  school?: string | null;
  phone?: string | null;
  age?: number | null;
  bio?: string | null;
  onboarding_completed?: boolean;
  [key: string]: unknown;
}

export interface UpdateProfileRequest {
  full_name?: string;
  grade?: string;
  school?: string;
  avatar_url?: string;
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

export interface UpdateProfileResponse {
  success: boolean;
  message?: string;
  data: AuthUserResponse;
}

/**
 * Custom Backend Authentication and User Profile Service
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
   * Update student-scoped profile on backend (PATCH /users/profile)
   * Identity is derived from authenticated JWT Bearer token
   */
  async updateProfile(dto: UpdateProfileRequest): Promise<UpdateProfileResponse> {
    return await apiRequest<UpdateProfileResponse>('/users/profile', {
      method: 'PATCH',
      body: JSON.stringify(dto),
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

  /**
   * Delete current user account (DELETE /users/me)
   * Identity is derived from authenticated JWT Bearer token
   */
  async deleteAccount(): Promise<{ success: boolean; message?: string }> {
    return await apiRequest<{ success: boolean; message?: string }>('/users/me', {
      method: 'DELETE',
    });
  },
};
