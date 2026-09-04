import { apiClient } from "@/lib/auth/apiClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RazorpayCartItem = {
  id: string;
  price: number;
  qty: number;
  is_course?: boolean;
  course_id?: string | null;
  title?: string;
};

export type RazorpayOrderResult = {
  id: string;        // Razorpay order_id  e.g. "order_Abc123"
  amount: number;    // in paise           e.g. 49900 for ₹499
  currency: string;  // "INR"
  key_id: string;    // Razorpay Key ID    e.g. "rzp_live_..."
};

export type PaymentVerifyParams = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  amount?: number;
  user_id?: string;
  coupon_code?: string | null;
  coupon_id?: string | null;
  discount_amount?: number;
  tax_amount?: number;
};

// ─── Create Razorpay Order ────────────────────────────────────────────────────
// Calls backend POST /payments/create-order with JWT bearer authentication.
// Student identity is derived exclusively from JWT on the backend.

export async function createRazorpayOrder(
  _items?: RazorpayCartItem[],
  totalAmount = 0,
  _userId?: string,
  _shippingAddress?: any,
  _promoCode?: string | null,
  _discountAmount?: number
): Promise<RazorpayOrderResult> {
  try {
    const res = await apiClient.post<any>("/payments/create-order", {
      amount: totalAmount,
      currency: "INR",
    });

    const data = res?.data || res;

    if (!data?.razorpay_order_id && !data?.id) {
      throw new Error("Invalid response from payment server");
    }

    return {
      id: data.razorpay_order_id || data.id,
      amount: data.amount,
      currency: data.currency || "INR",
      key_id: data.key_id,
    };
  } catch (error: any) {
    console.error("[RazorpayService] createRazorpayOrder error:", error);
    throw new Error(error?.message || "Could not create payment order");
  }
}

// ─── Verify Payment Signature ─────────────────────────────────────────────────
// Calls backend POST /payments/verify to cryptographically validate the HMAC signature.
// Student identity is derived exclusively from JWT on the backend.

export async function verifyRazorpayPayment(
  params: PaymentVerifyParams,
): Promise<{ success: boolean; payment_id?: string }> {
  try {
    const res = await apiClient.post<any>("/payments/verify", {
      razorpay_order_id: params.razorpay_order_id,
      razorpay_payment_id: params.razorpay_payment_id,
      razorpay_signature: params.razorpay_signature,
    });

    const data = res?.data || res;
    const verified = Boolean(data?.success ?? true);

    return { success: verified, payment_id: params.razorpay_payment_id };
  } catch (error: any) {
    console.error("[RazorpayService] verifyRazorpayPayment error:", error);
    throw new Error(error?.message || "Payment verification failed");
  }
}