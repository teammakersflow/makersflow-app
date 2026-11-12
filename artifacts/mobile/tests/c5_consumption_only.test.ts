// C-5 consumption-only release tests.
// Run: node --test artifacts/mobile/tests/*.test.ts   (Node >= 23.6)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decideCourseCta, hasActiveAccess, isFreeCourse, coursePriceLabel, isEnrollmentExpired,
  expiryBlocksAccess, ENFORCE_ENROLLMENT_EXPIRY,
} from "../lib/courseAccess.ts";
/** The expiry rule, kept for when it is switched on again (owner decision 2026-11-12: off). */
const ENFORCED = { enforceExpiry: true };
import { DIGITAL_COURSE_PURCHASES_IN_APP, isPhysicalStoreProduct } from "../constants/commerce.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const NOW = Date.parse("2026-11-10T00:00:00Z");
const paid = { isFree: false, price: 1999 };
const free = { isFree: true, price: 0 };

describe("policy switch", () => {
  test("in-app digital purchases are disabled for this release", () => {
    assert.equal(DIGITAL_COURSE_PURCHASES_IN_APP, false);
  });
});

describe("hasActiveAccess (allow-list, expiry, revocation)", () => {
  test("paid course needs completed/paid/free payment status", () => {
    for (const s of ["completed", "paid", "free", "COMPLETED"]) assert.equal(hasActiveAccess({ payment_status: s }, paid, NOW), true, s);
    for (const s of [null, undefined, "", "pending", "failed", "refunded", "weird"]) assert.equal(hasActiveAccess({ payment_status: s as any }, paid, NOW), false, String(s));
  });
  // 2026-11-11 (integration): aligned with the NestJS B-2 rule. A free course
  // also needs an allow-listed enrollment (was: any row).
  test("free course: same allow-list as paid (backend B-2)", () => {
    for (const s of ["completed", "free", "PAID"]) assert.equal(hasActiveAccess({ payment_status: s }, free, NOW), true, s);
    for (const s of [null, "", "pending", "failed", "processing", "refunded", "cancelled", "weird"]) {
      assert.equal(hasActiveAccess({ payment_status: s as any }, free, NOW), false, String(s));
    }
    assert.equal(hasActiveAccess({ payment_status: "pending", courses: { is_free: true } }, paid, NOW), false);
    assert.equal(hasActiveAccess({ payment_status: "completed", expires_at: "2027-01-01" }, free, NOW), true);
  });
  test("revoked status or no enrollment never has access", () => {
    assert.equal(hasActiveAccess({ payment_status: "completed", status: "cancelled" }, paid, NOW), false);
    assert.equal(hasActiveAccess({ payment_status: "free", status: "revoked" }, free, NOW), false);
    assert.equal(hasActiveAccess(null, free, NOW), false);
    assert.equal(isEnrollmentExpired({ expires_at: "2027-01-01" }, NOW), false);
  });

  // Owner decision 2026-11-12: expires_at is NOT enforced yet (same as the backend).
  test("expiry not enforced by default: expired + allowed status keeps access; bad status still denied", () => {
    assert.equal(ENFORCE_ENROLLMENT_EXPIRY, false);
    assert.equal(hasActiveAccess({ payment_status: "completed", expires_at: "2026-01-01" }, paid, NOW), true);
    assert.equal(hasActiveAccess({ payment_status: "free", expires_at: "2020-01-01" }, free, NOW), true);
    assert.equal(expiryBlocksAccess({ expires_at: "2026-01-01" }, NOW), false);
    assert.equal(isEnrollmentExpired({ expires_at: "2026-01-01" }, NOW), true, "the pure date check still works");
    for (const s of ["pending", "refunded", "failed", ""]) {
      assert.equal(hasActiveAccess({ payment_status: s, expires_at: "2099-01-01" }, paid, NOW), false, s);
    }
  });
  test("[enforced] expired never has access", () => {
    assert.equal(hasActiveAccess({ payment_status: "completed", expires_at: "2026-01-01" }, paid, NOW, ENFORCED), false);
    assert.equal(hasActiveAccess({ payment_status: "completed", expires_at: "2026-01-01" }, free, NOW, ENFORCED), false);
    assert.equal(hasActiveAccess({ payment_status: "completed", expires_at: "2027-01-01" }, free, NOW, ENFORCED), true);
    assert.equal(expiryBlocksAccess({ expires_at: "2026-01-01" }, NOW, ENFORCED), true);
  });
});

describe("decideCourseCta never offers a purchase", () => {
  const base = { enrollmentKnown: true, enrollmentCheckFailed: false, nowMs: NOW };
  test("signed out: paid → sign_in, free → enroll_free", () => {
    assert.equal(decideCourseCta({ ...base, signedIn: false, enrollment: null, course: paid }).kind, "sign_in");
    assert.equal(decideCourseCta({ ...base, signedIn: false, enrollment: null, course: free }).kind, "enroll_free");
  });
  test("owned (e.g. bought on the website) → continue", () => {
    assert.equal(decideCourseCta({ ...base, signedIn: true, enrollment: { payment_status: "completed" }, course: paid }).kind, "continue");
  });
  test("not owned paid → not_owned (informational only)", () => {
    assert.equal(decideCourseCta({ ...base, signedIn: true, enrollment: null, course: paid }).kind, "not_owned");
    assert.equal(decideCourseCta({ ...base, signedIn: true, enrollment: { payment_status: "pending" }, course: paid }).kind, "not_owned");
  });
  test("expiry not enforced: an expired paid or free enrollment → continue", () => {
    const expired = { payment_status: "completed", expires_at: "2026-01-01" };
    assert.equal(decideCourseCta({ ...base, signedIn: true, enrollment: expired, course: paid }).kind, "continue");
    assert.equal(decideCourseCta({ ...base, signedIn: true, enrollment: expired, course: free }).kind, "continue");
  });
  test("[enforced] expired paid → expired (no in-app renewal)", () => {
    assert.equal(decideCourseCta({ ...base, signedIn: true, enforceExpiry: true, enrollment: { payment_status: "completed", expires_at: "2026-01-01" }, course: paid }).kind, "expired");
  });
  test("free course without active access → enroll_free (re-enroll path)", () => {
    const cta = (enrollment: any, enforceExpiry?: boolean) => decideCourseCta({ ...base, signedIn: true, enforceExpiry, enrollment, course: free }).kind;
    assert.equal(cta(null), "enroll_free");
    assert.equal(cta({ payment_status: "pending" }), "enroll_free");
    assert.equal(cta({ payment_status: "failed" }), "enroll_free");
    assert.equal(cta({ payment_status: "completed", expires_at: "2026-01-01" }, true), "enroll_free");
    assert.equal(cta({ payment_status: "completed" }), "continue");
    assert.equal(cta({ payment_status: "free", expires_at: "2027-01-01" }), "continue");
  });
  test("checking / verify_failed", () => {
    assert.equal(decideCourseCta({ ...base, enrollmentKnown: false, signedIn: true, enrollment: null, course: paid }).kind, "checking");
    assert.equal(decideCourseCta({ ...base, enrollmentKnown: false, enrollmentCheckFailed: true, signedIn: true, enrollment: null, course: paid }).kind, "verify_failed");
  });
  test("labels never contain an amount", () => {
    assert.equal(coursePriceLabel(paid), "Premium");
    assert.equal(coursePriceLabel(free), "Free");
    assert.equal(isFreeCourse({ price: 0 }), true);
    assert.equal(isFreeCourse({ price: 0, isFree: false }), false);
  });
});

describe("store sells physical goods only", () => {
  test("isPhysicalStoreProduct", () => {
    assert.equal(isPhysicalStoreProduct({ category: "physical" }), true);
    assert.equal(isPhysicalStoreProduct({ category: "digital" }), false);
    assert.equal(isPhysicalStoreProduct({ category: "physical", is_course: true }), false);
    assert.equal(isPhysicalStoreProduct({ category: "physical", course_id: 5 }), false);
    assert.equal(isPhysicalStoreProduct({ type: "subscription" }), false);
    assert.equal(isPhysicalStoreProduct(null), false);
  });
});

describe("static: no digital-goods purchase path remains in the app", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      if (["node_modules", "android", "ios", ".expo", "tests", "assets"].includes(n)) continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(tsx?|jsx?)$/.test(n)) out.push(p);
    }
    return out;
  }
  const files = walk(root);

  test("Razorpay checkout is used only for physical goods (store checkout, kit shipping)", () => {
    const users = files
      .map((f) => path.relative(root, f).replace(/\\/g, "/"))
      // the definitions themselves are not callers
      .filter((rel) => rel !== "services/razorpayService.ts" && rel !== "components/RazorpayWebView.tsx")
      .filter((rel) => /createRazorpayOrder\(|<RazorpayWebView/.test(read(rel)));
    // 2026-11-12: components/IncludedKitClaim.tsx pays SHIPPING for a physical
    // kit (feature-flagged off). The next test pins down that it stays that way.
    assert.deepEqual(users.sort(), ["app/store/checkout.tsx", "components/IncludedKitClaim.tsx"]);
  });

  test("included-kit Razorpay use is shipping-only, never creates course orders, and is flag-gated", () => {
    const s = read("components/IncludedKitClaim.tsx");
    assert.ok(!/createRazorpayOrder\(/.test(s), "must not create Razorpay orders itself (server creates the shipping order)");
    assert.ok(!/razorpayService|\/payments\//.test(s), "must not use the course/store payment endpoints");
    assert.ok(!/order_type/.test(s));
    assert.match(s, /if \(!isIncludedKitClaimEnabled\(\)\) return null;/);
    assert.match(s, /description: `\$\{claim\.kit\.name\} kit shipping`/);
    const svc = read("services/includedKitService.ts");
    for (const ep of ["/included-kits/my", "/included-kits/claim", "/included-kits/verify-payment"]) {
      assert.ok(svc.includes(ep), ep);
    }
    assert.ok(!/\/payments\//.test(svc));
  });

  test("course screens contain no price, Buy or Renew purchase CTA", () => {
    for (const rel of ["app/course/[id].tsx", "app/course/learn.tsx", "components/CourseCard.tsx", "app/favorites.tsx"]) {
      const s = read(rel);
      assert.ok(!/Buy Now|Renew Access|Renew Now|Move to Cart/.test(s), rel);
      assert.ok(!/₹\$\{(course|fav)\.price\}/.test(s), `${rel}: shows course price`);
      assert.ok(!/order_type:\s*"course"/.test(s), rel);
    }
  });

  test("no in-app steering to an external purchase page", () => {
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      const rel = path.relative(root, f);
      assert.ok(!/(buy|purchase|renew)[^\n]{0,60}(website|makersflow\.(in|com))/i.test(s), `${rel}: steering wording`);
      assert.ok(!/Linking\.openURL\([^)]*(checkout|pricing|buy|purchase)/i.test(s), `${rel}: external checkout link`);
    }
    assert.ok(!/Renewal/.test(read("app/course/learn.tsx")));
  });

  test("help text no longer says paid courses are bought via Razorpay", () => {
    assert.ok(!/Paid courses require a one-time payment/.test(read("app/settings/help.tsx")));
  });

  test("cart and checkout enforce physical-only", () => {
    assert.match(read("context/CartContext.tsx"), /if \(!isPhysicalStoreProduct\(product as any\)\) return;/);
    assert.match(read("app/store/checkout.tsx"), /const hasDigital = items\.some\(\(i\) => !isPhysicalStoreProduct/);
    assert.match(read("services/productService.ts"), /isPhysicalStoreProduct\(p as any\)/);
  });
});
