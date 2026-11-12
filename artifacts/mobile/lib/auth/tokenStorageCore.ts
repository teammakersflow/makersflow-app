/**
 * Token storage core (fix H-7, 2026-11-10). Pure, dependency-injected, unit-tested.
 *
 * Native: tokens live ONLY in the encrypted keystore (expo-secure-store).
 *   - Legacy plaintext copies in AsyncStorage, written by app versions up to
 *     1.0.8, are migrated on first read and then deleted.
 *   - If the keystore write fails, tokens are kept in memory for this session
 *     only. They are never written to plaintext storage.
 * Web: localStorage (unchanged; there is no keystore on web).
 */

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const ACCESS_TOKEN_KEY = "makersflow_access_token";
export const REFRESH_TOKEN_KEY = "makersflow_refresh_token";
export const LEGACY_EXTRA_KEYS = ["makersflow.auth"];

export function createTokenStorage(deps: { secure: KV; legacy: KV; web?: KV | null }) {
  const memory = new Map<string, string>();
  const { secure, legacy, web } = deps;

  async function read(key: string): Promise<string | null> {
    if (web) return web.get(key).catch(() => null);
    if (memory.has(key)) return memory.get(key)!;
    let value: string | null = null;
    try {
      value = await secure.get(key);
    } catch {
      value = null;
    }
    if (value) return value;

    // One-time migration of a legacy plaintext token.
    let legacyValue: string | null = null;
    try { legacyValue = await legacy.get(key); } catch { legacyValue = null; }
    if (!legacyValue) return null;
    try {
      await secure.set(key, legacyValue);
    } catch {
      memory.set(key, legacyValue);
    }
    await legacy.remove(key).catch(() => {});
    return legacyValue;
  }

  async function write(key: string, value: string): Promise<void> {
    if (web) { await web.set(key, value); return; }
    try {
      await secure.set(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value); // session-only; never plaintext on disk
    }
    await legacy.remove(key).catch(() => {});
  }

  async function remove(key: string): Promise<void> {
    memory.delete(key);
    if (web) { await web.remove(key).catch(() => {}); return; }
    await secure.remove(key).catch(() => {});
    await legacy.remove(key).catch(() => {});
  }

  return {
    getAccessToken: () => read(ACCESS_TOKEN_KEY),
    getRefreshToken: () => read(REFRESH_TOKEN_KEY),
    async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
      await write(ACCESS_TOKEN_KEY, accessToken);
      await write(REFRESH_TOKEN_KEY, refreshToken);
    },
    async clearTokens(): Promise<void> {
      await remove(ACCESS_TOKEN_KEY);
      await remove(REFRESH_TOKEN_KEY);
      for (const k of LEGACY_EXTRA_KEYS) await remove(k);
    },
  };
}
