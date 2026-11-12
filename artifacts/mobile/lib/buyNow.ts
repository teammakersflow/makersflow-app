/**
 * Store "Buy Now" decision (2026-11-12). Pure, unit-tested.
 *
 * Bug fixed: app/store/[id].tsx added the selected quantity with
 * `for (...) addToCart(product)`. addToCart ignores calls within 500 ms, so
 * every quantity above 1 became 1. Buy Now now adds the exact quantity in one
 * call to CartContext.addItemsToCart.
 *
 * The screen's existing rules are preserved, unchanged:
 * - out of stock (product.inStock false) → nothing is added, no navigation
 *   (the button is also disabled and the quantity stepper hidden);
 * - product already in the cart → go to checkout without adding (the cart line
 *   and the stepper already hold its quantity);
 * - the selected quantity defaults to 1 (`localQty || 1`).
 * There is no client-side maximum or stock count in this screen; the backend
 * validates stock at checkout.
 */

export type BuyNowPlan =
  | { kind: "blocked" }
  | { kind: "checkout" }
  | { kind: "add_then_checkout"; quantity: number };

export function planBuyNow(input: {
  inStock: boolean;
  isInCart: boolean;
  selectedQuantity: number;
}): BuyNowPlan {
  if (!input.inStock) return { kind: "blocked" };
  if (input.isInCart) return { kind: "checkout" };
  const q = input.selectedQuantity;
  const quantity = Number.isInteger(q) && q >= 1 ? q : 1;
  return { kind: "add_then_checkout", quantity };
}

export type AddToCartPlan = { kind: "blocked" } | { kind: "add"; quantity: number };

/**
 * Store "Add to Cart" (2026-11-12). Same defect and fix as Buy Now: the old
 * `for (...) addToCart(product)` loop was cut to 1 unit by the 500 ms debounce;
 * the screen now adds the exact quantity with one addItemsToCart call.
 * Existing rules kept: the button is disabled when out of stock or already in
 * the cart; the handler adds nothing when out of stock; quantity defaults to 1.
 * If the product is somehow already in the cart, the quantity is merged into its
 * line (CartContext.addItemsToCart), as the old loop would have done.
 */
export function planAddToCart(input: { inStock: boolean; selectedQuantity: number }): AddToCartPlan {
  if (!input.inStock) return { kind: "blocked" };
  const q = input.selectedQuantity;
  return { kind: "add", quantity: Number.isInteger(q) && q >= 1 ? q : 1 };
}

/**
 * One Buy Now at a time. Rapid repeated taps arrive before React re-renders
 * (so `isInCart` is still false in their closures); only the first acquires the
 * guard. The screen releases it when it regains focus, or if adding failed.
 */
export function createTapGuard() {
  let busy = false;
  return {
    tryAcquire(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    release(): void {
      busy = false;
    },
    isBusy(): boolean {
      return busy;
    },
  };
}

export type TapGuard = ReturnType<typeof createTapGuard>;
