import { apiClient } from "@/lib/auth/apiClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateRazorpayOrderItem = {
  productId: string | number;
  quantity: number;
};

export type CreateRazorpayOrderParams = {
  items: CreateRazorpayOrderItem[];
  amount?: number;
  currency?: string;
  receipt?: string;
  shipping_address?: Record<string, any> | null;
  order_type?: string;
  coupon_code?: string;
};

export type RazorpayOrderResult = {
  id: string;        // Razorpay order_id  e.g. "order_Abc123"
  amount: number;    // in paise           e.g. 49900 for ₹499
  currency: string;  // "INR"
  key_id: string;    // Razorpay Key ID    e.g. "rzp_test_..."
  pricing?: {
    subtotal: string;
    tax_amount: string;
    shipping_amount: string;
    discount_amount: string;
    total_amount: string;
    items?: any[];
  };
};

export type PaymentVerifyParams = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

// ─── Create Razorpay Order ────────────────────────────────────────────────────
// Calls backend POST /payments/create-order with JWT bearer authentication.
// Student identity is derived exclusively from JWT on the backend.
// The backend calculates authoritative total from database prices and GST.

export async function createRazorpayOrder(
  params: CreateRazorpayOrderParams,
): Promise<RazorpayOrderResult> {
  try {
    const res = await apiClient.post<any>("/payments/create-order", {
      amount: params.amount,
      currency: params.currency || "INR",
      receipt: params.receipt,
      items: params.items,
      shipping_address: params.shipping_address,
      order_type: params.order_type || "product",
      coupon_code: params.coupon_code,
    });

    const data = res?.data || res;

    if (!data?.razorpay_order_id && !data?.id) {
      throw new Error("Invalid response from payment server: missing order ID");
    }

    return {
      id: data.razorpay_order_id || data.id,
      amount: data.amount,
      currency: data.currency || "INR",
      key_id: data.key_id,
      pricing: data.pricing,
    };
  } catch (error: any) {
    console.error("[RazorpayService] createRazorpayOrder error:", error);
    throw new Error(error?.message || "Could not create payment order");
  }
}

// ─── Verify Payment Signature ─────────────────────────────────────────────────
// Calls backend POST /payments/verify to cryptographically validate the HMAC signature.
// Student identity is derived exclusively from JWT on the backend.

export type PaymentVerifyResult = {
  success: boolean;
  message?: string;
  payment_id?: string;
  payment?: any;
  order?: any;
  invoice?: any;
};

export async function verifyRazorpayPayment(
  params: PaymentVerifyParams,
): Promise<PaymentVerifyResult> {
  try {
    const res = await apiClient.post<any>("/payments/verify", {
      razorpay_order_id: params.razorpay_order_id,
      razorpay_payment_id: params.razorpay_payment_id,
      razorpay_signature: params.razorpay_signature,
    });

    const data = res?.data || res;
    const verified = data?.success === true;

    return {
      success: verified,
      message: data?.message,
      payment_id: params.razorpay_payment_id,
      payment: data?.payment,
      order: data?.order,
      invoice: data?.invoice,
    };
  } catch (error: any) {
    console.error("[RazorpayService] verifyRazorpayPayment error:", error);
    throw new Error(error?.message || "Payment verification failed");
  }
}