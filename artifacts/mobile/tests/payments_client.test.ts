// Payment client fixes: M-12, M-13, M-15 (+ L-24 amount display).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideNavigation, parseCheckoutMessage, toScriptJson, validateCheckoutParams, isTrustedMessageOrigin } from "../lib/razorpayCheckout.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const good = { orderId: "order_ABC123xyz", amount: 141759, currency: "INR", keyId: "rzp_test_ABCDEF123456", name: "Asha", email: "a@x.in", phone: "+91 98765 43210", description: "2 items" };

describe("M-12 checkout params and HTML safety", () => {
  test("valid params normalised; phone cleaned", () => {
    const r = validateCheckoutParams(good);
    assert.ok(r.ok);
    assert.equal(r.value.phone, "9876543210");
  });
  test("rejects bad key, order id, amount, currency", () => {
    for (const p of [
      { ...good, keyId: "pk_live_x" }, { ...good, orderId: "order_<x>" }, { ...good, amount: 99 },
      { ...good, amount: 10.5 }, { ...good, currency: "USD" },
    ]) assert.equal(validateCheckoutParams(p as any).ok, false, JSON.stringify(p).slice(0, 60));
  });
  test("toScriptJson cannot break out of <script>", () => {
    const evil = { name: `</script><script>alert(1)</script>\\"'`, x: "  &" };
    const out = toScriptJson(evil);
    assert.ok(!out.includes("</script>"));
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes(" ") && !out.includes(" "));
    assert.deepEqual(JSON.parse(out), evil, "round-trips to the same value");
  });
  test("WebView builds HTML from validated JSON, never string-interpolated values", () => {
    const s = read("components/RazorpayWebView.tsx");
    assert.match(s, /var cfg = \$\{config\};/);
    assert.ok(!/\$\{p\.keyId\}|\$\{safeName\}|\$\{p\.orderId\}/.test(s));
    assert.match(s, /mixedContentMode="never"/);
    assert.ok(!/originWhitelist=\{\["\*"\]\}/.test(s));
    assert.match(s, /onShouldStartLoadWithRequest=\{handleShouldStart\}/);
  });
});

describe("M-12 message origin and shape", () => {
  const sig = "a".repeat(64);
  const ok = JSON.stringify({ type: "payment_success", paymentId: "pay_ABC123456", orderId: good.orderId, signature: sig });
  test("accepts success only from our document, for the expected order", () => {
    assert.equal(parseCheckoutMessage(ok, "about:blank", good.orderId)?.type, "payment_success");
    assert.equal(parseCheckoutMessage(ok, undefined, good.orderId)?.type, "payment_success");
    assert.equal(parseCheckoutMessage(ok, "https://bank.example/3ds", good.orderId), null, "navigated page cannot post");
    assert.equal(parseCheckoutMessage(ok, "about:blank", "order_OTHER123"), null, "order id must match");
  });
  test("malformed messages ignored", () => {
    for (const m of ["not json", "{}", JSON.stringify({ type: "payment_success", paymentId: "x", orderId: good.orderId, signature: sig }),
      JSON.stringify({ type: "payment_success", paymentId: "pay_ABC123456", orderId: good.orderId, signature: "short" }),
      JSON.stringify({ type: "unknown" })]) {
      assert.equal(parseCheckoutMessage(m, "about:blank", good.orderId), null, m.slice(0, 40));
    }
    assert.equal(isTrustedMessageOrigin("https://evil"), false);
  });
});

describe("M-12 navigation policy", () => {
  test("https allowed (3-D Secure), UPI/intent handed to OS, others blocked", () => {
    assert.equal(decideNavigation("https://api.razorpay.com/v1/payments"), "allow");
    assert.equal(decideNavigation("https://acs.bank.example/3ds"), "allow");
    assert.equal(decideNavigation("about:blank"), "allow");
    for (const u of ["upi://pay?pa=x", "intent://pay#Intent;scheme=upi;end", "tez://upi/pay", "phonepe://pay"]) assert.equal(decideNavigation(u), "open_externally", u);
    for (const u of ["http://insecure.example", "javascript:alert(1)", "file:///etc/hosts", "ftp://x", ""]) assert.equal(decideNavigation(u), "block", u);
  });
});

describe("M-13 dismissal and pending state", () => {
  test("closing asks for confirmation (header ✕ and Android back)", () => {
    const s = read("components/RazorpayWebView.tsx");
    assert.match(s, /onRequestClose=\{requestClose\}/);
    assert.match(s, /onPress=\{requestClose\}/);
  });
  test("pending payment is remembered and cleared only after verification", () => {
    const s = read("app/store/checkout.tsx");
    assert.match(s, /AsyncStorage\.setItem\(PENDING_PAYMENT_KEY/);
    assert.match(s, /AsyncStorage\.removeItem\(PENDING_PAYMENT_KEY\)/);
    assert.ok(!/No amount has been deducted/.test(s), "no false 'nothing deducted' promise");
  });
  test("unpaid orders are labelled 'Payment pending', not 'Order Placed'", () => {
    const s = read("app/store/orders.tsx");
    assert.match(s, /key: "pending",\s+label: "Payment pending"/);
  });
});

describe("M-15 client/server totals", () => {
  const s = read("app/store/checkout.tsx");
  test("shipping weight is multiplied by quantity", () => {
    assert.match(s, /return s \+ w \* Math\.max\(1, Number\(i\.quantity\) \|\| 1\);/);
  });
  test("server amount is shown before paying when it differs", () => {
    assert.match(s, /Math\.abs\(serverPaise - shownPaise\) > 1/);
  });
});
