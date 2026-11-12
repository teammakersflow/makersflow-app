/**
 * Included-kit claim and shipping payment (2026-11-12).
 *
 * NOT RELEASED: renders nothing unless FEATURE_FLAGS.INCLUDED_KIT_CLAIM is
 * true (it is false). The services refuse to run while the flag is off too.
 *
 * Mobile adaptation of the website's IncludedKitClaim (feat/kit-claim). Rules
 * and messages live in lib/includedKitClaim.ts (unit-tested):
 *   - the claim is the one whose course.id matches this course;
 *   - idempotency key is always "kit-claim-<claimId>";
 *   - retries reuse the order's stored shipping address;
 *   - shipping is paid with the existing RazorpayWebView, then
 *     POST /included-kits/verify-payment (unwrapped response).
 * Shipping for a physical kit is a physical-goods payment (allowed under the
 * Play Payments policy, C-5); no digital content is sold here.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { isIncludedKitClaimEnabled } from "@/constants/featureFlags";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiRequest } from "@/lib/auth/apiClient";
import {
  buildClaimRequest,
  claimErrorMessage,
  claimView,
  findClaimForCourse,
  interpretClaimResult,
  KIT_MESSAGES,
  type KitClaim,
} from "@/lib/includedKitClaim";
import { validateCheckoutParams } from "@/lib/razorpayCheckout";
import { RazorpayWebView, type RazorpayPaymentParams } from "@/components/RazorpayWebView";
import { claimIncludedKit, fetchMyKitClaims, verifyKitPayment } from "@/services/includedKitService";

type SavedAddress = {
  id: string;
  full_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string | null;
  city?: string;
  state?: string;
  postal_code?: string;
  is_default?: boolean;
};

export function IncludedKitClaim({ courseId }: { courseId: string }) {
  // Build-time constant: the hooks below are never mounted when it is off.
  if (!isIncludedKitClaimEnabled()) return null;
  return <IncludedKitClaimEnabled courseId={courseId} />;
}

function IncludedKitClaimEnabled({ courseId }: { courseId: string }) {
  const colors = useColors();
  const { user } = useAuth();
  const [claim, setClaim] = useState<KitClaim | null>(null);
  const [pickingAddress, setPickingAddress] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [payment, setPayment] = useState<RazorpayPaymentParams | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setClaim(null);
      return;
    }
    try {
      const claims = await fetchMyKitClaims();
      if (mountedRef.current) setClaim(findClaimForCourse(claims, courseId));
    } catch {
      // Optional section: hide it rather than disturb the course page.
      if (mountedRef.current) setClaim(null);
    }
  }, [user?.id, courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pickingAddress || !user?.id) return;
    let cancelled = false;
    setAddressesLoading(true);
    apiRequest<any>("/shipping-addresses")
      .then((res) => {
        const list: SavedAddress[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        if (cancelled) return;
        setAddresses(list.map((a) => ({ ...a, id: String(a.id) })));
        setSelectedId((cur) => cur ?? (list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null)?.toString() ?? null);
      })
      .catch(() => {
        if (!cancelled) setAddresses([]);
      })
      .finally(() => {
        if (!cancelled) setAddressesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pickingAddress, user?.id]);

  async function confirm() {
    if (!claim || busyRef.current) return;
    const body = buildClaimRequest(claim, selectedId);
    if (!body) {
      // No stored address and none selected yet: ask for one.
      setPickingAddress(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const outcome = interpretClaimResult(await claimIncludedKit(body));
      if (outcome.action === "pay") {
        const address = addresses.find((a) => a.id === body.shippingAddressId);
        const params: RazorpayPaymentParams = {
          orderId: outcome.razorpayOrderId,
          amount: outcome.amountPaise,
          currency: outcome.currency,
          keyId: outcome.razorpayKeyId,
          name: address?.full_name ?? (user as any)?.name ?? "",
          email: (user as any)?.email ?? "",
          phone: address?.phone ?? "",
          description: `${claim.kit.name} kit shipping`,
        };
        if (!validateCheckoutParams(params).ok) {
          Alert.alert("Shipping payment", KIT_MESSAGES.paymentStartFailed);
          return;
        }
        setPayment(params);
        return;
      }
      if (outcome.action === "error") {
        Alert.alert("Shipping payment", outcome.message);
      } else {
        Alert.alert("Course kit", outcome.message);
        setPickingAddress(false);
      }
      await refresh();
    } catch (err) {
      Alert.alert("Course kit", claimErrorMessage(err));
      await refresh();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function onPaymentSuccess(paymentId: string, orderId: string, signature: string) {
    setPayment(null);
    setBusy(true);
    try {
      const ok = await verifyKitPayment({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      });
      Alert.alert(
        "Course kit",
        ok
          ? "Payment received. Your kit order is confirmed."
          : "We could not verify your payment. If money was deducted, contact support with ID: " + paymentId,
      );
    } catch (err) {
      Alert.alert("Course kit", claimErrorMessage(err));
    } finally {
      setPickingAddress(false);
      if (mountedRef.current) setBusy(false);
      await refresh();
    }
  }

  if (!user?.id || !claim) return null;

  const view = claimView(claim);
  const box = (bg: string, border: string) => ({
    marginTop: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: border,
    backgroundColor: bg,
    gap: 8,
  });
  const primaryBtn = (disabled: boolean) => ({
    backgroundColor: "#0B6FAD",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center" as const,
    opacity: disabled ? 0.5 : 1,
  });

  const paymentModal = (
    <RazorpayWebView
      visible={!!payment}
      params={payment}
      onSuccess={onPaymentSuccess}
      onFailure={() => {
        setPayment(null);
        Alert.alert("Shipping payment", "Payment was not completed. You can try again.");
        void refresh();
      }}
      onDismiss={() => {
        setPayment(null);
        void refresh();
      }}
    />
  );

  if (view.kind === "fulfilled") {
    return (
      <View style={box("#DCFCE7", "#86EFAC")}>
        <Text style={{ color: "#166534", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Kit ordered ✓</Text>
        <Pressable onPress={() => router.push("/store/orders")} accessibilityRole="link">
          <Text style={{ color: "#166534", textDecorationLine: "underline", fontSize: 13 }}>Track it in My Orders</Text>
        </Pressable>
      </View>
    );
  }

  if (view.kind === "processing") {
    return (
      <View style={box("#FEF3C7", "#FCD34D")}>
        <Text style={{ color: "#92400E", fontSize: 13 }}>{KIT_MESSAGES.processing}</Text>
      </View>
    );
  }

  const addressPicker = (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Ship your kit to</Text>
      {addressesLoading ? (
        <ActivityIndicator color="#0B6FAD" />
      ) : addresses.length === 0 ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          No saved addresses yet. Add a delivery address in the Store checkout, then come back here.
        </Text>
      ) : (
        addresses.map((a) => {
          const selected = selectedId === a.id;
          return (
            <Pressable
              key={a.id}
              onPress={() => setSelectedId(a.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: "row",
                gap: 8,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: selected ? "#0B6FAD" : colors.border,
              }}
            >
              <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={18} color="#0B6FAD" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                  {a.full_name ?? "Address"}
                  {a.is_default ? " (default)" : ""}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {[a.address_line1, a.address_line2, a.city, a.state, a.postal_code].filter(Boolean).join(", ")}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );

  if (view.kind === "payment_due") {
    const needsAddress = !view.addressId;
    return (
      <View style={box("#FEF3C7", "#FCD34D")}>
        <Text style={{ color: "#92400E", fontSize: 13 }}>Your kit order is waiting for the shipping payment.</Text>
        {needsAddress && pickingAddress && addressPicker}
        <Pressable
          style={primaryBtn(busy || (needsAddress && pickingAddress && !selectedId))}
          disabled={busy || (needsAddress && pickingAddress && !selectedId)}
          onPress={() => (needsAddress && !pickingAddress ? setPickingAddress(true) : void confirm())}
        >
          <Text style={{ color: "#FFF", fontFamily: "Inter_600SemiBold" }}>
            {busy ? "Opening payment…" : "Complete shipping payment"}
          </Text>
        </Pressable>
        {paymentModal}
      </View>
    );
  }

  // view.kind === "claim"
  if (!pickingAddress) {
    return (
      <Pressable style={primaryBtn(false)} onPress={() => setPickingAddress(true)}>
        <Text style={{ color: "#FFF", fontFamily: "Inter_600SemiBold" }}>Claim your free kit</Text>
      </Pressable>
    );
  }

  return (
    <View style={box(colors.background, colors.border)}>
      {addressPicker}
      <Pressable style={primaryBtn(busy || !selectedId)} disabled={busy || !selectedId} onPress={() => void confirm()}>
        <Text style={{ color: "#FFF", fontFamily: "Inter_600SemiBold" }}>{busy ? "Confirming…" : "Confirm & order kit"}</Text>
      </Pressable>
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
        The kit is free. If shipping has a charge, you'll be asked to pay it next.
      </Text>
      {paymentModal}
    </View>
  );
}
