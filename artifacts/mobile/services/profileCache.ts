import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Profile } from '@/types/auth';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import { createProfileCache, type KV } from '@/lib/profileCacheCore';

/**
 * Cached user profile for offline session continuity.
 * L-26 (revised 2026-11-11): encrypted keystore only. It is never written in
 * plaintext. If the keystore is unavailable, it is kept in memory for this
 * session and re-fetched from the backend on the next launch.
 * See lib/profileCacheCore.ts.
 */
const legacyPlain = {
  get: (k: string) => AsyncStorage.getItem(k),
  remove: (k: string) => AsyncStorage.removeItem(k),
};

// On web there is no keystore. The profile is then session-only (memory), so
// nothing is persisted in plaintext there either.
const unavailable: KV = {
  get: async () => null,
  set: async () => { throw new Error('No encrypted storage on this platform'); },
  remove: async () => {},
};
const secure: KV = Platform.OS === 'web'
  ? unavailable
  : {
      get: (k) => SecureStore.getItemAsync(k),
      set: (k, v) => SecureStore.setItemAsync(k, v),
      remove: (k) => SecureStore.deleteItemAsync(k),
    };

const core = createProfileCache<Profile & Record<string, any>>({
  secure,
  legacyPlain,
  legacyKey: STORAGE_KEYS.CACHED_USER_PROFILE,
});

export const profileCache = {
  loadProfile: async (): Promise<Profile | null> => {
    try {
      return await core.load();
    } catch {
      return null;
    }
  },
  saveProfile: async (profile: Profile): Promise<boolean> => core.save(profile as Profile & Record<string, any>),
  clearProfile: async (): Promise<boolean> => core.clear(),
};
