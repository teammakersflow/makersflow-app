/**
 * Razorpay checkout helpers (fix M-12, 2026-11-10). Pure and unit-tested.
 *
 * Used by components/RazorpayWebView.tsx, for PHYSICAL store orders only (C-5).
 *
 * - validateCheckoutParams: strict shapes for key, order id, amount and currency.
 * - toScriptJson: JSON that is safe to embed inside <script> (escapes < > & U+2028/9).
 * - parseCheckoutMessage: accepts only well-formed messages from our own document.
 * - decideNavigation: https stays in the WebView (bank 3-D Secure pages live on
 *   many domains); UPI/intent hand-offs go to the OS; everything else is blocked.
 */

export interface CheckoutParams {
  orderId: string;
  amount: number;   // paise
  currency: string;
  keyId: string;
  name: string;
  email: string;
  phone: string;
  description: string;
}

export function validateCheckoutParams(p: CheckoutParams): { ok: true; value: CheckoutParams } | { ok: false; error: string } {
  if (!/^rzp_(live|test)_[A-Za-z0-9]{6,32}$/.test(p.keyId ?? "")) return { ok: false, error: "invalid key" };
  if (!/^order_[A-Za-z0-9]{6,40}$/.test(p.orderId ?? "")) return { ok: false, error: "invalid order id" };
  if (!Number.isInteger(p.amount) || p.amount < 100 || p.amount > 100_000_000) return { ok: false, error: "invalid amount" };
  if (p.currency !== "INR") return { ok: false, error: "invalid currency" };
  const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
  const phone = clip(p.phone, 20).replace(/\s/g, "").replace(/^\+91/, "");
  return {
    ok: true,
    value: {
      orderId: p.orderId,
      amount: p.amount,
      currency: "INR",
      keyId: p.keyId,
      name: clip(p.name, 100),
      email: clip(p.email, 254),
      phone: /^[0-9]{10}$/.test(phone) ? phone : "",
      description: clip(p.description, 200),
    },
  };
}

/** JSON.stringify, made safe for an inline <script> block. */
export function toScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

export type CheckoutMessage =
  | { type: "payment_success"; paymentId: string; orderId: string; signature: string }
  | { type: "payment_failed"; reason: string }
  | { type: "payment_dismissed" };

/**
 * Only messages posted by our own inline checkout document are trusted. Its URL
 * is about:blank or a data:/file: URL depending on platform. Messages from pages
 * the WebView navigated to (e.g. a bank page) are ignored.
 */
export function isTrustedMessageOrigin(url: string | undefined | null): boolean {
  if (!url) return true; // some Android versions omit the URL for inline HTML
  return /^(about:blank|about:srcdoc|data:|file:\/\/\/android_asset\/)/i.test(url);
}

export function parseCheckoutMessage(raw: string, url: string | undefined | null, expectedOrderId: string): CheckoutMessage | null {
  if (!isTrustedMessageOrigin(url)) return null;
  let d: any;
  try { d = JSON.parse(raw); } catch { return null; }
  if (!d || typeof d !== "object") return null;
  if (d.type === "payment_success") {
    if (typeof d.paymentId !== "string" || !/^pay_[A-Za-z0-9]{6,40}$/.test(d.paymentId)) return null;
    if (d.orderId !== expectedOrderId) return null;
    if (typeof d.signature !== "string" || !/^[a-f0-9]{64}$/i.test(d.signature)) return null;
    return { type: "payment_success", paymentId: d.paymentId, orderId: d.orderId, signature: d.signature };
  }
  if (d.type === "payment_failed") return { type: "payment_failed", reason: String(d.reason ?? "Payment was not completed").slice(0, 200) };
  if (d.type === "payment_dismissed") return { type: "payment_dismissed" };
  return null;
}

export type NavigationDecision = "allow" | "open_externally" | "block";
const EXTERNAL_SCHEMES = /^(upi|intent|tez|phonepe|paytmmp|gpay|bhim|credpay):/i;

export function decideNavigation(url: string): NavigationDecision {
  if (!url) return "block";
  if (/^(about:blank|about:srcdoc|data:)/i.test(url)) return "allow";
  if (/^https:\/\//i.test(url)) return "allow";
  if (EXTERNAL_SCHEMES.test(url)) return "open_externally";
  return "block"; // http:, javascript:, file:, unknown schemes
}
