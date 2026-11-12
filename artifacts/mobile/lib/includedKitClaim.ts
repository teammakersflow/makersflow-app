/**
 * Included-kit claim logic (2026-11-12). Pure and unit-tested; the UI is
 * components/IncludedKitClaim.tsx, behind FEATURE_FLAGS.INCLUDED_KIT_CLAIM.
 *
 * Adapted from the website (makersflow-website feat/kit-claim,
 * src/components/course/IncludedKitClaim.tsx + src/lib/includedKits.ts) and
 * the NestJS `main` contract (src/included-kits/included-kits.service.ts).
 */

export type KitPaymentStatus = null | "not_required" | "pending" | "captured" | "failed";

export interface KitClaim {
  id: string;
  status: string; // "pending" | "processing" | "fulfilled" | ...
  course_purchase_id: string;
  course: { id: string; title: string };
  kit: {
    id: string;
    name: string;
    items: { product_id: string; title: string; quantity: number; thumbnail_url: string | null }[];
  };
  order: { id: string; status: string } | null;
  shipping_address_id?: string | null;
  payment_status?: KitPaymentStatus;
  created_at?: string;
}

export interface ClaimResult {
  claimId?: string;
  orderId?: string;
  order?: { id: string } | null;
  shippingAmount?: string;
  amount?: number; // paise (reused-claim responses only)
  currency?: string;
  paymentRequired?: boolean;
  razorpayOrderId?: string | null;
  razorpayKeyId?: string | null;
  reused?: boolean;
  paymentCaptured?: boolean;
  alreadyFulfilled?: boolean;
  fulfilledNow?: boolean;
  requiresReconciliation?: boolean;
  message?: string;
}

export interface ClaimRequestBody {
  coursePurchaseId: string;
  shippingAddressId: string;
  idempotencyKey: string;
}

/** GET /included-kits/my is wrapped: { success, message, data: KitClaim[] }. */
export function parseClaimsPayload(payload: unknown): KitClaim[] {
  const body = payload as any;
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  return list
    .filter((c: any) => c && c.id !== undefined && c.course && c.course.id !== undefined)
    .map((c: any) => ({
      ...c,
      id: String(c.id),
      course_purchase_id: String(c.course_purchase_id),
      course: { ...c.course, id: String(c.course.id) },
      shipping_address_id:
        c.shipping_address_id === null || c.shipping_address_id === undefined ? null : String(c.shipping_address_id),
      payment_status: c.payment_status ?? null,
      order: c.order ? { ...c.order, id: String(c.order.id) } : null,
    }));
}

/** The claim whose course.id matches this course (ids compared as strings). */
export function findClaimForCourse(claims: KitClaim[], courseId: string | number): KitClaim | null {
  return claims.find((c) => String(c.course.id) === String(courseId)) ?? null;
}

/** Always the same key for a claim, so retries never create a second order. */
export function claimIdempotencyKey(claim: Pick<KitClaim, "id">): string {
  return `kit-claim-${claim.id}`;
}

export type ClaimView =
  | { kind: "fulfilled" } // "Kit ordered ✓" + link to orders
  | { kind: "processing" } // payment received / awaiting fulfilment, no button
  | { kind: "payment_due"; addressId: string | null } // "Complete shipping payment"
  | { kind: "claim" }; // "Claim your free kit"

/**
 * Display state, in the website's order:
 *   fulfilled → captured (processing) → order exists (pay) → no order (claim).
 * Mobile additions: claim status "processing", and an order with
 * payment_status "not_required" (free shipping, awaiting fulfilment), are shown
 * as processing instead of offering a payment button for a payment that does
 * not exist.
 */
export function claimView(claim: KitClaim): ClaimView {
  if (claim.status === "fulfilled") return { kind: "fulfilled" };
  if (claim.order && claim.payment_status === "captured") return { kind: "processing" };
  if (claim.status === "processing") return { kind: "processing" };
  if (claim.order && claim.payment_status === "not_required") return { kind: "processing" };
  if (claim.order) return { kind: "payment_due", addressId: claim.shipping_address_id ?? null };
  return { kind: "claim" };
}

/**
 * Body for POST /included-kits/claim, or null when an address is still needed.
 * Retries of an existing order reuse its stored shipping address; the user's
 * selection is used only when there is no order yet, or the order has no
 * stored address id (older orders).
 */
export function buildClaimRequest(claim: KitClaim, selectedAddressId: string | null | undefined): ClaimRequestBody | null {
  const stored = claim.order ? claim.shipping_address_id ?? null : null;
  const addressId = stored ?? (selectedAddressId ? String(selectedAddressId) : null);
  if (!addressId) return null;
  return {
    coursePurchaseId: String(claim.course_purchase_id),
    shippingAddressId: addressId,
    idempotencyKey: claimIdempotencyKey(claim),
  };
}

/** POST /included-kits/claim is wrapped: { success, message, data: ClaimResult }. */
export function unwrapClaimResult(payload: unknown): ClaimResult {
  const body = payload as any;
  const data = body && typeof body === "object" && "data" in body ? body.data : body;
  return data && typeof data === "object" ? (data as ClaimResult) : {};
}

/**
 * POST /included-kits/verify-payment is NOT wrapped: the service returns an
 * object with `success` and `message`, which the global ResponseInterceptor
 * passes through unchanged. Never read `.data` here.
 */
export function verifyResultOk(payload: unknown): boolean {
  const body = payload as any;
  return !!body && typeof body === "object" && body.success === true;
}

export type ClaimOutcome =
  | { action: "pay"; razorpayOrderId: string; razorpayKeyId: string; amountPaise: number; currency: string }
  | { action: "processing"; message: string }
  | { action: "done"; message: string }
  | { action: "error"; message: string };

export const KIT_MESSAGES = {
  processing: "Payment received, we're processing your kit",
  fulfilledNow: "Payment received, your kit order is confirmed.",
  alreadyFulfilled: "Your kit is already ordered.",
  confirmed: "Your kit order is confirmed!",
  tryAgainShortly: "Please try again shortly",
  paymentStartFailed: "We couldn't start the shipping payment. Please try again shortly.",
  genericError: "Could not claim your kit. Please try again.",
} as const;

function paiseFrom(result: ClaimResult): number | null {
  if (typeof result.amount === "number" && Number.isSafeInteger(result.amount) && result.amount > 0) {
    return result.amount;
  }
  const rupees = Number(result.shippingAmount);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  const paise = Math.round(rupees * 100);
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

/** What to do with a claim response (website order of checks). */
export function interpretClaimResult(result: ClaimResult): ClaimOutcome {
  if (result.paymentRequired) {
    const amountPaise = paiseFrom(result);
    if (result.razorpayOrderId && result.razorpayKeyId && amountPaise !== null) {
      return {
        action: "pay",
        razorpayOrderId: result.razorpayOrderId,
        razorpayKeyId: result.razorpayKeyId,
        amountPaise,
        currency: result.currency || "INR",
      };
    }
    // The website would report success here; a payment that cannot be opened
    // must not be shown as a confirmed order.
    return { action: "error", message: KIT_MESSAGES.paymentStartFailed };
  }
  if (result.requiresReconciliation) return { action: "processing", message: KIT_MESSAGES.processing };
  if (result.fulfilledNow) return { action: "done", message: KIT_MESSAGES.fulfilledNow };
  if (result.alreadyFulfilled) return { action: "done", message: KIT_MESSAGES.alreadyFulfilled };
  return { action: "done", message: KIT_MESSAGES.confirmed };
}

/** Error text for a failed claim / verify call. */
export function claimErrorMessage(err: unknown): string {
  const e = err as any;
  const message = typeof e?.message === "string" ? e.message : "";
  if (/No new payment order was created/i.test(message)) return KIT_MESSAGES.tryAgainShortly;
  return message || KIT_MESSAGES.genericError;
}
