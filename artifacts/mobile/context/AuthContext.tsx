import { profileMatchesToken } from '@/lib/profileCacheCore';
import { clearCourseStructureCache } from '@/services/courseDataProvider';
import { cacheManager } from '@/services/cacheManager';
import { decideRestoreFallback } from '@/lib/auth/sessionRestore';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useNetwork } from '@/context/NetworkContext';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { emitSessionExpired, onSessionExpired } from '@/lib/sessionEvents';
import { tokenStorage } from '@/lib/auth/tokenStorage';
import { clearAllDownloads } from '@/lib/downloadStorage';
import { customAuthService } from '@/lib/auth/customAuthService';
import { GoogleAuthProvider, signOutOfGoogle } from '@/lib/auth/authProviders';
import { mapBackendUserToDomain, CustomSession, Profile } from '@/types/auth';
import { profileCache } from '@/services/profileCache';
import { homeRepository } from '@/repositories/homeRepository';
import { coursesRepository } from '@/repositories/coursesRepository';
import { clearEnrollmentCache } from '@/services/enrollmentService';
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
  const { isInternetReachable } = useNetwork();
  const [user, setUser] = useState<User | null>(null);
  // M-25: the cache owner follows the signed-in user synchronously, so user-scoped
  // cache entries are always read and written under the right account.
  const applyUser = useCallback((u: User | null) => {
    cacheManager.setCacheOwner(u?.id ?? null);
    setUser(u);
  }, []);
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

      // A complete pair of saved tokens is required for authenticated access.
      if (!accessToken || !refreshToken) {
        await Promise.allSettled([
          tokenStorage.clearTokens(),
          profileCache.clearProfile(),
          homeRepository.clearUserCache(),
          coursesRepository.clearUserCache(),
          Promise.resolve().then(() => clearEnrollmentCache()),
        ]);

        applyUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
        setIsOffline(false);
        return;
      }

      setIsAuthenticatedLocally(true);

      const response = await customAuthService.getCurrentUser();

      if (response.success && response.data) {
        const cachedProfile = await profileCache.loadProfile();

        // The API client may have refreshed the access token during GET /auth/me.
        const latestAccessToken = await tokenStorage.getAccessToken();
        const latestRefreshToken = await tokenStorage.getRefreshToken();

        if (!latestAccessToken || !latestRefreshToken) {
          emitSessionExpired();
          return;
        }

        // L-26 isolation: never merge another account's cached profile fields.
        const sameUserCache = cachedProfile && String(cachedProfile.id) === String((response.data as any)?.id) ? cachedProfile : null;
        if (cachedProfile && !sameUserCache) await profileCache.clearProfile().catch(() => {});
        const domainUser = mapBackendUserToDomain(
          response.data,
          sameUserCache,
        );

        applyUser(domainUser);
        setSession({
          accessToken: latestAccessToken,
          refreshToken: latestRefreshToken,
          expiresIn: 900,
        });
        setIsOffline(false);
        setIsAuthenticatedLocally(true);
      } else {
        const invalid: any = new Error('Session validation returned an unsuccessful response.');
        invalid.invalidBody = true;
        throw invalid;
      }
    } catch (err: any) {
      devError('[Auth] Session restore error:', err?.message);

      // A confirmed 401 must never restore a cached authenticated user.
      if (err?.status === 401) {
        applyUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
        setIsOffline(false);
        emitSessionExpired();
        return;
      }

      // Preserve cached access, but only report offline when NetInfo confirms
      // that the device has no network connection.
      let confirmedOffline = false;
      try {
        const networkState = await NetInfo.fetch();
        confirmedOffline = networkState.isInternetReachable === false;
      } catch (networkError) {
        devLog('[Auth] Could not confirm network state:', networkError);
      }

      // M-7: only transient failures may fall back to the cached profile.
      const fallback = decideRestoreFallback({ status: err?.status, confirmedOffline, invalidBody: !!err?.invalidBody });
      if (fallback === 'sign_out') {
        await tokenStorage.clearTokens().catch(() => {});
        await profileCache.clearProfile().catch(() => {});
        applyUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
        setIsOffline(false);
        return;
      }

      const cachedProfile = await profileCache.loadProfile();
      const [storedAccess, storedRefresh] = await Promise.all([
        tokenStorage.getAccessToken(),
        tokenStorage.getRefreshToken(),
      ]);

      // L-26 isolation: the cached profile is used only if it belongs to the
      // user of the stored session token. A mismatch (e.g. leftovers from a
      // previous account) is discarded rather than shown.
      const cacheUsable = !!(cachedProfile?.id && cachedProfile?.email) && profileMatchesToken(cachedProfile, storedAccess);
      if (cachedProfile && !cacheUsable) await profileCache.clearProfile().catch(() => {});

      if (cacheUsable && cachedProfile) {
        setIsOffline(confirmedOffline);
        setIsAuthenticatedLocally(true);
        // Keep the stored tokens as the session, so API calls resume when the server is reachable.
        setSession(storedAccess && storedRefresh ? { accessToken: storedAccess, refreshToken: storedRefresh, expiresIn: 900 } : null);

        applyUser(
          mapBackendUserToDomain(
            {
              id: cachedProfile.id,
              name: cachedProfile.full_name || 'User',
              email: cachedProfile.email,
              profileImage: cachedProfile.avatar_url,
              role: cachedProfile.role || 'student',
            },
            cachedProfile,
          ),
        );
      } else {
        applyUser(null);
        setSession(null);
        setIsAuthenticatedLocally(false);
        setIsOffline(false);
      }
    } finally {
      setIsLoading(false);
      setAuthInitialized(true);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);
  // Clear stale offline mode only when internet access is confirmed.
  useEffect(() => {
    if (isInternetReachable === true) {
      setIsOffline(false);
    }
  }, [isInternetReachable]);
  // Handle expired sessions centrally, including errors raised outside the UI.
  useEffect(() => {
    return onSessionExpired(() => {
      applyUser(null);
      setSession(null);
      setIsAuthenticatedLocally(false);
      setIsOffline(false);
      setIsLoading(false);

      void (async () => {
        const results = await Promise.allSettled([
          tokenStorage.clearTokens(),
          profileCache.clearProfile(),
          homeRepository.clearUserCache(),
          coursesRepository.clearUserCache(),
          Promise.resolve().then(() => clearEnrollmentCache()),
        ]);

        results.forEach((result) => {
          if (result.status === 'rejected') {
            devError('[Auth] Session cleanup error:', result.reason);
          }
        });
      })();

      Alert.alert(
        'Session expired',
        'Your session has expired. Please log in again to continue.',
        [
          { text: 'Keep Watching', style: 'cancel' },
          {
            text: 'Log In',
            onPress: () => router.replace('/(auth)/login'),
          },
        ],
      );
    });
  }, []);

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
        clearEnrollmentCache();
        await tokenStorage.saveTokens(accessToken, refreshToken);

        let domainUser = mapBackendUserToDomain(backendUser);
        // H-4: the Google login payload may omit profile fields (grade,
        // onboarding_completed). Fetch the full profile so returning users are
        // not sent to onboarding again. Best effort; never blocks sign-in.
        if (!domainUser.grade && domainUser.onboarding_completed !== true) {
          try {
            const me = await customAuthService.getCurrentUser();
            if (me.success && me.data) domainUser = mapBackendUserToDomain(me.data as any);
          } catch {
            // keep the login payload
          }
        }
        applyUser(domainUser);
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
      clearEnrollmentCache();
      // 1. H-12: unregister this device's push token FIRST, while the session is
      //    still valid. The previous order revoked the session first, so the
      //    unregister call was unauthenticated and the token stayed linked.
      await unregisterPushToken(user?.id).catch(() => {});

      // 2. Revoke the server session.
      await customAuthService.logout().catch(() => {});
      // M-11: also end the native Google session (account switching).
      await signOutOfGoogle();

      // 3. Clear local tokens, then every per-user cache. Each step runs even
      //    if another one fails (M-25), and downloads are wiped (H-10).
      await tokenStorage.clearTokens();
      await Promise.allSettled([
        profileCache.clearProfile(),
        homeRepository.clearUserCache(),
        coursesRepository.clearUserCache(),
        clearAllDownloads(),
        clearCourseStructureCache(),
      ]);
      clearEnrollmentCache();


      applyUser(null);
      setSession(null);
      setIsAuthenticatedLocally(false);
    } catch (err: any) {
      devError('[Auth] Logout error:', err?.message);
      await tokenStorage.clearTokens();
      await Promise.allSettled([
        profileCache.clearProfile(),
        homeRepository.clearUserCache(),
        coursesRepository.clearUserCache(),
        clearAllDownloads(),
        clearCourseStructureCache(),
      ]);
      applyUser(null);
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

      // L-20: an explicit {success:false} from the server is a failure, not a save.
      if ((res as any)?.success === false) {
        return { success: false, error: (res as any)?.message || 'Profile could not be updated.' };
      }

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

      applyUser(updated);

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

        clearEnrollmentCache();
        await tokenStorage.saveTokens(accessToken, refreshToken);

        const domainUser = mapBackendUserToDomain(backendUser);
        applyUser(domainUser);
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
