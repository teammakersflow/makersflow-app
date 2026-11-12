// Course kit card, add kit to cart, included-kit claim (feature-flagged OFF).
// 2026-11-12. Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCourseKitPayload,
  kitTotal,
  kitCardMode,
  kitCartAction,
  mergeCartLines,
  formatRupees,
  addKitToCart,
} from "../lib/courseKit.ts";
import {
  parseClaimsPayload,
  findClaimForCourse,
  claimIdempotencyKey,
  claimView,
  buildClaimRequest,
  unwrapClaimResult,
  verifyResultOk,
  interpretClaimResult,
  claimErrorMessage,
  KIT_MESSAGES,
  type KitClaim,
} from "../lib/includedKitClaim.ts";
import { FEATURE_FLAGS, isIncludedKitClaimEnabled } from "../constants/featureFlags.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// ── Fixtures shaped like NestJS GET /kits/course/:id (wrapped by ResponseInterceptor) ──
const wrap = (data: unknown) => ({ success: true, message: "Request completed successfully", data });

// Course 21: no kit.
const NO_KIT = wrap({ course_id: "21", kit: null });
// Course 44: free course, kit sold separately. Prices arrive as strings (Prisma Decimal via JSON.stringify).
const FREE_WITH_KIT = wrap({
  course_id: "44",
  kit: {
    id: "kit-uuid-44",
    name: "Robotics Starter Kit",
    description: "Everything for the course",
    items: [
      { product_id: "7", title: "Arduino Uno", slug: "arduino-uno", quantity: 1, price: "499", image: "https://img/7.jpg", available: true },
      { product_id: "9", title: "Jumper wires", slug: "jumper-wires", quantity: 2, price: "49.5", image: null, available: true },
    ],
    all_available: true,
  },
  kit_included: false,
  kit_purchase_required: true,
  label: "Kit available for purchase (not included free)",
});
// Course 45: paid course, kit included.
const PAID_WITH_KIT = wrap({
  course_id: "45",
  kit: {
    id: "kit-uuid-45",
    name: "Drone Kit",
    description: null,
    items: [{ product_id: "11", title: "Frame", slug: "frame", quantity: 1, price: "1999", image: null, available: true }],
    all_available: true,
  },
  kit_included: true,
  kit_purchase_required: false,
  label: "Kit included with course",
});

describe("kit API response parsing (GET /kits/course/:id, reads `data`)", () => {
  test("kit null (course 21) → null, so the course screen is unchanged", () => {
    assert.equal(parseCourseKitPayload(NO_KIT), null);
  });

  test("error / unusable payloads → null", () => {
    assert.equal(parseCourseKitPayload(null), null);
    assert.equal(parseCourseKitPayload({ success: false, message: "Course not found" }), null);
    assert.equal(parseCourseKitPayload({ success: true }), null);
    assert.equal(parseCourseKitPayload(wrap({ course_id: "1", kit: { items: [] } })), null);
    assert.equal(parseCourseKitPayload(wrap({ course_id: "1", kit: { items: [{ product_id: "1", quantity: 0 }] } })), null);
    // Not reading `data` would see this top-level kit; the parser must ignore it.
    assert.equal(parseCourseKitPayload({ success: true, kit: FREE_WITH_KIT.data.kit, data: { kit: null } }), null);
  });

  test("included kit (course 45): included mode, no add-to-cart action", () => {
    const kit = parseCourseKitPayload(PAID_WITH_KIT)!;
    assert.equal(kit.kit_included, true);
    assert.equal(kitCardMode(kit), "included");
    assert.deepEqual(kitCartAction(kit), { kind: "none" });
  });

  test("separately sold kit (course 44): string prices parsed, total and button label", () => {
    const kit = parseCourseKitPayload(FREE_WITH_KIT)!;
    assert.equal(kitCardMode(kit), "separate");
    assert.equal(kit.kit.items[0].price, 499);
    assert.equal(kit.kit.items[1].price, 49.5);
    assert.equal(kit.kit.items[1].quantity, 2);
    assert.equal(kitTotal(kit.kit), 598);
    assert.deepEqual(kitCartAction(kit), { kind: "add", label: "Add kit to cart · ₹598", total: 598 });
  });

  test("numeric prices and paise totals", () => {
    const kit = parseCourseKitPayload(wrap({
      ...FREE_WITH_KIT.data,
      kit: { ...FREE_WITH_KIT.data.kit, items: [{ ...FREE_WITH_KIT.data.kit.items[0], price: 199.5, quantity: 3 }] },
    }))!;
    assert.equal(kitTotal(kit.kit), 598.5);
    assert.equal(formatRupees(598.5), "598.50");
    assert.equal((kitCartAction(kit) as any).label, "Add kit to cart · ₹598.50");
  });

  test("unavailable kit: all_available false → disabled 'Kit currently unavailable'", () => {
    const kit = parseCourseKitPayload(wrap({ ...FREE_WITH_KIT.data, kit: { ...FREE_WITH_KIT.data.kit, all_available: false } }))!;
    assert.equal(kit.kit.all_available, false);
    assert.deepEqual(kitCartAction(kit), { kind: "unavailable", label: "Kit currently unavailable" });
  });

  test("an unavailable item makes the kit unavailable even if all_available says true", () => {
    const items = FREE_WITH_KIT.data.kit.items.map((i, n) => (n === 1 ? { ...i, available: false } : i));
    const kit = parseCourseKitPayload(wrap({ ...FREE_WITH_KIT.data, kit: { ...FREE_WITH_KIT.data.kit, items } }))!;
    assert.equal(kit.kit.all_available, false);
    assert.equal(kitCartAction(kit).kind, "unavailable");
  });

  test("a missing price never produces a wrong total", () => {
    const items = FREE_WITH_KIT.data.kit.items.map((i, n) => (n === 0 ? { ...i, price: null } : i));
    const kit = parseCourseKitPayload(wrap({ ...FREE_WITH_KIT.data, kit: { ...FREE_WITH_KIT.data.kit, items } }))!;
    assert.equal(kitTotal(kit.kit), null);
    assert.equal(kitCartAction(kit).kind, "unavailable");
  });

  test("no add-to-cart unless the server says the kit must be bought separately", () => {
    const kit = parseCourseKitPayload(wrap({ ...FREE_WITH_KIT.data, kit_purchase_required: false }))!;
    assert.deepEqual(kitCartAction(kit), { kind: "none" });
  });
});

describe("cart quantity behaviour for kits", () => {
  const p = (id: string) => ({ id });

  test("new products are appended with the kit quantity", () => {
    const out = mergeCartLines([], [{ product: p("7"), quantity: 1 }, { product: p("9"), quantity: 2 }]);
    assert.deepEqual(out.map((l) => [l.product.id, l.quantity]), [["7", 1], ["9", 2]]);
  });

  test("a product already in the cart has its quantity increased (same rule as addToCart)", () => {
    const existing = [{ product: p("9"), quantity: 1 }, { product: p("50"), quantity: 4 }];
    const out = mergeCartLines(existing, [{ product: p("7"), quantity: 1 }, { product: p("9"), quantity: 2 }]);
    assert.deepEqual(out.map((l) => [l.product.id, l.quantity]), [["9", 3], ["50", 4], ["7", 1]]);
  });

  test("adding the kit twice adds it twice; ids compared as strings; input not mutated", () => {
    const existing = [{ product: { id: "7" }, quantity: 1 }];
    const once = mergeCartLines(existing, [{ product: { id: "7" }, quantity: 1 }]);
    const twice = mergeCartLines(once, [{ product: { id: "7" }, quantity: 1 }]);
    assert.equal(existing[0].quantity, 1);
    assert.equal(once[0].quantity, 2);
    assert.equal(twice[0].quantity, 3);
  });

  test("invalid quantities are ignored", () => {
    const out = mergeCartLines([], [{ product: p("1"), quantity: 0 }, { product: p("2"), quantity: 1.5 }, { product: p("3"), quantity: -1 }]);
    assert.deepEqual(out, []);
  });

  test("CartContext: kit add is one atomic, physical-only, all-or-nothing update; addToCart unchanged", () => {
    const s = read("context/CartContext.tsx");
    assert.match(s, /function addItemsToCart\(entries: \{ product: Product; quantity: number \}\[\]\): boolean/);
    assert.match(s, /isPhysicalStoreProduct\(e\.product as any\) && Number\.isInteger\(e\.quantity\) && e\.quantity > 0/);
    assert.match(s, /if \(!valid\) return false;/);
    assert.match(s, /setItems\(\(prev\) => \{\s*const next = mergeCartLines\(prev, entries\);/);
    // existing single-item behaviour is untouched
    assert.match(s, /if \(!isPhysicalStoreProduct\(product as any\)\) return;/);
    assert.match(s, /if \(now - lastAddRef\.current < 500\)/);
    assert.match(s, /quantity: i\.quantity \+ 1/);
  });
});

describe("course kit card wiring", () => {
  test("course screen renders the card only when a kit exists, above the tab bar and description", () => {
    const s = read("app/course/[id].tsx");
    const card = s.indexOf("{courseKit?.kit && <CourseKitCard");
    const tabs = s.indexOf("{/* Tab bar */}");
    const about = s.indexOf("About this course");
    assert.ok(card > 0, "card rendered conditionally");
    assert.ok(card < tabs && card < about, "card above tabs and description");
    assert.equal((s.match(/Kit included with course/g) ?? []).length, 0, "old inline card removed");
  });

  test("kit service reads `data` through the parser and swallows errors", () => {
    const s = read("services/courseKitService.ts");
    assert.match(s, /return parseCourseKitPayload\(await response\.json\(\)\);/);
    assert.match(s, /if \(!response\.ok\) return null;/);
    assert.match(s, /catch \{[\s\S]*return null;/);
  });

  test("card: badges, prices only when sold separately, unavailable state, existing cart reused", () => {
    const s = read("components/CourseKitCard.tsx");
    assert.match(s, /"Kit included with course"/);
    assert.match(s, /"Kit sold separately"/);
    assert.match(s, /!included && item\.price != null/);
    assert.match(s, /!included && cartAction\.kind === "add"/);
    assert.match(s, /disabled=\{cartAction\.kind !== "add" \|\| adding\}/);
    // Add goes through the tested all-or-nothing decision (lib/courseKit.ts addKitToCart).
    assert.match(s, /await addKitToCart<Product>\(\{/);
    assert.match(s, /loadProduct: \(productId\) => productService\.getProductById\(productId\)/);
    assert.match(s, /addItemsToCart,\n?\s*\}\)/);
    assert.ok(!/createRazorpayOrder|RazorpayWebView|\/payments\/|\/orders\/checkout/.test(s), "no new checkout or payment path");
    assert.ok(!/\bbuy\b/i.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "no 'buy' wording in UI (C-5)");
  });
});

// ── Included kit claim ─────────────────────────────────────────────────────
const baseClaim: KitClaim = {
  id: "claim-uuid-1",
  status: "pending",
  course_purchase_id: "301",
  course: { id: "45", title: "Drones" },
  kit: { id: "kit-uuid-45", name: "Drone Kit", items: [] },
  order: null,
  shipping_address_id: null,
  payment_status: null,
};

describe("feature flag", () => {
  test("INCLUDED_KIT_CLAIM defaults to OFF", () => {
    assert.equal(FEATURE_FLAGS.INCLUDED_KIT_CLAIM, false);
    assert.equal(isIncludedKitClaimEnabled(), false);
  });

  test("flag is a build-time constant, not read from env or server", () => {
    const s = read("constants/featureFlags.ts");
    assert.match(s, /INCLUDED_KIT_CLAIM: false,/);
    assert.ok(!/process\.env|EXPO_PUBLIC|fetch\(|apiRequest/.test(s));
  });

  test("claim UI renders nothing and mounts no hooks when the flag is off", () => {
    const s = read("components/IncludedKitClaim.tsx");
    const gate = s.indexOf("if (!isIncludedKitClaimEnabled()) return null;");
    const outer = s.indexOf("export function IncludedKitClaim(");
    const inner = s.indexOf("function IncludedKitClaimEnabled(");
    assert.ok(outer > 0 && gate > outer && gate < inner, "gate is the first statement of the exported component");
    const outerBody = s.slice(outer, inner);
    assert.ok(!/use[A-Z]\w*\(/.test(outerBody), "no hooks before the gate");
  });

  test("every included-kit API call refuses to run when the flag is off", () => {
    const s = read("services/includedKitService.ts");
    for (const fn of ["fetchMyKitClaims", "claimIncludedKit", "verifyKitPayment"]) {
      const body = s.slice(s.indexOf(`export async function ${fn}`));
      // first statement of the function body (after the `): Promise<...> {` signature)
      assert.match(body, /^[^]*?\):\s*Promise<[^>]+>\s*\{\s*assertEnabled\(\);/, `${fn} starts with assertEnabled()`);
      const firstBody = body.match(/\):\s*Promise<[^>]+>\s*\{([^]*?)\n\}/)![1];
      assert.ok(firstBody.trim().startsWith("assertEnabled();"), `${fn}: assertEnabled() runs before any request`);
    }
    assert.match(s, /if \(!isIncludedKitClaimEnabled\(\)\) \{\s*throw/);
  });

  test("claim UI is reachable only through the kit card, and only for included kits", () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (["node_modules", "android", "ios", ".expo", "tests", "assets"].includes(n)) continue;
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?)$/.test(n)) {
          const rel = path.relative(root, p).replace(/\\/g, "/");
          const src = readFileSync(p, "utf8");
          if (/from "@\/components\/IncludedKitClaim"|from "@\/services\/includedKitService"/.test(src)) users.push(rel);
        }
      }
    };
    walk(root);
    assert.deepEqual(users.sort(), ["components/CourseKitCard.tsx", "components/IncludedKitClaim.tsx"]);
    assert.match(read("components/CourseKitCard.tsx"), /\{included && <IncludedKitClaim courseId=\{courseId\} \/>\}/);
  });
});

describe("included-kit claim: parsing and lookup", () => {
  test("GET /included-kits/my is wrapped; ids normalised; older contract (no new fields) tolerated", () => {
    const claims = parseClaimsPayload(wrap([
      { id: "c1", status: "pending", course_purchase_id: 301, course: { id: 45, title: "Drones" }, kit: baseClaim.kit, order: null, created_at: "x" },
      { id: "c2", status: "fulfilled", course_purchase_id: "302", course: { id: "44", title: "Robots" }, kit: baseClaim.kit,
        order: { id: "o2", status: "pending_fulfillment" }, shipping_address_id: 88, payment_status: "captured" },
    ]));
    assert.equal(claims.length, 2);
    assert.equal(claims[0].course_purchase_id, "301");
    assert.equal(claims[0].course.id, "45");
    assert.equal(claims[0].payment_status, null);
    assert.equal(claims[0].shipping_address_id, null);
    assert.equal(claims[1].shipping_address_id, "88");
    assert.deepEqual(parseClaimsPayload({ success: true, data: null }), []);
  });

  test("finds the claim whose course.id matches the current course", () => {
    const claims = [{ ...baseClaim, id: "a", course: { id: "44", title: "" } }, { ...baseClaim, id: "b" }];
    assert.equal(findClaimForCourse(claims, 45)?.id, "b");
    assert.equal(findClaimForCourse(claims, "44")?.id, "a");
    assert.equal(findClaimForCourse(claims, "21"), null);
  });
});

describe("included-kit claim: states", () => {
  test("fulfilled → Kit ordered", () => {
    assert.deepEqual(claimView({ ...baseClaim, status: "fulfilled", order: { id: "o", status: "x" } }), { kind: "fulfilled" });
  });
  test("order + captured → processing (no button)", () => {
    assert.deepEqual(claimView({ ...baseClaim, order: { id: "o", status: "x" }, payment_status: "captured" }), { kind: "processing" });
  });
  test("order + pending / failed → Complete shipping payment, with the stored address", () => {
    for (const ps of ["pending", "failed"] as const) {
      assert.deepEqual(
        claimView({ ...baseClaim, order: { id: "o", status: "x" }, payment_status: ps, shipping_address_id: "88" }),
        { kind: "payment_due", addressId: "88" },
      );
    }
  });
  test("order without a stored address → payment due, address must be selected", () => {
    assert.deepEqual(claimView({ ...baseClaim, order: { id: "o", status: "x" }, payment_status: "pending" }), { kind: "payment_due", addressId: null });
  });
  test("no order → Claim your free kit", () => {
    assert.deepEqual(claimView(baseClaim), { kind: "claim" });
  });
  test("mobile additions: claim processing, and free shipping awaiting fulfilment, show processing", () => {
    assert.deepEqual(claimView({ ...baseClaim, status: "processing" }), { kind: "processing" });
    assert.deepEqual(claimView({ ...baseClaim, order: { id: "o", status: "x" }, payment_status: "not_required" }), { kind: "processing" });
  });
});

describe("included-kit claim: idempotency and request body", () => {
  test("key is always kit-claim-<claimId>", () => {
    assert.equal(claimIdempotencyKey(baseClaim), "kit-claim-claim-uuid-1");
    assert.equal(claimIdempotencyKey({ id: "x" }), claimIdempotencyKey({ id: "x" }));
  });

  test("no order and no selected address → no request (ask for an address)", () => {
    assert.equal(buildClaimRequest(baseClaim, null), null);
    assert.equal(buildClaimRequest(baseClaim, ""), null);
  });

  test("first claim uses the selected address", () => {
    assert.deepEqual(buildClaimRequest(baseClaim, "12"), {
      coursePurchaseId: "301",
      shippingAddressId: "12",
      idempotencyKey: "kit-claim-claim-uuid-1",
    });
  });

  test("retries reuse the same key AND the order's stored address, even if another is selected", () => {
    const withOrder = { ...baseClaim, order: { id: "o", status: "x" }, payment_status: "pending" as const, shipping_address_id: "88" };
    const a = buildClaimRequest(withOrder, "12");
    const b = buildClaimRequest(withOrder, null);
    assert.deepEqual(a, b);
    assert.equal(a!.shippingAddressId, "88");
    assert.equal(a!.idempotencyKey, buildClaimRequest(baseClaim, "12")!.idempotencyKey);
  });

  test("retry of an order with no stored address uses the newly selected one", () => {
    const withOrder = { ...baseClaim, order: { id: "o", status: "x" }, payment_status: "failed" as const };
    assert.equal(buildClaimRequest(withOrder, null), null);
    assert.equal(buildClaimRequest(withOrder, "12")!.shippingAddressId, "12");
  });
});

describe("included-kit claim: responses", () => {
  test("claim response is wrapped (data); verify-payment is NOT wrapped", () => {
    assert.deepEqual(unwrapClaimResult(wrap({ claimId: "c", paymentRequired: false })), { claimId: "c", paymentRequired: false });
    assert.equal(verifyResultOk({ success: true, orderId: "o", claimId: "c", message: "Payment verified" }), true);
    assert.equal(verifyResultOk({ success: true, alreadyFulfilled: true, message: "already" }), true);
    assert.equal(verifyResultOk({ success: false, message: "x" }), false);
    assert.equal(verifyResultOk(null), false);
    assert.ok(!/\.data\b/.test(read("services/includedKitService.ts").split("verifyKitPayment")[1]), "verify result is read unwrapped");
  });

  test("new claim with paymentRequired → open Razorpay with order id, key and paise", () => {
    const out = interpretClaimResult({ claimId: "c", shippingAmount: "60.00", currency: "INR", paymentRequired: true, razorpayOrderId: "order_ABC123xyz", razorpayKeyId: "rzp_test_abcdef123" });
    assert.deepEqual(out, { action: "pay", razorpayOrderId: "order_ABC123xyz", razorpayKeyId: "rzp_test_abcdef123", amountPaise: 6000, currency: "INR" });
  });

  test("reused claim (same key) uses the server's paise amount", () => {
    const out = interpretClaimResult({ reused: true, paymentRequired: true, amount: 4550, shippingAmount: "45.50", razorpayOrderId: "order_R1", razorpayKeyId: "rzp_test_k1" });
    assert.equal(out.action, "pay");
    assert.equal((out as any).amountPaise, 4550);
  });

  test("paymentRequired without a key or order id is an error, never a fake success", () => {
    assert.equal(interpretClaimResult({ paymentRequired: true, shippingAmount: "60.00", razorpayOrderId: "order_X", razorpayKeyId: null }).action, "error");
    assert.equal(interpretClaimResult({ paymentRequired: true, razorpayOrderId: null, razorpayKeyId: "rzp_test_k" }).action, "error");
  });

  test("requiresReconciliation → processing; fulfilledNow / alreadyFulfilled → success", () => {
    assert.deepEqual(interpretClaimResult({ reused: true, paymentRequired: false, requiresReconciliation: true }), { action: "processing", message: KIT_MESSAGES.processing });
    assert.deepEqual(interpretClaimResult({ reused: true, paymentRequired: false, fulfilledNow: true, alreadyFulfilled: true }), { action: "done", message: KIT_MESSAGES.fulfilledNow });
    assert.deepEqual(interpretClaimResult({ reused: true, paymentRequired: false, alreadyFulfilled: true }), { action: "done", message: KIT_MESSAGES.alreadyFulfilled });
    assert.deepEqual(interpretClaimResult({ paymentRequired: false, message: "No shipping payment is required." }), { action: "done", message: KIT_MESSAGES.confirmed });
  });

  test("409 'No new payment order was created' → 'Please try again shortly'", () => {
    const err = Object.assign(new Error("Unable to confirm the existing Razorpay order status. Please retry later or contact support. No new payment order was created."), { status: 409 });
    assert.equal(claimErrorMessage(err), "Please try again shortly");
    assert.equal(claimErrorMessage(new Error("A valid 6-digit delivery pincode is required")), "A valid 6-digit delivery pincode is required");
    assert.equal(claimErrorMessage({}), KIT_MESSAGES.genericError);
  });

  test("UI copy for the states", () => {
    const s = read("components/IncludedKitClaim.tsx");
    for (const text of ["Kit ordered ✓", "Claim your free kit", "Complete shipping payment", "/store/orders"]) {
      assert.ok(s.includes(text), text);
    }
    assert.equal(KIT_MESSAGES.processing, "Payment received, we're processing your kit");
  });
});

// ── Partial-kit protection (audit 2026-11-12) ───────────────────────────────
// These call the real addKitToCart (lib/courseKit.ts), the function the kit
// card uses. Only the product loader and the cart are fakes; the cart merges
// with the real mergeCartLines, as CartContext.addItemsToCart does.

type TP = { id: string; inStock: boolean; category: string };
const tp = (id: string, extra: Partial<TP> = {}): TP => ({ id, inStock: true, category: "physical", ...extra });

const KIT_ITEMS = [
  { product_id: "7", quantity: 1 },
  { product_id: "9", quantity: 2 },
  { product_id: "11", quantity: 3 },
];

function fakeCart(initial: { product: TP; quantity: number }[], opts: { reject?: boolean } = {}) {
  let lines = initial.map((l) => ({ ...l }));
  const calls: { product: TP; quantity: number }[][] = [];
  return {
    get lines() { return lines; },
    calls,
    addItemsToCart(entries: { product: TP; quantity: number }[]) {
      calls.push(entries);
      if (opts.reject) return false;
      lines = mergeCartLines(lines, entries);
      return true;
    },
  };
}

function loader(products: Record<string, TP | null | Error>) {
  const requested: string[] = [];
  return {
    requested,
    load: async (id: string) => {
      requested.push(id);
      const p = products[id];
      if (p instanceof Error) throw p;
      return p ?? null;
    },
  };
}

const isPhysical = (p: TP) => p.category === "physical";
const EXISTING = [{ product: tp("50"), quantity: 4 }, { product: tp("9"), quantity: 1 }];
const snapshot = (lines: { product: TP; quantity: number }[]) => JSON.stringify(lines);

describe("partial kit is never added (real addKitToCart)", () => {
  test("a product that fails to load (network error) → nothing added, cart unchanged", async () => {
    const cart = fakeCart(EXISTING);
    const before = snapshot(cart.lines);
    const l = loader({ "7": tp("7"), "9": new Error("timeout"), "11": tp("11") });
    const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: l.load, isPhysical, addItemsToCart: cart.addItemsToCart });
    assert.deepEqual(out, { ok: false, reason: "load_failed" });
    assert.equal(cart.calls.length, 0, "cart never touched");
    assert.equal(snapshot(cart.lines), before);
  });

  test("a product that is missing (404 → null) → nothing added, cart unchanged", async () => {
    for (const missing of ["7", "9", "11"]) {
      const cart = fakeCart(EXISTING);
      const before = snapshot(cart.lines);
      const products: Record<string, TP | null> = { "7": tp("7"), "9": tp("9"), "11": tp("11") };
      products[missing] = null;
      const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: loader(products).load, isPhysical, addItemsToCart: cart.addItemsToCart });
      assert.deepEqual(out, { ok: false, reason: "unavailable" }, `missing ${missing}`);
      assert.equal(cart.calls.length, 0);
      assert.equal(snapshot(cart.lines), before);
    }
  });

  test("any product out of stock (first, middle or last) → nothing added, cart unchanged", async () => {
    for (const oos of ["7", "9", "11"]) {
      const cart = fakeCart(EXISTING);
      const before = snapshot(cart.lines);
      const products: Record<string, TP> = { "7": tp("7"), "9": tp("9"), "11": tp("11") };
      products[oos] = tp(oos, { inStock: false });
      const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: loader(products).load, isPhysical, addItemsToCart: cart.addItemsToCart });
      assert.deepEqual(out, { ok: false, reason: "unavailable" }, `out of stock ${oos}`);
      assert.equal(cart.calls.length, 0);
      assert.equal(snapshot(cart.lines), before);
    }
  });

  test("a non-physical product (C-5) → nothing added, cart unchanged", async () => {
    const cart = fakeCart(EXISTING);
    const before = snapshot(cart.lines);
    const l = loader({ "7": tp("7"), "9": tp("9", { category: "digital" }), "11": tp("11") });
    const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: l.load, isPhysical, addItemsToCart: cart.addItemsToCart });
    assert.deepEqual(out, { ok: false, reason: "unavailable" });
    assert.equal(cart.calls.length, 0);
    assert.equal(snapshot(cart.lines), before);
  });

  test("the cart refusing the batch → reported as failure, cart unchanged", async () => {
    const cart = fakeCart(EXISTING, { reject: true });
    const before = snapshot(cart.lines);
    const l = loader({ "7": tp("7"), "9": tp("9"), "11": tp("11") });
    const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: l.load, isPhysical, addItemsToCart: cart.addItemsToCart });
    assert.deepEqual(out, { ok: false, reason: "cart_rejected" });
    assert.equal(cart.calls.length, 1);
    assert.equal(snapshot(cart.lines), before);
  });

  test("all valid → every product with its kit quantity in ONE atomic cart update", async () => {
    const cart = fakeCart(EXISTING);
    const l = loader({ "7": tp("7"), "9": tp("9"), "11": tp("11") });
    const out = await addKitToCart({ items: KIT_ITEMS, loadProduct: l.load, isPhysical, addItemsToCart: cart.addItemsToCart });
    assert.equal(out.ok, true);
    assert.deepEqual(l.requested, ["7", "9", "11"], "every kit product loaded");
    assert.equal(cart.calls.length, 1, "exactly one cart update");
    assert.deepEqual(cart.calls[0].map((e) => [e.product.id, e.quantity]), [["7", 1], ["9", 2], ["11", 3]]);
    // existing contents kept; a product already in the cart is increased by the kit quantity
    assert.deepEqual(cart.lines.map((l2) => [l2.product.id, l2.quantity]), [["50", 4], ["9", 3], ["7", 1], ["11", 3]]);
  });

  test("the kit card uses this function and shows success only when it succeeds", () => {
    const s = read("components/CourseKitCard.tsx").replace(/\r\n/g, "\n");
    const h = s.slice(s.indexOf("async function handleAddKit()"), s.indexOf("\n  return (", s.indexOf("async function handleAddKit()")));
    assert.match(h, /isPhysical: \(product\) => isPhysicalStoreProduct\(product as any\)/);
    assert.equal((h.match(/addItemsToCart\(/g) ?? []).length, 0, "the card never adds directly; only addKitToCart does");
    assert.ok(!/for \(let i = 0;/.test(h), "no inline per-item loop left in the card");
    const success = h.indexOf('Alert.alert("Kit added to cart"');
    assert.ok(success > h.indexOf("if (outcome.ok) {") && success < h.indexOf('} else if (outcome.reason === "load_failed")'), "success alert only in the ok branch");
  });
});
