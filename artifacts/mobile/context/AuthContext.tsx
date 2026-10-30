import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { tokenStorage } from '@/lib/auth/tokenStorage';
import { customAuthService } from '@/lib/auth/customAuthService';
import { GoogleAuthProvider } from '@/lib/auth/authProviders';
import { mapBackendUserToDomain, CustomSession, Profile } from '@/types/auth';
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

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  grade?: string;
  school?: string;
  age?: number;
  role: string;
  joinedDate: string;
  onboarding_completed?: boolean;
}

export interface AuthContextType {
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
  loginWithGoogle: () => Promise<{ success: boolean; error?: string; profile?: User }>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  sendOtp: (phone: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (phone: string, token: string) => Promise<{ success: boolean; error?: string }>;
  sendWhatsappOtp: (phone: string) => Promise<{ success: boolean; error?: string }>;
  verifyWhatsappOtp: (phone: string, token: string) => Promise<{ success: boolean; error?: string }>;
}

export function buildUser(
  profile: Partial<Profile> | null | undefined,
  userOrDto: any
): User {
  return {
    id: userOrDto?.id || '',
    email: userOrDto?.email || '',
    name: profile?.full_name || userOrDto?.name || userOrDto?.full_name || userOrDto?.email?.split('@')[0] || 'User',
    phone: profile?.phone || userOrDto?.phone || undefined,
    avatar: profile?.avatar_url || userOrDto?.profileImage || userOrDto?.avatar_url || userOrDto?.avatar || undefined,
    grade: profile?.grade || userOrDto?.grade || undefined,
    school: profile?.school || userOrDto?.school || undefined,
    age: profile?.age || userOrDto?.age || undefined,
    role: profile?.role || userOrDto?.role || 'student',
    joinedDate: profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    onboarding_completed: profile?.onboarding_completed ?? userOrDto?.onboarding_completed ?? false,
  };
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<CustomSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isAuthenticatedLocally, setIsAuthenticatedLocally] = useState(false);

  // ── Session Restoration (GET /auth/me) ──────────────────────────────────
  const restoreSession = useCallback(async (): Promise<void> => {
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
        setIsOffline(false);
      } else {
        await tokenStorage.clearTokens();
        setUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
      }
    } catch (err: any) {
      devError('[Auth] Session restore error:', err?.message);
      // Attempt to load cached profile for offline continuity
      const cachedProfile = await profileCache.loadProfile();
      if (cachedProfile) {
        setIsOffline(true);
        setUser(mapBackendUserToDomain({
          id: cachedProfile.id,
          name: cachedProfile.full_name || 'User',
          email: cachedProfile.email,
          profileImage: cachedProfile.avatar_url,
          role: cachedProfile.role || 'student',
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
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // ── Login with Google ───────────────────────────────────────────────────
  async function loginWithGoogle(): Promise<{ success: boolean; error?: string; profile?: User }> {
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
        setIsOffline(false);

        // Cache user profile for offline session continuity
        await profileCache.saveProfile({
          id: domainUser.id,
          email: domainUser.email,
          full_name: domainUser.name,
          role: domainUser.role,
          grade: domainUser.grade,
          school: domainUser.school,
          avatar_url: domainUser.avatar,
          age: domainUser.age,
          phone: domainUser.phone,
          onboarding_completed: domainUser.onboarding_completed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        registerForPushNotifications(domainUser.id).catch(() => {});

        setIsLoading(false);
        return { success: true, profile: domainUser };
      }

      setIsLoading(false);
      return { success: false, error: res.message || 'Login failed.' };
    } catch (err: any) {
      devError('[Auth] Google login error:', err?.message);
      setIsLoading(false);
      return { success: false, error: err?.message || 'Google sign-in failed. Please try again.' };
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
      devError('[Auth] Logout error:', err?.message);
      await tokenStorage.clearTokens();
      setUser(null);
      setSession(null);
      setIsAuthenticatedLocally(false);
    } finally {
      setIsLoading(false);
    }
  }

  // ── updateUser (Updates domain user via backend and synchronizes cache) ──
  async function updateUser(updates: Partial<User>): Promise<{ success: boolean; error?: string }> {
    if (!user) return { success: false, error: 'No user logged in' };

    try {
      const dto: { full_name?: string; grade?: string; school?: string; avatar_url?: string } = {};
      if (updates.name !== undefined) dto.full_name = updates.name;
      if (updates.grade !== undefined) dto.grade = updates.grade;
      if (updates.school !== undefined) dto.school = updates.school;
      if (updates.avatar !== undefined) dto.avatar_url = updates.avatar;

      // Send student-scoped profile update to backend (JWT provides identity)
      const res = await customAuthService.updateProfile(dto);

      const updatedBackendUser = res.data || {
        id: user.id,
        email: user.email,
        full_name: updates.name ?? user.name,
        grade: updates.grade ?? user.grade,
        school: updates.school ?? user.school,
        avatar_url: updates.avatar ?? user.avatar,
        role: user.role,
      };

      const updated: User = {
        ...user,
        ...updates,
        name: updatedBackendUser.full_name || updatedBackendUser.name || updates.name || user.name,
        avatar: updatedBackendUser.avatar_url || updatedBackendUser.profileImage || updates.avatar || user.avatar,
        grade: updatedBackendUser.grade !== undefined ? (updatedBackendUser.grade ?? undefined) : (updates.grade ?? user.grade),
        school: updatedBackendUser.school !== undefined ? (updatedBackendUser.school ?? undefined) : (updates.school ?? user.school),
      };

      setUser(updated);

      try {
        await profileCache.saveProfile({
          id: updated.id,
          email: updated.email,
          full_name: updated.name,
          role: updated.role,
          grade: updated.grade,
          school: updated.school,
          avatar_url: updated.avatar,
          age: updated.age,
          phone: updated.phone,
          onboarding_completed: updated.onboarding_completed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (cacheErr) {
        devLog('[Auth] Profile cache save notice:', cacheErr);
      }

      return { success: true };
    } catch (err: any) {
      devError('[Auth] Update profile error:', err?.message);
      return {
        success: false,
        error: err?.message || 'Failed to update profile. Please try again.',
      };
    }
  }

  // ── Placeholders for password/OTP auth (managed via Google OAuth) ─────────
  async function login(email: string, password: string): Promise<{ success: boolean; error?: string; profile?: User }> {
    try {
      setIsLoading(true);

      const res = await customAuthService.loginWithPassword(email, password);

      if (res.success && res.data) {
        const { accessToken, refreshToken, expiresIn, user: backendUser } = res.data;

        await tokenStorage.saveTokens(accessToken, refreshToken);

        const domainUser = mapBackendUserToDomain(backendUser);
        setUser(domainUser);
        setSession({ accessToken, refreshToken, expiresIn: expiresIn ?? 900 });
        setIsAuthenticatedLocally(true);
        setIsOffline(false);

        await profileCache.saveProfile({
          id: domainUser.id,
          email: domainUser.email,
          full_name: domainUser.name,
          role: domainUser.role,
          grade: domainUser.grade,
          school: domainUser.school,
          avatar_url: domainUser.avatar,
          age: domainUser.age,
          phone: domainUser.phone,
          onboarding_completed: domainUser.onboarding_completed,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        registerForPushNotifications(domainUser.id).catch(() => {});

        setIsLoading(false);
        return { success: true, profile: domainUser };
      }

      setIsLoading(false);
      return { success: false, error: res.message || 'Login failed. Please check your email and password.' };
    } catch (err: any) {
      devError('[Auth] Password login error:', err?.message);
      setIsLoading(false);
      return { success: false, error: err?.message || 'Login failed. Please check your email and password.' };
    }
  }

  async function register(
    name: string,
    email: string,
    password: string,
    _grade?: string,
    _school?: string,
    _phone?: string,
    _age?: number
  ): Promise<{ success: boolean; needsEmailVerification?: boolean; error?: string }> {
    try {
      const response = await customAuthService.registerWithPassword(
        email,
        password,
        name
      );

      return {
        success: response.success,
        error: response.success ? undefined : response.message || 'Registration failed.',
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Registration failed. Please try again.';

      devError('[Auth] Registration error:', message);

      return { success: false, error: message };
    }
  }

  async function resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      await customAuthService.requestPasswordReset(email);
      return { success: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to request a password reset. Please try again.';
      devError('[Auth] Password reset request failed:', message);
      return { success: false, error: message };
    }
  }

  async function updatePassword(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Password management is managed via Google Account security.' };
  }

  async function sendOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'OTP authentication is disabled. Please sign in with Google.' };
  }

  async function verifyOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'OTP verification is disabled. Please sign in with Google.' };
  }

  async function sendWhatsappOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp OTP is disabled. Please sign in with Google.' };
  }

  async function verifyWhatsappOtp(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'WhatsApp OTP verification is disabled. Please sign in with Google.' };
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
