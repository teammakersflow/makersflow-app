// supabase/functions/razorpay-webhook/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "node:crypto";
import { createShiprocketOrder } from "../_shared/shiprocket.ts";
import { Database } from "../_shared/database.types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-razorpay-signature",
};

const supabaseAdmin = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function hmacSha256(secret: string, data: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    data
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isSignatureValid(expected: string, actual: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const signature = req.headers.get("x-razorpay-signature");
    if (!signature) {
      console.warn("[razorpay-webhook] Missing x-razorpay-signature header");
      return Response.json({ error: "Missing signature" }, { status: 400, headers: cors });
    }

    // Read raw body for timing-safe webhook verification
    const rawBody = await req.arrayBuffer();
    const rawBodyBytes = new Uint8Array(rawBody);

    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not configured");
      return Response.json({ error: "Webhook secret missing" }, { status: 500, headers: cors });
    }

    const expectedSignature = await hmacSha256(webhookSecret, rawBodyBytes);
    if (!isSignatureValid(expectedSignature, signature)) {
      console.warn("[razorpay-webhook] Invalid webhook signature verification failed");
      return Response.json({ error: "Invalid signature" }, { status: 400, headers: cors });
    }

    // Parse JSON from raw body bytes
    const bodyText = new TextDecoder().decode(rawBodyBytes);
    const payload = JSON.parse(bodyText);

    const event = payload.event;
    // We only process order capture / payment capture events
    if (event !== "order.paid" && event !== "payment.captured") {
      return Response.json({ success: true, message: `Skipping unhandled event: ${event}` }, { headers: cors });
    }

    const paymentEntity = payload.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!razorpayOrderId || !razorpayPaymentId) {
      console.warn("[razorpay-webhook] Missing order or payment reference in webhook payload");
      return Response.json({ error: "Missing entity references" }, { status: 400, headers: cors });
    }

    // 1. Atomic Order Update (Idempotency)
    const { data: updatedOrders, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: signature,
      })
      .eq("razorpay_order_id", razorpayOrderId)
      .eq("status", "pending")
      .select();

    if (updateError) {
      console.error("[razorpay-webhook] Atomic update failed:", updateError);
      return Response.json({ error: "Fulfillment processing failed" }, { status: 500, headers: cors });
    }

    if (!updatedOrders || updatedOrders.length === 0) {
      // Already marked paid by verify endpoint or concurrent webhook delivery
      return Response.json({ success: true, message: "Order already completed" }, { headers: cors });
    }

    const completedOrder = updatedOrders[0];
    const items = completedOrder.items || [];
    let hasPhysical = false;
    let stockFailure = false;

    // 2. Fulfillment: Course Enrollments & Stock Decrement
    for (const item of items) {
      if (item.is_course && item.course_id) {
        const enrolledAt = new Date();
        const expiresAt = new Date(enrolledAt.getTime() + 365 * 24 * 60 * 60 * 1000);
        
        // ── FIX ──────────────────────────────────────────────────────────
        // This upsert specified no conflict target, so PostgREST defaulted to
        // the primary key (`id`). Since no `id` is supplied, it behaved as a
        // plain INSERT — and whenever an enrolment row already existed for this
        // (user_id, course_id) it collided with uq_enrollments_user_course and
        // errored. The error was only console.error'd, so the payment appeared
        // to succeed while `payment_status` was never advanced to 'completed'.
        //
        // That is why a course could show as paid on the web (which applies no
        // payment filter) yet vanish from the mobile app (which filters on
        // payment_status). Target the real unique index so the row is updated.
        const { error: enrollError } = await supabaseAdmin
          .from("enrollments")
          .upsert(
            {
              user_id: completedOrder.user_id,
              course_id: Number(item.course_id),
              payment_status: "completed",
              status: "active",
              enrolled_at: enrolledAt.toISOString(),
              expires_at: expiresAt.toISOString(),
            },
            { onConflict: "user_id,course_id" },
          );

        if (enrollError) {
          // Loud on purpose: a failure here means the learner paid but has no
          // access. Previously this was logged and swallowed.
          console.error(
            `[razorpay-webhook] CRITICAL: enrolment write failed after successful payment ` +
            `(user=${completedOrder.user_id}, course=${item.course_id}, order=${completedOrder.id}):`,
            enrollError,
          );
        }
      } else if (!item.is_course) {
        hasPhysical = true;
        // Call atomic stock decrement RPC
        const { data: stockResult, error: stockRpcError } = await supabaseAdmin
          .rpc("decrement_product_stock", {
            p_product_id: Number(item.id),
            p_qty: Number(item.qty),
          });

        if (stockRpcError || !stockResult || stockResult.length === 0 || !stockResult[0].success) {
          console.error(`[razorpay-webhook] STOCK OVERSELL DETECTED or RPC error for product ${item.id}:`, stockRpcError);
          stockFailure = true;
        }
      }
    }

    // 3. Fulfillment: Physical Shipping
    if (hasPhysical) {
      if (stockFailure) {
        // Mark shipment_status = 'failed' due to stock shortage
        await supabaseAdmin
          .from("orders")
          .update({ shipment_status: "failed" })
          .eq("id", completedOrder.id);
      } else {
        // Trigger Shiprocket creation
        const totalWeight = items
          .filter((i: any) => !i.is_course)
          .reduce((sum: number, i: any) => sum + (Number(i.qty) * 0.5), 0); // fallback weight

        const shiprocketResult = await createShiprocketOrder(completedOrder.id, {
          shipping_address: completedOrder.shipping_address,
          total_amount: completedOrder.total_amount,
          total_weight: totalWeight,
          items: items.filter((i: any) => !i.is_course),
        });

        const status = shiprocketResult ? "created" : "failed";
        await supabaseAdmin
          .from("orders")
          .update({ shipment_status: status })
          .eq("id", completedOrder.id);

        if (status === "failed") {
          console.error(`[razorpay-webhook] Shiprocket order creation failed for order ${completedOrder.id}`);
        }
      }
    }

    return Response.json({ success: true, message: "Webhook processed successfully" }, { headers: cors });

  } catch (err) {
    console.error("[razorpay-webhook] exception:", err);
    return Response.json({ error: "An unexpected webhook processing error occurred" }, { status: 500, headers: cors });
  }
});
