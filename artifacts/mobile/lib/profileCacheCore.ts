/**
 * Cached-profile storage (fix L-26, revised 2026-11-11). Pure, dependency-injected, unit-tested.
 *
 * The profile (name, email, phone, age, school, grade, ...) used to be stored as
 * plaintext JSON in AsyncStorage. Now:
 *  - it is stored ONLY in the encrypted keystore (expo-secure-store);
 *  - it is NEVER written to plaintext storage, not even as a fallback;
 *  - if the keystore is unavailable, the profile is kept in memory for this
 *    app session only. On the next launch the app fetches it from the backend
 *    (GET /auth/me), so offline restore is simply unavailable in that rare case;
 *  - a legacy plaintext entry from older app versions is migrated to the keystore
 *    when possible, and is ALWAYS deleted afterwards (its content is held in
 *    memory if the keystore write fails).
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const PROFILE_VERSION = 1;
export const SECURE_KEY = "makersflow_profile_v1";

type Payload<P> = { version: number; updatedAt: string; profile: P };

export function createProfileCache<P extends Record<string, any>>(deps: {
  secure: KV;
  /** Legacy plaintext store. Only ever read (for migration) and removed, never written. */
  legacyPlain: Pick<KV, "get" | "remove">;
  legacyKey: string;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());
  let memory: P | null = null; // session-only copy when the keystore is unavailable

  const parse = (raw: string | null): P | null => {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Payload<P>;
      return p && p.version === PROFILE_VERSION && p.profile ? p.profile : null;
    } catch {
      return null;
    }
  };
  const wrap = (profile: P) => JSON.stringify({ version: PROFILE_VERSION, updatedAt: now(), profile });

  return {
    async load(): Promise<P | null> {
      try {
        const fromSecure = parse(await deps.secure.get(SECURE_KEY));
        if (fromSecure) return fromSecure;
      } catch {
        // keystore unavailable: fall through to the session copy
      }
      if (memory) return memory;

      // Legacy plaintext from app versions up to 1.0.8: migrate if possible, always delete.
      let legacy: P | null = null;
      try { legacy = parse(await deps.legacyPlain.get(deps.legacyKey)); } catch { legacy = null; }
      if (!legacy) return null;
      try {
        await deps.secure.set(SECURE_KEY, wrap(legacy));
      } catch {
        memory = legacy; // session only
      }
      await deps.legacyPlain.remove(deps.legacyKey).catch(() => {});
      return legacy;
    },

    /** Returns true when stored encrypted, false when kept for this session only. */
    async save(profile: P): Promise<boolean> {
      try {
        await deps.secure.set(SECURE_KEY, wrap(profile));
        memory = null;
        await deps.legacyPlain.remove(deps.legacyKey).catch(() => {});
        return true;
      } catch {
        memory = profile;
        await deps.legacyPlain.remove(deps.legacyKey).catch(() => {});
        return false;
      }
    },

    async clear(): Promise<boolean> {
      memory = null;
      let ok = true;
      await deps.secure.remove(SECURE_KEY).catch(() => { ok = false; });
      await deps.legacyPlain.remove(deps.legacyKey).catch(() => { ok = false; });
      return ok;
    },
  };
}

/**
 * Cache isolation guard (L-26 / M-25): a cached profile may only be used for a
 * session whose access token belongs to the same user. This decodes the JWT
 * payload (no signature check; the server verifies tokens) and compares `sub`.
 */
export function profileMatchesToken(profile: { id?: unknown } | null | undefined, accessToken: string | null | undefined): boolean {
  if (!profile?.id || !accessToken) return false;
  const part = accessToken.split(".")[1];
  if (!part) return false;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub === String(profile.id);
  } catch {
    return false;
  }
}
