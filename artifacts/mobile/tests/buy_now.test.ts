// Store "Buy Now" and "Add to Cart" quantity fixes (2026-11-12).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planBuyNow, planAddToCart, createTapGuard } from "../lib/buyNow.ts";
import { mergeCartLines } from "../lib/courseKit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

type Line = { product: { id: string }; quantity: number };

/**
 * Model of the screen's Buy Now handler, wired exactly as app/store/[id].tsx
 * wires it: planBuyNow → guard → addItemsToCart (atomic merge, the same
 * mergeCartLines CartContext uses) → navigate.
 */
function makeScreen(opts: { inStock: boolean; initialCart?: Line[] }) {
  let cart: Line[] = opts.initialCart ?? [];
  const guard = createTapGuard();
  const navigations: string[] = [];
  const product = { id: "42" };
  return {
    get cart() { return cart; },
    navigations,
    /** `isInCart` is captured from the render the tap belongs to, as in React. */
    tap(selectedQuantity: number, isInCart = cart.some((l) => l.product.id === product.id)) {
      const plan = planBuyNow({ inStock: opts.inStock, isInCart, selectedQuantity });
      if (plan.kind === "blocked") return;
      if (!guard.tryAcquire()) return;
      if (plan.kind === "add_then_checkout") cart = mergeCartLines(cart, [{ product, quantity: plan.quantity }]);
      navigations.push("/store/checkout");
    },
    focus() { guard.release(); },
    qty() { return cart.find((l) => l.product.id === product.id)?.quantity ?? 0; },
  };
}

describe("planBuyNow", () => {
  test("quantity 1 → add 1, then checkout", () => {
    assert.deepEqual(planBuyNow({ inStock: true, isInCart: false, selectedQuantity: 1 }), { kind: "add_then_checkout", quantity: 1 });
  });

  test("quantity greater than 1 → the exact quantity", () => {
    for (const q of [2, 3, 7, 25]) {
      assert.deepEqual(planBuyNow({ inStock: true, isInCart: false, selectedQuantity: q }), { kind: "add_then_checkout", quantity: q });
    }
  });

  test("invalid selection falls back to 1 (old `localQty || 1`)", () => {
    for (const q of [0, -2, NaN, 1.5]) {
      assert.deepEqual(planBuyNow({ inStock: true, isInCart: false, selectedQuantity: q }), { kind: "add_then_checkout", quantity: 1 });
    }
  });

  test("insufficient stock (out of stock) → blocked: nothing added, no navigation", () => {
    assert.deepEqual(planBuyNow({ inStock: false, isInCart: false, selectedQuantity: 3 }), { kind: "blocked" });
    assert.deepEqual(planBuyNow({ inStock: false, isInCart: true, selectedQuantity: 3 }), { kind: "blocked" });
  });

  test("already in cart → checkout without adding (unchanged behaviour)", () => {
    assert.deepEqual(planBuyNow({ inStock: true, isInCart: true, selectedQuantity: 4 }), { kind: "checkout" });
  });
});

describe("Buy Now handler behaviour", () => {
  test("original defect, for reference: a loop of debounced addToCart calls keeps only 1 unit", () => {
    // addToCart ignores calls within 500 ms; a synchronous loop runs within 0 ms.
    let last = -Infinity;
    let qty = 0;
    const addToCart = (now: number) => { if (now - last < 500) return; last = now; qty += 1; };
    for (let i = 0; i < 3; i++) addToCart(1000);
    assert.equal(qty, 1);
  });

  test("quantity 1: cart gets 1 unit, one navigation", () => {
    const s = makeScreen({ inStock: true });
    s.tap(1);
    assert.equal(s.qty(), 1);
    assert.deepEqual(s.navigations, ["/store/checkout"]);
  });

  test("quantity 3: cart gets exactly 3 units in one update", () => {
    const s = makeScreen({ inStock: true });
    s.tap(3);
    assert.equal(s.qty(), 3);
    assert.equal(s.cart.length, 1);
    assert.deepEqual(s.navigations, ["/store/checkout"]);
  });

  test("other cart lines are kept", () => {
    const s = makeScreen({ inStock: true, initialCart: [{ product: { id: "7" }, quantity: 2 }] });
    s.tap(4);
    assert.deepEqual(s.cart.map((l) => [l.product.id, l.quantity]), [["7", 2], ["42", 4]]);
  });

  test("insufficient stock: nothing added and no navigation", () => {
    const s = makeScreen({ inStock: false });
    s.tap(3);
    s.tap(1);
    assert.equal(s.qty(), 0);
    assert.deepEqual(s.navigations, []);
  });

  test("rapid repeated taps before re-render add the quantity once and navigate once", () => {
    const s = makeScreen({ inStock: true });
    // All five taps come from the same render, so each still sees isInCart = false.
    for (let i = 0; i < 5; i++) s.tap(3, false);
    assert.equal(s.qty(), 3);
    assert.deepEqual(s.navigations, ["/store/checkout"]);
  });

  test("returning to the screen: the item is in the cart, Buy Now goes to checkout without adding again", () => {
    const s = makeScreen({ inStock: true });
    s.tap(2);
    s.focus();
    s.tap(2);
    assert.equal(s.qty(), 2);
    assert.deepEqual(s.navigations, ["/store/checkout", "/store/checkout"]);
  });

  test("guard: only the first acquire succeeds until released", () => {
    const g = createTapGuard();
    assert.equal(g.tryAcquire(), true);
    assert.equal(g.tryAcquire(), false);
    assert.equal(g.isBusy(), true);
    g.release();
    assert.equal(g.tryAcquire(), true);
  });
});

describe("static: app/store/[id].tsx wiring", () => {
  const s = read("app/store/[id].tsx");
  const buyNow = s.slice(s.indexOf("// Buy Now (2026-11-12)"), s.indexOf('router.push("/store/checkout");', s.indexOf("// Buy Now (2026-11-12)")) + 40);

  test("Buy Now uses addItemsToCart with the selected product and exact quantity", () => {
    assert.match(buyNow, /planBuyNow\(\{ inStock: product\.inStock, isInCart, selectedQuantity: localQty \}\)/);
    assert.match(buyNow, /addItemsToCart\(\[\{ product, quantity: plan\.quantity \}\]\)/);
    assert.ok(!/for \(let i = 0; i < qty; i\+\+\) addToCart\(product\)/.test(s), "old Buy Now loop removed");
  });

  test("navigation to checkout preserved; blocked plan returns before navigating", () => {
    assert.ok(buyNow.includes('router.push("/store/checkout");'));
    assert.ok(buyNow.indexOf('if (plan.kind === "blocked") return;') < buyNow.indexOf('router.push("/store/checkout");'));
  });

  test("rapid-tap guard acquired before adding; released on focus and on failure", () => {
    assert.ok(buyNow.indexOf("tryAcquire()") < buyNow.indexOf("addItemsToCart("));
    assert.match(s, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*buyNowGuardRef\.current\.release\(\);/);
    assert.match(buyNow, /buyNowGuardRef\.current\.release\(\);\s*Alert\.alert/);
  });

  test("out-of-stock UI unchanged: Buy Now disabled, stepper hidden, Add to Cart disabled", () => {
    assert.match(s, /onPress=\{\(\) => \{\s*requireAuth\(\(\) => \{[\s\S]*?\}\);\s*\}\}\s*disabled=\{!product\.inStock\}/);
    assert.match(s, /\{product\.inStock && \(\s*<View style=\{styles\.quantityContainer\}>/);
    assert.match(s, /disabled=\{!product\.inStock \|\| isInCart\}/);
  });

  test("CartContext.addToCart is unchanged (debounce, +1)", () => {
    const c = read("context/CartContext.tsx");
    assert.match(c, /if \(now - lastAddRef\.current < 500\) \{\s*return; \/\/ prevent duplicate clicks within 500ms\s*\}/);
    assert.match(c, /quantity: i\.quantity \+ 1/);
    assert.match(c, /save\(\[\.\.\.items, \{ product, quantity: 1 \}\]\);/);
  });
});

// ── Add to Cart (same defect: loop of debounced addToCart calls) ─────────────

/**
 * Model of the screen's Add to Cart handler, wired as app/store/[id].tsx wires
 * it: planAddToCart → guard → addItemsToCart (atomic merge via mergeCartLines,
 * as CartContext does) → success haptic + alert; answering the alert releases
 * the guard.
 */
function makeAddToCartScreen(opts: { inStock: boolean; initialCart?: Line[]; addFails?: boolean }) {
  let cart: Line[] = opts.initialCart ?? [];
  const guard = createTapGuard();
  const alerts: string[] = [];
  const haptics: string[] = [];
  const product = { id: "42" };
  return {
    get cart() { return cart; },
    alerts,
    haptics,
    tap(selectedQuantity: number) {
      const plan = planAddToCart({ inStock: opts.inStock, selectedQuantity });
      if (plan.kind === "blocked") return;
      if (!guard.tryAcquire()) return;
      if (opts.addFails) {
        guard.release();
        alerts.push("Unavailable");
        return;
      }
      cart = mergeCartLines(cart, [{ product, quantity: plan.quantity }]);
      haptics.push("success");
      alerts.push("Added to Cart");
    },
    answerAlert() { guard.release(); },
    qty(id = "42") { return cart.find((l) => l.product.id === id)?.quantity ?? 0; },
  };
}

describe("planAddToCart", () => {
  test("quantity 1 and quantity 3 → exact quantity", () => {
    assert.deepEqual(planAddToCart({ inStock: true, selectedQuantity: 1 }), { kind: "add", quantity: 1 });
    assert.deepEqual(planAddToCart({ inStock: true, selectedQuantity: 3 }), { kind: "add", quantity: 3 });
  });
  test("invalid selection falls back to 1", () => {
    for (const q of [0, -1, NaN, 2.5]) assert.deepEqual(planAddToCart({ inStock: true, selectedQuantity: q }), { kind: "add", quantity: 1 });
  });
  test("out of stock → blocked", () => {
    assert.deepEqual(planAddToCart({ inStock: false, selectedQuantity: 3 }), { kind: "blocked" });
  });
});

describe("Add to Cart handler behaviour", () => {
  test("1. quantity 1: one unit, success haptic and alert", () => {
    const s = makeAddToCartScreen({ inStock: true });
    s.tap(1);
    assert.equal(s.qty(), 1);
    assert.deepEqual(s.alerts, ["Added to Cart"]);
    assert.deepEqual(s.haptics, ["success"]);
  });

  test("2. quantity 3: exactly 3 units in one cart line", () => {
    const s = makeAddToCartScreen({ inStock: true });
    s.tap(3);
    assert.equal(s.qty(), 3);
    assert.equal(s.cart.length, 1);
  });

  test("3. an existing line for the same product is merged (2 + 3 = 5)", () => {
    const s = makeAddToCartScreen({ inStock: true, initialCart: [{ product: { id: "42" }, quantity: 2 }] });
    s.tap(3);
    assert.equal(s.qty(), 5);
    assert.equal(s.cart.length, 1);
  });

  test("4. other cart items are untouched", () => {
    const s = makeAddToCartScreen({ inStock: true, initialCart: [{ product: { id: "7" }, quantity: 2 }, { product: { id: "9" }, quantity: 1 }] });
    s.tap(3);
    assert.deepEqual(s.cart.map((l) => [l.product.id, l.quantity]), [["7", 2], ["9", 1], ["42", 3]]);
  });

  test("5. out of stock: nothing added, no feedback", () => {
    const s = makeAddToCartScreen({ inStock: false });
    s.tap(3);
    assert.equal(s.qty(), 0);
    assert.deepEqual(s.alerts, []);
    assert.deepEqual(s.haptics, []);
  });

  test("6. rapid repeated taps add once; after the alert is answered the user can add again", () => {
    const s = makeAddToCartScreen({ inStock: true });
    for (let i = 0; i < 5; i++) s.tap(3);
    assert.equal(s.qty(), 3);
    assert.deepEqual(s.alerts, ["Added to Cart"]);
    s.answerAlert();
    s.tap(2);
    assert.equal(s.qty(), 5);
    assert.deepEqual(s.alerts, ["Added to Cart", "Added to Cart"]);
  });

  test("failed add: no success message or haptic; guard released so the user can retry", () => {
    const s = makeAddToCartScreen({ inStock: true, addFails: true });
    s.tap(3);
    s.tap(3);
    assert.equal(s.qty(), 0);
    assert.deepEqual(s.alerts, ["Unavailable", "Unavailable"]);
    assert.deepEqual(s.haptics, []);
  });
});

describe("static: Add to Cart wiring in app/store/[id].tsx", () => {
  const s = read("app/store/[id].tsx").replace(/\r\n/g, "\n"); // file uses CRLF
  const start = s.indexOf("function handleAddToCart()");
  const handler = s.slice(start, s.indexOf("\n  return (", start));

  test("7. one atomic addItemsToCart call with the selected quantity, no loop", () => {
    assert.ok(start > 0);
    assert.match(handler, /planAddToCart\(\{ inStock: product\.inStock, selectedQuantity: localQty \}\)/);
    assert.equal((handler.match(/addItemsToCart\(/g) ?? []).length, 1);
    assert.match(handler, /addItemsToCart\(\[\{ product, quantity: plan\.quantity \}\]\)/);
    assert.ok(!/addToCart\(product\)/.test(handler), "no addToCart(product) in the handler");
    assert.ok(!/for \(let i = 0; i < localQty; i\+\+\)/.test(s), "old Add to Cart loop removed");
  });

  test("guard acquired before adding; success feedback only after a successful add; released on failure, on alert answer and on focus", () => {
    const acquire = handler.indexOf("addToCartGuardRef.current.tryAcquire()");
    const add = handler.indexOf("addItemsToCart(");
    const failRelease = handler.indexOf("addToCartGuardRef.current.release();\n");
    const haptic = handler.indexOf("Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)");
    const success = handler.indexOf('Alert.alert("Added to Cart"');
    assert.ok(acquire > 0 && acquire < add, "acquire before add");
    assert.ok(add < failRelease && failRelease < haptic && haptic < success, "failure path returns before success feedback");
    assert.match(handler, /if \(!addItemsToCart\([^\n]*\)\) \{\s*addToCartGuardRef\.current\.release\(\);\s*Alert\.alert\("Unavailable"[^\n]*\);\s*return;\s*\}/);
    assert.match(handler, /text: "Continue Shopping", style: "cancel", onPress: \(\) => addToCartGuardRef\.current\.release\(\)/);
    assert.match(handler, /addToCartGuardRef\.current\.release\(\);\s*router\.push\("\/store\/checkout"\);/);
    assert.match(s, /useCallback\(\(\) => \{\s*buyNowGuardRef\.current\.release\(\);\s*addToCartGuardRef\.current\.release\(\);/);
  });

  test("existing success message, buttons and disabled state are unchanged", () => {
    assert.match(handler, /Alert\.alert\("Added to Cart", `\$\{product\.title\} has been added to your cart\.`/);
    assert.match(s, /onPress=\{handleAddToCart\}\s*disabled=\{!product\.inStock \|\| isInCart\}/);
    assert.match(s, /\{isInCart \? "In Cart" : "Add to Cart"\}/);
  });

  test("8. Buy Now remains intact and uses its own guard", () => {
    const buy = s.slice(s.indexOf("// Buy Now (2026-11-12)"));
    assert.match(buy, /planBuyNow\(\{ inStock: product\.inStock, isInCart, selectedQuantity: localQty \}\)/);
    assert.match(buy, /buyNowGuardRef\.current\.tryAcquire\(\)/);
    assert.ok(!/addToCartGuardRef/.test(buy.slice(0, buy.indexOf('router.push("/store/checkout");'))));
    assert.equal((s.match(/addItemsToCart\(\[\{ product, quantity: plan\.quantity \}\]\)/g) ?? []).length, 2, "one call each in Add to Cart and Buy Now");
  });
});
