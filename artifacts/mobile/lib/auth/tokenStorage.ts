import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'makersflow_access_token';
const REFRESH_TOKEN_KEY = 'makersflow_refresh_token';

/**
 * Encrypted token storage adapter using expo-secure-store with AsyncStorage fallback.
 */
export const tokenStorage = {
  async getAccessToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(ACCESS_TOKEN_KEY);
      }
      const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (token) return token;
      return await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      try {
        return await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      } catch {
        return null;
      }
    }
  },

  async getRefreshToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(REFRESH_TOKEN_KEY);
      }
      const token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (token) return token;
      return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      try {
        return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      } catch {
        return null;
      }
    }
  },

  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
        return;
      }
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      await AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } catch {
      try {
        await AsyncStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
        await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      } catch {
        // ignore
      }
    }
  },

  async clearTokens(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem('makersflow.auth');
        return;
      }
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      await SecureStore.deleteItemAsync('makersflow.auth').catch(() => {});
      await AsyncStorage.removeItem(ACCESS_TOKEN_KEY).catch(() => {});
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => {});
      await AsyncStorage.removeItem('makersflow.auth').catch(() => {});
    } catch {
      try {
        await AsyncStorage.removeItem(ACCESS_TOKEN_KEY).catch(() => {});
        await AsyncStorage.removeItem(REFRESH_TOKEN_KEY).catch(() => {});
      } catch {
        // ignore
      }
    }
  },
};
