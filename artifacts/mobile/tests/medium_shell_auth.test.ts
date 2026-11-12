// Medium fixes: M-6, M-7, M-24, M-25, M-29, M-30, M-31 (+ L-18, L-19, L-20 parts).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReconnectTracker } from "../lib/reconnect.ts";
import { decideRestoreFallback } from "../lib/auth/sessionRestore.ts";
import { routeForNotification, safeInAppLink } from "../lib/notificationRouting.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("M-24 reconnect tracker", () => {
  test("fires on false → null → true (the case the old code missed)", () => {
    const t = createReconnectTracker();
    assert.equal(t.observe(false), false);
    assert.equal(t.observe(null), false);
    assert.equal(t.observe(true), true);
  });
  test("fires once per transition; not on initial true or repeated true", () => {
    const t = createReconnectTracker();
    assert.equal(t.observe(true), false);
    assert.equal(t.observe(true), false);
    t.observe(false);
    assert.equal(t.observe(true), true);
    assert.equal(t.observe(true), false);
  });
  test("NetworkContext uses the tracker for both events and refreshNetwork, memoised", () => {
    const s = strip(read("context/NetworkContext.tsx"));
    assert.match(s, /createReconnectTracker\(\)/);
    assert.match(s, /const refreshNetwork = useCallback\(async[\s\S]*?apply\(state\.isConnected, state\.isInternetReachable\)/);
    assert.match(s, /useMemo\(/);
  });
});

describe("M-7 session restore fallback", () => {
  test("transient failures keep the cached profile", () => {
    for (const status of [0, 408, 429, 500, 502, 503, 504, undefined]) {
      assert.equal(decideRestoreFallback({ status, confirmedOffline: false }), "use_cached_profile", String(status));
    }
    assert.equal(decideRestoreFallback({ status: 404, confirmedOffline: true }), "use_cached_profile");
  });
  test("definitive answers sign out (deleted/forbidden account, bad body)", () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422]) {
      assert.equal(decideRestoreFallback({ status, confirmedOffline: false }), "sign_out", String(status));
    }
    assert.equal(decideRestoreFallback({ status: 200, confirmedOffline: false, invalidBody: true }), "sign_out");
  });
  test("AuthContext applies the decision and keeps stored tokens as the session", () => {
    const s = strip(read("context/AuthContext.tsx"));
    assert.match(s, /decideRestoreFallback\(/);
    assert.match(s, /setSession\(storedAccess && storedRefresh \?/);
  });
});

describe("M-29 / L-18 notification routing", () => {
  test("known screens and validated ids", () => {
    assert.equal(routeForNotification({ screen: "orders" }), "/store/orders");
    assert.equal(routeForNotification({ screen: "course", courseId: 42 }), "/course/42");
    assert.equal(routeForNotification({ screen: "news", newsId: "n_1" }), "/news/n_1");
    assert.equal(routeForNotification({ screen: "announcements", announcementId: "7" }), "/notifications");
  });
  test("malformed or hostile payloads fall back safely", () => {
    for (const d of [null, "x", { screen: "course" }, { screen: "course", courseId: "../../x" }, { screen: "course", courseId: "a b" }, { screen: "https://evil" }]) {
      assert.equal(routeForNotification(d), "/notifications", JSON.stringify(d));
    }
  });
  test("safeInAppLink allows only known relative app routes", () => {
    assert.equal(safeInAppLink("/store/orders"), "/store/orders");
    assert.equal(safeInAppLink("/course/12"), "/course/12");
    for (const l of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/../x", "/unknown", "/course/ 1", 5, null]) {
      assert.equal(safeInAppLink(l), null, String(l));
    }
  });
  test("AppGate registers immediately, reads cold-start response, and cleans up", () => {
    const s = strip(read("components/AppGate.tsx"));
    assert.match(s, /getLastNotificationResponseAsync/);
    assert.match(s, /routeForNotification\(/);
    assert.ok(!/setTimeout\(\(\) => \{\s*try \{\s*const Notifications = require/.test(s), "no delayed registration");
    assert.match(s, /return \(\) => \{\s*sub\?\.remove\?\.\(\);/);
  });
  test("resource links are https-only", () => {
    assert.match(strip(read("components/LearningTabs.tsx")), /\^https:\\\/\\\/\[\^\\s\]\+\$/);
  });
});

describe("M-25 user-scoped cache", () => {
  test("cacheManager scopes user keys and drops stale-scope writes", () => {
    const s = strip(read("services/cacheManager.ts"));
    assert.match(s, /`\$\{key\}::\$\{cacheOwner\}`/);
    assert.match(s, /if \(scope && \(scope\.epoch !== ownerEpoch \|\| scope\.owner !== cacheOwner\)\) return false;/);
    assert.match(s, /if \(!cacheOwner\) return false;/);
  });
  test("every user-key write in repositories carries the captured scope", () => {
    for (const f of ["repositories/coursesRepository.ts", "repositories/homeRepository.ts"]) {
      const s = read(f);
      const writes = s.match(/cacheManager\.write\(STORAGE_KEYS\.CACHED_(COURSES_ENROLLMENTS|HOME_PROGRESS|HOME_NOTIFICATIONS)[^)]*\)/g) ?? [];
      assert.ok(writes.length > 0, f);
      for (const w of writes) assert.match(w, /, scope\)$/, `${f}: ${w}`);
      assert.match(s, /const scope = cacheManager\.userScope\(\);/);
    }
  });
  test("AuthContext sets the cache owner synchronously with the user", () => {
    const s = strip(read("context/AuthContext.tsx"));
    assert.match(s, /cacheManager\.setCacheOwner\(u\?\.id \?\? null\);\s*setUser\(u\);/);
    const direct = (s.match(/\bsetUser\(/g) ?? []).length;
    assert.equal(direct, 1, "only applyUser may call setUser");
  });
});

describe("M-6 / L-19 / L-20 API client", () => {
  const s = strip(read("lib/auth/apiClient.ts"));
  test("refresh is time-limited and single-flight", () => {
    assert.match(s, /setTimeout\(\(\) => controller\.abort\(\), REFRESH_TIMEOUT_MS\)/);
    assert.match(s, /function refreshOnce\(\)/);
    assert.ok(!/isRefreshing/.test(s), "old flag-based refresh queue removed");
  });
  test("bearer token only for the API origin; logout never triggers refresh", () => {
    assert.match(s, /isApiOrigin\(url, baseUrl\)/);
    assert.match(s, /'\/auth\/logout'/);
  });
  test("production API URL must be https", () => {
    assert.match(read("lib/auth/apiClient.ts"), /must use https:\/\/ in production/);
  });
});

describe("M-30 / M-31 app shell", () => {
  test("unread badge no longer polls every 15 s", () => {
    const s = strip(read("app/(tabs)/_layout.tsx"));
    assert.ok(!/15000/.test(s));
    assert.match(s, /AppState\.addEventListener\("change"/);
    assert.match(s, /addReconnectListener\(checkNotifications\)/);
  });
  test("font failure does not leave a blank screen", () => {
    const s = strip(read("app/_layout.tsx"));
    assert.match(s, /if \(\(!fontsLoaded && !fontError\) \|\| hasEverLoaded === null\)/);
  });
});
