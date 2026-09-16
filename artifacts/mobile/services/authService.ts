import { customAuthService, AuthLoginResponse, AuthUserResponse } from '@/lib/auth/customAuthService';
import { tokenStorage } from '@/lib/auth/tokenStorage';
import type { Profile } from '@/types/auth';

/**
 * Sign in with Google idToken (POST /auth/google)
 */
export async function googleLogin(idToken: string): Promise<AuthLoginResponse> {
  return await customAuthService.loginWithGoogle(idToken);
}

/**
 * Legacy Google Sign-In helper delegating to googleLogin
 */
export async function signInWithGoogle(idToken: string) {
  return await googleLogin(idToken);
}

/**
 * Sign out the current user (POST /auth/logout and clear tokens)
 */
export async function signOut() {
  try {
    await customAuthService.logout();
  } finally {
    await tokenStorage.clearTokens();
  }
  return { error: null };
}

/**
 * Local sign out clearing secure tokens
 */
export async function signOutLocal() {
  await tokenStorage.clearTokens();
  return { error: null };
}

/**
 * Refresh session tokens via POST /auth/refresh
 */
export async function refreshSessionWithToken(refreshToken: string) {
  try {
    const res = await customAuthService.refreshTokens(refreshToken);
    if (res.success && res.data) {
      await tokenStorage.saveTokens(res.data.accessToken, res.data.refreshToken);
      return { data: res.data, error: null };
    }
    return { data: null, error: new Error(res.message || 'Token refresh failed') };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Fetch current authenticated user via GET /auth/me
 */
export async function getCurrentUser(): Promise<{ data: AuthUserResponse | null; error: Error | null }> {
  try {
    const res = await customAuthService.getCurrentUser();
    if (res.success && res.data) {
      return { data: res.data, error: null };
    }
    return { data: null, error: new Error('User not found') };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Legacy session check using tokenStorage and GET /auth/me
 */
export async function getSession() {
  const token = await tokenStorage.getAccessToken();
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!token) return { data: { session: null } };
  const { data: user, error } = await getCurrentUser();
  if (error || !user) return { data: { session: null } };
  return {
    data: {
      session: {
        access_token: token,
        refresh_token: refreshToken || '',
        expires_in: 3600,
        token_type: 'bearer' as const,
        user: {
          id: user.id,
          email: user.email,
          app_metadata: {},
          user_metadata: {
            full_name: user.name || user.full_name,
            avatar_url: user.profileImage || user.avatar_url,
          },
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      },
    },
  };
}

/**
 * Get user profile via GET /auth/me
 */
export async function getProfile(_userId?: string) {
  try {
    const res = await customAuthService.getCurrentUser();
    if (res.success && res.data) {
      return { data: res.data as any, error: null };
    }
    return { data: null, error: new Error('Profile not found') };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Create or update user profile via student-scoped PATCH /users/profile
 */
export async function createProfile(profileData: {
  id?: string;
  email?: string;
  full_name: string;
  role?: string;
  grade?: string | null;
  school?: string | null;
  avatar_url?: string | null;
}) {
  try {
    const res = await customAuthService.updateProfile({
      full_name: profileData.full_name,
      grade: profileData.grade ?? undefined,
      school: profileData.school ?? undefined,
      avatar_url: profileData.avatar_url ?? undefined,
    });
    return { data: res.data as any, error: null };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Update user profile via student-scoped PATCH /users/profile
 */
export async function updateProfile(
  _userId: string,
  updates: {
    full_name?: string;
    grade?: string | null;
    school?: string | null;
    avatar_url?: string | null;
    age?: number | null;
    onboarding_completed?: boolean;
    phone?: string | null;
  }
) {
  try {
    const res = await customAuthService.updateProfile({
      full_name: updates.full_name,
      grade: updates.grade ?? undefined,
      school: updates.school ?? undefined,
      avatar_url: updates.avatar_url ?? undefined,
    });
    return { data: res.data as any, error: null };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Legacy password login stub (Authentication is managed via Google OAuth)
 */
export async function signInWithPassword(_email: string, _password: string) {
  return {
    data: { user: null, session: null },
    error: { message: 'Password authentication is disabled. Please sign in with Google.' },
  };
}

/**
 * Legacy signup stub (Registration is managed via Google OAuth)
 */
export async function signUp(
  _email: string,
  _password: string,
  _metadata?: { name?: string; grade?: string; school?: string; phone?: string; age?: number },
  _redirectTo?: string
) {
  return {
    data: { user: null, session: null },
    error: { message: 'Registration is managed via Google Sign-In. Please use Google.' },
  };
}

/**
 * Set session manually
 */
export async function setSession(accessToken: string, refreshToken: string) {
  await tokenStorage.saveTokens(accessToken, refreshToken);
  return { data: { user: null }, error: null };
}

/**
 * Auth state change listener (stub for legacy compatibility)
 */
export function onAuthStateChange(
  _callback: (event: string, session: any) => void
) {
  return {
    data: {
      subscription: {
        unsubscribe: () => {},
      },
    },
  };
}

/**
 * Password reset stub
 */
export async function resetPasswordForEmail(_email: string, _redirectTo: string) {
  return {
    data: {},
    error: { message: 'Password reset is not applicable for Google authenticated accounts.' },
  };
}

/**
 * Update password stub
 */
export async function updatePassword(_password: string) {
  return {
    data: { user: null },
    error: { message: 'Password management is managed via Google Account security.' },
  };
}

/**
 * OTP stub
 */
export async function sendOtp(_phone: string) {
  return {
    data: {},
    error: { message: 'OTP authentication is disabled. Please sign in with Google.' },
  };
}

export async function verifyOtp(_phone: string, _token: string) {
  return {
    data: { user: null, session: null },
    error: { message: 'OTP verification is disabled. Please sign in with Google.' },
  };
}
