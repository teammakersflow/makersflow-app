import { apiRequest } from "@/lib/auth/apiClient";
import { isIncludedKitClaimEnabled } from "@/constants/featureFlags";
import {
  parseClaimsPayload,
  unwrapClaimResult,
  verifyResultOk,
  type ClaimRequestBody,
  type ClaimResult,
  type KitClaim,
} from "@/lib/includedKitClaim";

/**
 * Included-kit claim API (2026-11-12). Every call refuses to run while
 * FEATURE_FLAGS.INCLUDED_KIT_CLAIM is false, so nothing can reach these
 * endpoints from a build where the feature is off.
 */
function assertEnabled() {
  if (!isIncludedKitClaimEnabled()) {
    throw new Error("Included kit claims are not available.");
  }
}

/** GET /included-kits/my (JWT, wrapped). */
export async function fetchMyKitClaims(): Promise<KitClaim[]> {
  assertEnabled();
  return parseClaimsPayload(await apiRequest<any>("/included-kits/my"));
}

/** POST /included-kits/claim (JWT, wrapped). */
export async function claimIncludedKit(body: ClaimRequestBody): Promise<ClaimResult> {
  assertEnabled();
  const res = await apiRequest<any>("/included-kits/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrapClaimResult(res);
}

/** POST /included-kits/verify-payment (JWT, NOT wrapped). Returns true when verified. */
export async function verifyKitPayment(body: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<boolean> {
  assertEnabled();
  const res = await apiRequest<any>("/included-kits/verify-payment", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return verifyResultOk(res);
}
