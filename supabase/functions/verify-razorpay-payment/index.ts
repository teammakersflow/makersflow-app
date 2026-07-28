// supabase/functions/verify-razorpay-payment/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "node:crypto";
import { createShiprocketOrder } from "../_shared/shiprocket.ts";
import { Database } from "../_shared/database.types.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function hmacSha256(secret: string, data: string): Promise<string> {
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
    new TextEncoder().encode(data)
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
    }

    // Verify JWT
    const userClient = createClient<Database>(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
    }

    const { orderId, paymentId, signature } = await req.json();

    if (!orderId || !paymentId || !signature) {
      return Response.json({ error: "Missing verification parameters" }, { status: 400, headers: cors });
    }

    // 1. Fetch order and check ownership
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, status, items, total_amount, shipping_address")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[verify-razorpay-payment] Order lookup failed:", orderError);
      return Response.json({ error: "Order not found" }, { status: 404, headers: cors });
    }

    if (order.user_id !== user.id) {
      return Response.json({ error: "Access denied" }, { status: 403, headers: cors });
    }

    // 2. Timing-Safe Signature Verification
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keySecret) {
      return Response.json({ error: "Payment gateway misconfigured" }, { status: 500, headers: cors });
    }

    const expectedSignature = await hmacSha256(keySecret, `${orderId}|${paymentId}`);
    if (!isSignatureValid(expectedSignature, signature)) {
      return Response.json({ error: "Invalid payment signature" }, { status: 400, headers: cors });
    }

    // 3. Atomic Order Update (Idempotency)
    const { data: updatedOrders, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      })
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending")
      .select();

    if (updateError) {
      console.error("[verify-razorpay-payment] Atomic update failed:", updateError);
      return Response.json({ error: "Fulfillment processing failed" }, { status: 500, headers: cors });
    }

    if (!updatedOrders || updatedOrders.length === 0) {
      // Already marked paid by webhook or concurrent callback
      return Response.json({ success: true, message: "Order already completed" }, { headers: cors });
    }

    const completedOrder = updatedOrders[0];
    const items = completedOrder.items || [];
    let hasPhysical = false;
    let stockFailure = false;

    // 4. Fulfillment: Course Enrollments & Stock Decrement
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
            `[verify-razorpay-payment] CRITICAL: enrolment write failed after successful payment ` +
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
          console.error(`[verify-razorpay-payment] STOCK OVERSELL DETECTED or RPC error for product ${item.id}:`, stockRpcError);
          stockFailure = true;
        }
      }
    }

    // 5. Fulfillment: Physical Shipping
    if (hasPhysical) {
      if (stockFailure) {
        // Mark shipment_status = 'failed' due to stock shortage (for manual reconciliation/refund)
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
          console.error(`[verify-razorpay-payment] Shiprocket order creation failed for order ${completedOrder.id}`);
        }
      }
    }

    return Response.json({ success: true }, { headers: cors });

  } catch (err) {
    console.error("[verify-razorpay-payment] exception:", err);
    return Response.json({ error: "An unexpected verification error occurred" }, { status: 500, headers: cors });
  }
});
