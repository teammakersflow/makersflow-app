// L-26 encrypted profile cache (revised 2026-11-11): never plaintext, session-only on failure,
// migration, logout, account switching and token-bound isolation.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProfileCache, profileMatchesToken, SECURE_KEY, type KV } from "../lib/profileCacheCore.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY = "cached_user_profile";

function secureKV(opts: { failSet?: boolean; failGet?: boolean } = {}) {
  const m = new Map<string, string>();
  const kv: KV & { m: Map<string, string> } = {
    m,
    get: async (k) => { if (opts.failGet) throw new Error("keystore down"); return m.get(k) ?? null; },
    set: async (k, v) => { if (opts.failSet) throw new Error("keystore down"); m.set(k, v); },
    remove: async (k) => { m.delete(k); },
  };
  return kv;
}
/** Legacy plaintext store: any write attempt is recorded and fails the test. */
function plainKV(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    m, writes,
    get: async (k: string) => m.get(k) ?? null,
    remove: async (k: string) => { m.delete(k); },
    set: async (k: string) => { writes.push(k); throw new Error("plaintext writes are forbidden"); },
  };
}
const A = { id: "11111111-aaaa", email: "a@x.in", full_name: "Asha", role: "student", phone: "9876543210", age: 12, school: "ABC", grade: "7", avatar_url: "https://x/a.png" };
const B = { id: "22222222-bbbb", email: "b@x.in", full_name: "Ravi", role: "student", phone: "9123456789", age: 15, school: "XYZ", grade: "10" };
const wrap = (p: unknown) => JSON.stringify({ version: 1, updatedAt: "t", profile: p });
const jwtFor = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;

describe("L-26 storage", () => {
  test("saves encrypted only; nothing in plaintext", async () => {
    const secure = secureKV(), plain = plainKV();
    const c = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    assert.equal(await c.save(A), true);
    assert.ok(secure.m.has(SECURE_KEY));
    assert.equal(plain.m.size, 0);
    assert.deepEqual(plain.writes, []);
    assert.deepEqual(await c.load(), A);
  });

  test("keystore write failure: session-only memory, NO plaintext fallback, reported as not persisted", async () => {
    const secure = secureKV({ failSet: true }), plain = plainKV();
    const c = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    assert.equal(await c.save(A), false, "caller learns it was not persisted");
    assert.deepEqual(plain.writes, [], "never written to plaintext");
    assert.equal(plain.m.size, 0);
    assert.deepEqual(await c.load(), A, "available for this session");
    // simulated app restart: a new cache instance has nothing → app must fetch /auth/me
    const afterRestart = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    assert.equal(await afterRestart.load(), null);
  });

  test("keystore read failure does not expose or fabricate data", async () => {
    const c = createProfileCache({ secure: secureKV({ failGet: true }), legacyPlain: plainKV(), legacyKey: LEGACY });
    assert.equal(await c.load(), null);
  });

  test("legacy plaintext is migrated to the keystore and deleted", async () => {
    const secure = secureKV(), plain = plainKV({ [LEGACY]: wrap(A) });
    const c = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    assert.deepEqual(await c.load(), A);
    assert.ok(secure.m.has(SECURE_KEY));
    assert.equal(plain.m.has(LEGACY), false);
  });

  test("legacy plaintext is deleted even when the keystore is unavailable", async () => {
    const plain = plainKV({ [LEGACY]: wrap(A) });
    const c = createProfileCache({ secure: secureKV({ failSet: true }), legacyPlain: plain, legacyKey: LEGACY });
    assert.deepEqual(await c.load(), A, "kept in memory for this session");
    assert.equal(plain.m.has(LEGACY), false, "plaintext removed");
    assert.deepEqual(plain.writes, []);
  });

  test("logout clears keystore, memory and legacy plaintext", async () => {
    const secure = secureKV({ failSet: false }), plain = plainKV({ [LEGACY]: wrap(A) });
    const c = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    await c.save(A);
    await c.clear();
    assert.equal(secure.m.size + plain.m.size, 0);
    assert.equal(await c.load(), null);
  });

  test("logout also clears a session-only (memory) copy", async () => {
    const c = createProfileCache({ secure: secureKV({ failSet: true }), legacyPlain: plainKV(), legacyKey: LEGACY });
    await c.save(A);
    await c.clear();
    assert.equal(await c.load(), null);
  });

  test("account switch: B replaces A; A's data is not returned", async () => {
    const secure = secureKV(), plain = plainKV();
    const c = createProfileCache({ secure, legacyPlain: plain, legacyKey: LEGACY });
    await c.save(A);
    await c.clear(); // logout of A
    await c.save(B);
    const loaded = await c.load();
    assert.equal(loaded?.id, B.id);
    assert.ok(!JSON.stringify(secure.m.get(SECURE_KEY)).includes("Asha"));
  });

  test("version mismatch is ignored", async () => {
    const secure = secureKV();
    secure.m.set(SECURE_KEY, JSON.stringify({ version: 99, profile: A }));
    const c = createProfileCache({ secure, legacyPlain: plainKV(), legacyKey: LEGACY });
    assert.equal(await c.load(), null);
  });
});

describe("L-26 isolation guard", () => {
  test("profile is usable only with a token for the same user", () => {
    assert.equal(profileMatchesToken(A, jwtFor(A.id)), true);
    assert.equal(profileMatchesToken(A, jwtFor(B.id)), false, "another account's token");
    assert.equal(profileMatchesToken(A, null), false);
    assert.equal(profileMatchesToken(A, "not-a-jwt"), false);
    assert.equal(profileMatchesToken(null, jwtFor(A.id)), false);
  });

  test("AuthContext applies the guard offline and never merges another user's cache online", () => {
    const s = readFileSync(path.join(root, "context/AuthContext.tsx"), "utf8");
    assert.match(s, /profileMatchesToken\(cachedProfile, storedAccess\)/);
    assert.match(s, /String\(cachedProfile\.id\) === String\(\(response\.data as any\)\?\.id\) \? cachedProfile : null/);
    assert.match(s, /if \(cacheUsable && cachedProfile\)/);
  });

  test("service never writes the profile to AsyncStorage", () => {
    const s = readFileSync(path.join(root, "services/profileCache.ts"), "utf8");
    assert.ok(!/AsyncStorage\.setItem/.test(s), "no plaintext writes");
    assert.match(s, /SecureStore\.setItemAsync/);
  });
});
