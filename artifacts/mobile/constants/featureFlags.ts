/**
 * App feature flags (2026-11-12).
 *
 * Build-time constants, like DIGITAL_COURSE_PURCHASES_IN_APP in
 * constants/commerce.ts. They are not read from the environment or the server,
 * so a feature that is OFF cannot be switched on in a shipped build. Turning
 * one on is a code change that needs review.
 */
export const FEATURE_FLAGS = {
  /**
   * Included-kit claim and shipping payment on the course page
   * (GET /included-kits/my, POST /included-kits/claim, POST /included-kits/verify-payment).
   * Implemented but NOT released: keep false until the backend `main`
   * contract (payment_status, shipping_address_id, reused-claim fields) is
   * deployed and the flow has passed device QA with Razorpay test mode.
   */
  INCLUDED_KIT_CLAIM: false,
} as const;

export function isIncludedKitClaimEnabled(): boolean {
  // Widened to boolean so the check still type-checks while the flag is the literal `false`.
  return (FEATURE_FLAGS.INCLUDED_KIT_CLAIM as boolean) === true;
}
