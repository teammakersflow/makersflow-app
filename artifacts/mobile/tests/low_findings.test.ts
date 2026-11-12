// Low-severity fixes and checks: L-5, L-15, L-17, L-20, L-24, L-25, L-26, M-11.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Low findings", () => {
  test("L-5: Windows-only CMake staging dir", () => {
    const g = read("android/app/build.gradle");
    assert.match(g, /if \(System\.getProperty\("os\.name"\)\.toLowerCase\(\)\.contains\("windows"\)\) \{\s*externalNativeBuild/);
  });
  test("L-15: debug logs no longer in the app folder", () => {
    assert.equal(existsSync(path.join(root, "bundle-debug.log")), false);
    assert.equal(existsSync(path.join(root, "bundle-debug-metro-fixed.log")), false);
  });
  test("L-17: alerts are queued, button text optional, modal rendered in every branch", () => {
    const s = read("app/_layout.tsx");
    assert.match(s, /alertQueue\.current\.push\(next\)/);
    assert.match(s, /const label = String\(btn\?\.text \?\? "OK"\);/);
    assert.ok((s.match(/\{alertModal\}/g) ?? []).length >= 3, "modal in font-wait, offline and main branches");
  });
  test("L-20: explicit {success:false} profile update is a failure", () => {
    assert.match(read("context/AuthContext.tsx"), /if \(\(res as any\)\?\.success === false\)/);
  });
  test("L-20: HTTP error responses are not classified as network failures", async () => {
    const { isNetworkError } = await import("../lib/networkUtils.ts");
    assert.equal(isNetworkError({ status: 500, message: "fetch failed on server" }), false);
    assert.equal(isNetworkError({ status: 404, message: "connection record not found" }), false);
    assert.equal(isNetworkError({ status: 0, message: "Network request failed" }), true);
    assert.equal(isNetworkError({ status: 408 }), true);
  });
  test("L-24: PIN codes cannot start with 0; invoice uses postal_code", () => {
    const s = read("app/store/checkout.tsx");
    assert.match(s, /\/\^\[1-9\]\\d\{5\}\$\/\.test\(formPostalCode\.trim\(\)\)/);
    assert.match(s, /pendingAddress\?\.postal_code \|\| pendingAddress\?\.pincode/);
  });
  test("L-25: no permission prompt on every app resume", () => {
    assert.match(read("components/AppGate.tsx"), /registerForPushNotifications\(user\.id, \{ prompt: false \}\)/);
    assert.match(read("lib/pushNotifications.ts"), /existing !== "granted" && mayPrompt && canAskAgain !== false/);
  });
  test("L-26: auth provider logs are dev-only", () => {
    const s = read("lib/auth/authProviders.ts");
    for (const line of s.split("\n").filter((l) => /console\.(log|error)\(/.test(l))) {
      assert.match(line, /if \(__DEV__\)/, line.trim());
    }
  });
  test("M-11: logout also signs out of Google", () => {
    assert.match(read("context/AuthContext.tsx"), /await signOutOfGoogle\(\);/);
    assert.match(read("lib/auth/authProviders.ts"), /await GoogleSignin\.signOut\(\);/);
  });
});
