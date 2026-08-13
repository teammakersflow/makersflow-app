import { supabase } from '@/lib/supabase';
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
            full_name: user.name,
            avatar_url: user.profileImage,
          },
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      },
    },
  };
}

/**
 * Get user profile from database (Supabase DB)
 */
export async function getProfile(userId: string) {
  return await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
}

/**
 * Create or update user profile in database (Supabase DB)
 */
export async function createProfile(profileData: {
  id: string;
  email: string;
  full_name: string;
  role: string;
  grade?: string | null;
  school?: string | null;
}) {
  return await supabase
    .from('profiles')
    .upsert(profileData, { onConflict: 'id' })
    .select()
    .maybeSingle();
}

/**
 * Update user profile in database (Supabase DB)
 */
export async function updateProfile(
  userId: string,
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
  return await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .maybeSingle();
}

/**
 * Legacy password login fallback (pending backend email auth implementation)
 */
export async function signInWithPassword(email: string, _password: string) {
  return await supabase.auth.signInWithPassword({ email, password: _password });
}

/**
 * Legacy signup fallback (pending backend signup implementation)
 */
export async function signUp(
  email: string,
  password: string,
  metadata?: { name?: string; grade?: string; school?: string; phone?: string; age?: number },
  redirectTo?: string
) {
  return await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: redirectTo,
    },
  });
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
 * Password reset fallback
 */
export async function resetPasswordForEmail(email: string, redirectTo: string) {
  return await supabase.auth.resetPasswordForEmail(email, { redirectTo });
}

/**
 * Update password fallback
 */
export async function updatePassword(password: string) {
  return await supabase.auth.updateUser({ password });
}

/**
 * OTP fallback
 */
export async function sendOtp(phone: string) {
  return await supabase.auth.signInWithOtp({ phone });
}

export async function verifyOtp(phone: string, token: string) {
  return await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
}

