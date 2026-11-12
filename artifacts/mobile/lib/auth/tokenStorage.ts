import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createTokenStorage, type KV } from './tokenStorageCore';

/**
 * Auth token storage (fix H-7, 2026-11-10).
 *
 * Native: encrypted keystore only (expo-secure-store). Legacy plaintext copies
 * in AsyncStorage are migrated once, then deleted. See tokenStorageCore.ts.
 */
const secure: KV = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};
// Legacy plaintext store: read (for one-time migration) and delete only.
const legacy: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: async () => {
    throw new Error('Plaintext token storage is disabled (H-7)');
  },
  remove: (k) => AsyncStorage.removeItem(k),
};
const web: KV | null = Platform.OS === 'web'
  ? {
      get: async (k) => localStorage.getItem(k),
      set: async (k, v) => localStorage.setItem(k, v),
      remove: async (k) => localStorage.removeItem(k),
    }
  : null;

export const tokenStorage = createTokenStorage({ secure, legacy, web });
