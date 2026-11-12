// Account deletion (Play readiness, revised 2026-11-11). Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeleteConfirmationValid, isDeletionConfirmed } from "../lib/accountDeletion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("account deletion", () => {
  test("typed confirmation is a UI safeguard (no fake password step)", () => {
    for (const ok of ["DELETE", "delete", " Delete "]) assert.equal(isDeleteConfirmationValid(ok), true, ok);
    for (const bad of ["", "anything", "DELET", null, undefined]) assert.equal(isDeleteConfirmationValid(bad as any), false, String(bad));
    const s = read("app/(tabs)/profile.tsx");
    assert.ok(!/re-enter your password/.test(s));
    assert.match(s, /isDeleteConfirmationValid\(deletePassword\)/);
  });

  test("the typed word is never sent to the server and is not used as authentication", () => {
    const svc = read("lib/auth/customAuthService.ts");
    const fn = svc.slice(svc.indexOf("async deleteAccount"), svc.indexOf("async deleteAccount") + 300);
    assert.match(fn, /apiRequest<[^>]*>\('\/users\/me', \{\s*method: 'DELETE',\s*\}\)/, "no body, no password, no user id");
    assert.ok(!/deletePassword/.test(fn));
  });

  test("request identifies the user only by the session token (no id in the URL)", () => {
    const svc = read("lib/auth/customAuthService.ts");
    assert.ok(!/\/users\/\$\{/.test(svc.slice(svc.indexOf("async deleteAccount"), svc.indexOf("async deleteAccount") + 300)));
    const api = read("lib/auth/apiClient.ts");
    assert.match(api, /if \(accessToken && !headers\['Authorization'\] && isApiOrigin\(url, baseUrl\)\)/, "bearer attached to our API only");
  });

  test("deletion is only reported when the server confirms it", () => {
    assert.equal(isDeletionConfirmed({ success: true }), true);
    assert.equal(isDeletionConfirmed(undefined), true, "204 No Content");
    assert.equal(isDeletionConfirmed({}), true);
    assert.equal(isDeletionConfirmed({ success: false, message: "x" }), false);
    assert.equal(isDeletionConfirmed("ok"), false);
    const s = read("app/(tabs)/profile.tsx");
    const i = s.indexOf("const result = await customAuthService.deleteAccount();");
    assert.ok(i > 0 && s.indexOf("if (!isDeletionConfirmed(result))", i) > i, "checked before logout/success alert");
    assert.ok(s.indexOf("await logout();", i) > s.indexOf("if (!isDeletionConfirmed(result))", i));
  });
});
