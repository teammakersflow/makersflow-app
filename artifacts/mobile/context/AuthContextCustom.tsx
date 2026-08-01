import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, buildUser } from './AuthContextSupabase';
import { tokenStorage } from '@/lib/auth/tokenStorage';
import { customAuthService } from '@/lib/auth/customAuthService';
import { GoogleAuthProvider } from '@/lib/auth/authProviders';
import { mapBackendUserToDomain, CustomSession } from '@/types/auth';
import { profileCache } from '@/services/profileCache';
import { homeRepository } from '@/repositories/homeRepository';
import { coursesRepository } from '@/repositories/coursesRepository';
import { registerForPushNotifications, unregisterPushToken } from '@/lib/pushNotifications';

const devLog = (...args: any[]) => {
  if (__DEV__) console.log(...args);
};
const devError = (...args: any[]) => {
  if (__DEV__) console.error(...args);
};

interface AuthContextType {
  user: User | null;
  session: CustomSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOffline: boolean;
  authInitialized: boolean;
  isAuthenticatedLocally: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (
    name: string,
    email: string,
    password: string,
    grade?: string,
    school?: string,
    phone?: string,
    age?: number
  ) => Promise<{ success: boolean; needsEmailVerification?: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  sendOtp: (phone: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (phone: string, token: string) => Promise<{ success: boolean; error?: string }>;
  sendWhatsappOtp: (phone: string) => Promise<{ success: boolean; error?: string }>;
  verifyWhatsappOtp: (phone: string, token: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContextCustom = createContext<AuthContextType | null>(null);

export function AuthProviderCustom({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<CustomSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isAuthenticatedLocally, setIsAuthenticatedLocally] = useState(false);

  // ── Session Restoration (GET /auth/me) ──────────────────────────────────
  async function restoreSession(): Promise<void> {
    try {
      const accessToken = await tokenStorage.getAccessToken();
      const refreshToken = await tokenStorage.getRefreshToken();

      if (!accessToken || !refreshToken) {
        setUser(null);
        setSession(null);
        setIsLoading(false);
        setAuthInitialized(true);
        return;
      }

      setIsAuthenticatedLocally(true);

      const response = await customAuthService.getCurrentUser();
      if (response.success && response.data) {
        const cachedProfile = await profileCache.loadProfile();
        const domainUser = mapBackendUserToDomain(response.data, cachedProfile);
        setUser(domainUser);
        setSession({ accessToken, refreshToken, expiresIn: 900 });
      } else {
        await tokenStorage.clearTokens();
        setUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
      }
    } catch (err: any) {
      devError('[AuthCustom] Session restore error:', err?.message);
      // Read cache if available
      const cachedProfile = await profileCache.loadProfile();
      if (cachedProfile) {
        setIsOffline(true);
        setUser(mapBackendUserToDomain({
          id: cachedProfile.id,
          name: cachedProfile.full_name || 'User',
          email: cachedProfile.email,
          profileImage: cachedProfile.avatar_url,
          role: cachedProfile.role || 'student'
        }, cachedProfile));
      } else {
        await tokenStorage.clearTokens();
        setUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
      }
    } finally {
      setIsLoading(false);
      setAuthInitialized(true);
    }
  }

  useEffect(() => {
    restoreSession();
  }, []);

  // ── Login with Google ───────────────────────────────────────────────────
  async function loginWithGoogle(): Promise<{ success: boolean; error?: string }> {
    try {
      setIsLoading(true);
      const googleProvider = new GoogleAuthProvider();
      const credentials = await googleProvider.authenticate();

      if (!credentials.idToken) {
        setIsLoading(false);
        return { success: false, error: 'Failed to retrieve Google ID token.' };
      }

      const res = await customAuthService.loginWithGoogle(credentials.idToken);
      if (res.success && res.data) {
        const { accessToken, refreshToken, expiresIn, user: backendUser } = res.data;
        await tokenStorage.saveTokens(accessToken, refreshToken);
        
        const domainUser = mapBackendUserToDomain(backendUser);
        setUser(domainUser);
        setSession({ accessToken, refreshToken, expiresIn });
        setIsAuthenticatedLocally(true);
        registerForPushNotifications(domainUser.id).catch(() => {});

        setIsLoading(false);
        return { success: true };
      }

      setIsLoading(false);
      return { success: false, error: res.message || 'Login failed.' };
    } catch (err: any) {
      devError('[AuthCustom] Google login error:', err?.message);
      setIsLoading(false);
      return { success: false, error: err?.message || 'Google sign-in failed.' };
    }
  }

  // ── Logout ──────────────────────────────────────────────────────────────
  async function logout(): Promise<void> {
    try {
      setIsLoading(true);
      // 1. Revoke server session while access token is valid
      await customAuthService.logout().catch(() => {});

      // 2. Unregister push tokens
      if (user?.id) {
        await unregisterPushToken(user.id).catch(() => {});
      }

      // 3. Clear local tokens & user caches
      await tokenStorage.clearTokens();
      await profileCache.clearProfile();
      await homeRepository.clearUserCache();
      await coursesRepository.clearUserCache();

      setUser(null);
      setSession(null);
      setIsAuthenticatedLocally(false);
    } catch (err: any) {
      devError('[AuthCustom] Logout error:', err?.message);
      await tokenStorage.clearTokens();
      setUser(null);
      setSession(null);
      setIsAuthenticatedLocally(false);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Placeholders for aux features ───────────────────────────────────────
  async function login(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Email login requires custom auth backend endpoint.' };
  }

  async function register(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Email registration requires custom auth backend endpoint.' };
  }

  async function updateUser(updates: Partial<User>): Promise<{ success: boolean; error?: string }> {
    if (!user) return { success: false, error: 'No user logged in' };
    const updated = { ...user, ...updates };
    setUser(updated);
    return { success: true };
  }

  async function resetPassword(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Password reset requires custom auth backend endpoint.' };
  }

  async function updatePassword(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Password update requires custom auth backend endpoint.' };
  }

  async function sendOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'OTP requires custom auth backend endpoint.' };
  }

  async function verifyOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'OTP verification requires custom auth backend endpoint.' };
  }

  async function sendWhatsappOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp OTP requires custom auth backend endpoint.' };
  }

  async function verifyWhatsappOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp OTP verification requires custom auth backend endpoint.' };
  }

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user && !!session,
    isOffline,
    authInitialized,
    isAuthenticatedLocally,
    login,
    register,
    loginWithGoogle,
    logout,
    updateUser,
    resetPassword,
    updatePassword,
    sendOtp,
    verifyOtp,
    sendWhatsappOtp,
    verifyWhatsappOtp,
  };

  return <AuthContextCustom.Provider value={value}>{children}</AuthContextCustom.Provider>;
}

export function useAuthCustom() {
  const ctx = useContext(AuthContextCustom);
  if (!ctx) throw new Error('useAuthCustom must be used within AuthProviderCustom');
  return ctx;
}
