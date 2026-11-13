// High-severity mobile fixes: H-4, H-7, H-8, H-10, H-12, M-8 (plus M-22, M-25 bits).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTokenStorage, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, type KV } from "../lib/auth/tokenStorageCore.ts";
import { decideAuthGate, postLoginRoute } from "../lib/authGate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function memKV(initial: Record<string, string> = {}, opts: { failSet?: boolean } = {}): KV & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => { if (opts.failSet) throw new Error("keystore unavailable"); data.set(k, v); },
    remove: async (k) => { data.delete(k); },
  };
}

describe("H-7 token storage", () => {
  test("saveTokens writes only to the secure store, never plaintext", async () => {
    const secure = memKV(), legacy = memKV();
    const ts = createTokenStorage({ secure, legacy });
    await ts.saveTokens("acc", "ref");
    assert.equal(secure.data.get(ACCESS_TOKEN_KEY), "acc");
    assert.equal(secure.data.get(REFRESH_TOKEN_KEY), "ref");
    assert.equal(legacy.data.size, 0);
  });
  test("legacy plaintext tokens are migrated to the secure store and deleted", async () => {
    const secure = memKV(), legacy = memKV({ [ACCESS_TOKEN_KEY]: "oldA", [REFRESH_TOKEN_KEY]: "oldR" });
    const ts = createTokenStorage({ secure, legacy });
    assert.equal(await ts.getAccessToken(), "oldA");
    assert.equal(await ts.getRefreshToken(), "oldR");
    assert.equal(secure.data.get(ACCESS_TOKEN_KEY), "oldA");
    assert.equal(legacy.data.size, 0, "plaintext copies removed");
  });
  test("keystore failure keeps tokens in memory only (never plaintext)", async () => {
    const secure = memKV({}, { failSet: true }), legacy = memKV();
    const ts = createTokenStorage({ secure, legacy });
    await ts.saveTokens("acc", "ref");
    assert.equal(await ts.getAccessToken(), "acc");
    assert.equal(legacy.data.size, 0);
  });
  test("clearTokens removes everything, including legacy keys", async () => {
    const secure = memKV({ [ACCESS_TOKEN_KEY]: "a", [REFRESH_TOKEN_KEY]: "r" });
    const legacy = memKV({ [ACCESS_TOKEN_KEY]: "a", "makersflow.auth": "x" });
    const ts = createTokenStorage({ secure, legacy });
    await ts.clearTokens();
    assert.equal(secure.data.size + legacy.data.size, 0);
    assert.equal(await ts.getAccessToken(), null);
  });
  test("tokenStorage.ts no longer writes tokens to AsyncStorage directly", () => {
    const s = strip(read("lib/auth/tokenStorage.ts"));
    assert.ok(!/AsyncStorage\.setItem\(/.test(s));
    assert.match(s, /createTokenStorage\(/);
  });
});

describe("H-4 / M-8 auth gate", () => {
  const T = { authInitialized: true };
  test("signed-in user may stay on (auth)/onboarding (was blanked before)", () => {
    assert.equal(decideAuthGate({ ...T, authed: true, segments: ["(auth)", "onboarding"] }), "render");
  });
  test("signed-in user on login is redirected to tabs", () => {
    assert.equal(decideAuthGate({ ...T, authed: true, segments: ["(auth)", "login"] }), "redirect_to_tabs");
  });
  test("signed-out user can see auth screens; other screens render", () => {
    assert.equal(decideAuthGate({ ...T, authed: false, segments: ["(auth)", "login"] }), "render");
    assert.equal(decideAuthGate({ ...T, authed: true, segments: ["(tabs)"] }), "render");
  });
  test("spinner only during the initial restore (M-8)", () => {
    assert.equal(decideAuthGate({ authInitialized: false, authed: false, segments: [] }), "spinner");
    assert.equal(decideAuthGate({ authInitialized: false, authed: true, segments: ["(tabs)"] }), "render");
  });
  test("postLoginRoute: new user → onboarding, returning → tabs", () => {
    assert.equal(postLoginRoute({ grade: null }), "/(auth)/onboarding");
    assert.equal(postLoginRoute({ grade: "8" }), "/(tabs)");
    assert.equal(postLoginRoute({ onboarding_completed: true }), "/(tabs)");
    assert.equal(postLoginRoute(null), "/(tabs)");
  });
  test("ProtectedRoute no longer blanks the tree or depends on isLoading", () => {
    const s = strip(read("components/ProtectedRoute.tsx"));
    assert.ok(!/return null/.test(s), "must not render null for the whole navigator");
    assert.ok(!/isLoading/.test(s), "login/logout isLoading must not unmount the navigator");
    assert.match(s, /decideAuthGate\(/);
  });
});

describe("H-12 / H-10 / M-25 logout", () => {
  const s = strip(read("context/AuthContext.tsx"));
  const logout = s.slice(s.indexOf("async function logout()"), s.indexOf("async function updateUser"));
  test("push token is unregistered before the server session is revoked", () => {
    const u = logout.indexOf("unregisterPushToken("), r = logout.indexOf("customAuthService.logout(");
    assert.ok(u > 0 && r > 0 && u < r, "unregister must come first");
  });
  test("logout wipes downloads and clears caches with allSettled", () => {
    assert.match(logout, /clearAllDownloads\(\)/);
    assert.match(logout, /Promise\.allSettled\(/);
  });
  test("unregister works without notification permission (uses cached token)", () => {
    const p = strip(read("lib/pushNotifications.ts"));
    const fn = p.slice(p.indexOf("export async function unregisterPushToken"));
    assert.ok(fn.indexOf("LAST_PUSH_TOKEN_KEY") < fn.indexOf("getPermissionsAsync"), "cached token read before permission check");
  });
  test("clearAllDownloads only touches the app's own videos folder", () => {
    const d = strip(read("lib/downloadStorage.ts"));
    assert.match(d, /deleteAsync\(docDir \+ 'videos\/'/);
    assert.match(d, /k\.startsWith\('download:'\)/);
  });
});

describe("H-8 / M-22 signed video URL", () => {
  const s = strip(read("app/course/learn.tsx"));
  test("player receives a refresh callback for expired signed URLs", () => {
    assert.match(s, /onRefreshVideoUrl=\{refreshActiveSignedUrl\}/);
  });
  test("players are keyed per lesson (no stale cross-lesson ticks)", () => {
    assert.match(s, /key=\{`remote-\$\{activeModule\?\.id\}`\}/);
    assert.match(s, /key=\{`local-\$\{activeModule\?\.id\}`\}/);
  });
  test("failed signed-URL fetch shows an error with retry instead of a blank area", () => {
    // 2026-11-13: HTTP 429 is its own "busy" state, not a connection error.
    assert.match(s, /setSignedUrlError\(\s*status === 401 \|\| status === 403 \? "forbidden" : status === 429 \? "busy" : "network",?\s*\)/);
    assert.match(s, /setSignedUrlAttempt\(\(n\) => n \+ 1\)/);
  });
  test("player resumes position after a source swap", () => {
    const v = strip(read("components/VideoPlayerEnhanced.tsx"));
    assert.match(v, /resumeAfterReplaceRef\.current = Number\.isFinite\(at\) && at > 1 \? at : null/);
    assert.match(v, /player\.currentTime = t/);
  });
});

describe("H-13 / H-14 / L-1 / L-2 / L-3 Android config", () => {
  const appJson = JSON.parse(read("app.json")).expo.android;
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  test("app.json has no duplicates and blocks location/overlay/exact alarm", () => {
    assert.equal(new Set(appJson.permissions).size, appJson.permissions.length);
    assert.equal(new Set(appJson.blockedPermissions).size, appJson.blockedPermissions.length);
    assert.equal(new Set(appJson.intentFilters.map((f: unknown) => JSON.stringify(f))).size, appJson.intentFilters.length);
    for (const p of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "SYSTEM_ALERT_WINDOW", "SCHEDULE_EXACT_ALARM"]) {
      assert.ok(appJson.blockedPermissions.includes(`android.permission.${p}`), p);
      assert.ok(!appJson.permissions.includes(`android.permission.${p}`), p);
    }
  });
  test("main manifest removes location, overlay and exact alarm; no legacy storage flag", () => {
    for (const p of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "SYSTEM_ALERT_WINDOW", "SCHEDULE_EXACT_ALARM"]) {
      assert.match(manifest, new RegExp(`android\\.permission\\.${p}" tools:node="remove"`), p);
    }
    assert.ok(!/requestLegacyExternalStorage/.test(manifest));
  });
});
