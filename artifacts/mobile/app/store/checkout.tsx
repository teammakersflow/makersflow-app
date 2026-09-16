import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/auth/apiClient";
import { productService } from "@/services/productService";
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { setInvoicePath } from "@/lib/invoiceStorage";
import {
  buildInvoiceHtml,
  generateInvoiceNumber,
  fetchSellerSettings,
  type InvoiceLineItem,
  type InvoiceAddress,
} from "@/lib/invoiceUtils";
import { settingsService } from "@/services/settingsService";
import { RazorpayWebView, type RazorpayPaymentParams } from "@/components/RazorpayWebView";
interface ShiprocketRate {
  success: boolean;
  fee: number | null;
  courierName: string;
  estimatedDays: string;
  source: "shiprocket" | "fallback";
}
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "@/services/razorpayService";
import { orderService } from "@/services/orderService";

// ─── Slide-to-Pay Button ─────────────────────────────────────────────────────

function SlideToPayButton({
  amount,
  onSlideComplete,
  loading,
}: {
  amount: number;
  onSlideComplete: () => void;
  loading: boolean;
}) {
  const TRACK_WIDTH = 340;
  const THUMB_SIZE = 48;
  const PADDING = 4;
  const MAX_SLIDE = TRACK_WIDTH - THUMB_SIZE - PADDING * 2;

  const translateX = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [completed, setCompleted] = useState(false);

  const onSlideCompleteRef = useRef(onSlideComplete);
  onSlideCompleteRef.current = onSlideComplete;

  useEffect(() => {
    if (loading || completed) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [loading, completed]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        const clamped = Math.max(0, Math.min(gs.dx, MAX_SLIDE));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx >= MAX_SLIDE * 0.85) {
          Animated.timing(translateX, {
            toValue: MAX_SLIDE,
            duration: 120,
            useNativeDriver: true,
          }).start(() => {
            setCompleted(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSlideCompleteRef.current();
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 8,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (!loading && completed) {
      setTimeout(() => {
        setCompleted(false);
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      }, 800);
    } else if (!loading && !completed) {
      translateX.setValue(0);
    }
  }, [loading, completed]);

  return (
    <View style={styles.slideTrack}>
      <LinearGradient
        colors={["#0B6FAD", "#FF6B00"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {loading ? (
        <ActivityIndicator color="#FFF" />
      ) : (
        <>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, opacity: pulseAnim },
            ]}
            pointerEvents="none"
          >
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.6)" />
            <Text style={styles.slideLabel}>Slide to Pay ₹{amount}</Text>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.6)" />
          </Animated.View>

          <Animated.View
            style={[styles.slideThumb, { transform: [{ translateX }] }]}
            {...panResponder.panHandlers}
          >
            {completed ? (
              <Ionicons name="checkmark" size={22} color="#0B6FAD" />
            ) : (
              <Ionicons name="chevron-forward" size={22} color="#0B6FAD" />
            )}
          </Animated.View>
        </>
      )}
    </View>
  );
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

type StepStatus = "done" | "current" | "upcoming";

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps: { id: number; label: string; status: StepStatus }[] = [
    { id: 1, label: "Cart",     status: step > 1 ? "done" : step === 1 ? "current" : "upcoming" },
    { id: 2, label: "Checkout", status: step > 2 ? "done" : step === 2 ? "current" : "upcoming" },
    { id: 3, label: "Payment",  status: step > 3 ? "done" : step === 3 ? "current" : "upcoming" },
  ];
  return (
    <View style={styles.stepIndicatorContainer}>
      {steps.map((s, idx) => (
        <React.Fragment key={s.id}>
          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, { backgroundColor: s.status === "upcoming" ? "#E8F4F9" : "#0B6FAD" }]}>
              {s.status === "done" ? (
                <Ionicons name="checkmark" size={12} color="#FFF" />
              ) : (
                <Text style={[styles.stepNum, { color: s.status === "current" ? "#FFF" : "#5A7A8C" }]}>{s.id}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, { color: s.status === "upcoming" ? "#5A7A8C" : "#0B6FAD", fontFamily: s.status === "current" ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
              {s.label}
            </Text>
          </View>
          {idx < 2 && <View style={[styles.stepLine, { backgroundColor: s.status === "done" ? "#0B6FAD" : "#D6E9F2" }]} />}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── Main Checkout Screen ─────────────────────────────────────────────────────

export default function CheckoutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { items, total, clearCart, addToCart, decrementQuantity } = useCart();
  const { user } = useAuth();

  // ── Contact (digital-only orders) ──
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");

  // ── Loading ──
  const [loading, setLoading] = useState(false);

  // ── Promo ──
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discount: number;
    label: string;
    id: string;
  } | null>(null);

  // ── Shipping config (from admin settings) ──
  const [shippingConfig, setShippingConfig] = useState({ fee: 49, remoteFee: 149, threshold: 999 });

  // ── Shiprocket live rate ──
  const [shiprocketRate, setShiprocketRate] = useState<ShiprocketRate | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);

  // ── GST ──
  const [gstRates, setGstRates] = useState<Map<string, number>>(new Map());

  // ── Addresses ──
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  // ── Address Form ──
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [formFullName, setFormFullName] = useState("");
  const [formAddressLine1, setFormAddressLine1] = useState("");
  const [formAddressLine2, setFormAddressLine2] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formState, setFormState] = useState("");
  const [formPostalCode, setFormPostalCode] = useState("");
  const [formPhone, setFormPhone] = useState("+91");

  // ── Payment ──
  const [showPayment, setShowPayment] = useState(false);
  const [razorpayParams, setRazorpayParams] = useState<RazorpayPaymentParams | null>(null);
  const [pendingAddress, setPendingAddress] = useState<any>(null);
  const isVerifyingRef = useRef(false);

  // ── Step tracking: 2 = checkout form, 3 = payment ready ──
  // Payment section only shows when address is selected (for physical) or contact filled (digital)
  const hasPhysical = items.some((i) => i.product.category === "physical");
  const activeAddress = addresses.find((a) => String(a.id) === String(selectedAddressId));

  // FIX: Payment section visibility — show only when shipping is ready
  const isShippingReady = hasPhysical
    ? !!activeAddress  // must have a selected address
    : (name.trim().length > 0 && phone.trim().length >= 10); // must have contact info

  const currentStep: 1 | 2 | 3 = isShippingReady ? 3 : 2;

  // ── Derived totals ──
  const discount = appliedPromo ? Math.min(appliedPromo.discount, total) : 0;

  const REMOTE_STATES = new Set([
    "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Sikkim", "Tripura",
    "Andaman and Nicobar Islands", "Lakshadweep",
    "Jammu and Kashmir", "Ladakh",
  ]);

  const taxable = Math.max(0, total - discount);
  const taxAmount = Math.round(
    items.reduce((sum, item) => {
      const itemSubtotal = item.product.price * item.quantity;
      const discountShare = total > 0 ? (itemSubtotal / total) * discount : 0;
      const itemTaxable = Math.max(0, itemSubtotal - discountShare);
      const rate = gstRates.get(String(item.product.id)) ?? 18;
      return sum + itemTaxable * (rate / 100);
    }, 0),
  );

  const isRemoteState = !!(activeAddress?.state && REMOTE_STATES.has(activeAddress.state));
  const fallbackShippingFee = isRemoteState ? shippingConfig.remoteFee : shippingConfig.fee;

  // No address selected → ₹0 (don't show fallback to new/empty users)
  // Loading → keep previous value or ₹0 so total doesn't jump
  // Address selected + rate resolved → use Shiprocket or fallback
  const shippingFee = (() => {
    if (!hasPhysical) return 0;
    if (!activeAddress) return 0;                          // no address yet
    if (taxable >= shippingConfig.threshold) return 0;    // free shipping threshold
    if (shippingLoading) return (shiprocketRate && shiprocketRate.fee !== null) ? shiprocketRate.fee : 0; // calculating — don't flash fallback
    return (shiprocketRate && shiprocketRate.fee !== null) ? shiprocketRate.fee : fallbackShippingFee;
  })();
  // Don't add shipping to total until address is selected — avoids confusing ₹3 total for new users
  const finalTotal = taxable + taxAmount + (activeAddress ? shippingFee : 0);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Load admin shipping config ──
  useEffect(() => {
    settingsService
      .getShippingSettings()
      .then((config) => {
        setShippingConfig(config);
      })
      .catch((err) => {
        console.warn("[Checkout] Failed to load shipping settings from backend:", err);
      });
  }, []);

  // ── FIX: Fetch live Shiprocket rate — wait for BOTH addresses AND selectedAddressId to be ready ──
  useEffect(() => {
    // Only run when we actually have a selected address
    if (!selectedAddressId || addresses.length === 0) {
      setShiprocketRate(null);
      setShippingLoading(false);
      return;
    }

    // FIX: compare both as strings to avoid number/string type mismatch
    const addr = addresses.find((a) => String(a.id) === String(selectedAddressId));

    if (!addr) {
      setShiprocketRate(null);
      setShippingLoading(false);
      return;
    }

    // FIX: check ALL possible pincode field names from Supabase
    const rawPincode = addr.postal_code ?? addr.pincode ?? addr.zip ?? addr.postcode ?? "";
    const pincode = String(rawPincode).replace(/\D/g, "").trim();

    const physicalItems = items.filter((i) => i.product.category === "physical");
    const isPhys = physicalItems.length > 0;


    if (!pincode || pincode.length < 6 || !isPhys) {
      setShiprocketRate(null);
      setShippingLoading(false);
      return;
    }

    setShippingLoading(true);
    // Weight per shipment — not multiplied by quantity
    const totalWeight = physicalItems.reduce((s, i) => {
      const w = (i.product as any).weight_kg ?? 0.5;
      return s + w;
    }, 0);
    const physicalSubtotal = physicalItems.reduce((s, i) => s + i.product.price * i.quantity, 0);

    apiRequest<any>("/shipping/rates", {
      method: "POST",
      body: JSON.stringify({
        pickup_postcode: "500034",
        delivery_postcode: pincode,
        weight: Math.max(totalWeight, 0.1),
        product_type: "physical",
      }),
    }).then((res) => {
      const resData = res?.data?.data ?? res?.data ?? res;
      const couriers: any[] =
        resData?.available_courier_companies ??
        resData?.data?.available_courier_companies ??
        [];

      if (Array.isArray(couriers) && couriers.length > 0) {
        const sorted = couriers
          .filter((c: any) => typeof c.rate === "number" && c.rate > 0)
          .sort((a: any, b: any) => a.rate - b.rate);
        if (sorted.length > 0) {
          const best = sorted[0];
          setShiprocketRate({
            success: true,
            fee: Math.round(best.rate),
            courierName: best.courier_name ?? "Shiprocket",
            estimatedDays: best.estimated_delivery_days ? `${best.estimated_delivery_days} days` : (best.etd ?? "3-5 days"),
            source: "shiprocket",
          });
          return;
        }
      }

      if (resData?.fee !== undefined || res?.fee !== undefined) {
        const obj = resData?.fee !== undefined ? resData : res;
        setShiprocketRate({
          success: true,
          fee: typeof obj.fee === "number" ? Math.round(obj.fee) : null,
          courierName: obj.courierName ?? obj.courier ?? "Shiprocket",
          estimatedDays: obj.estimatedDays ?? obj.etd ?? "3-5 days",
          source: "shiprocket",
        });
        return;
      }

      setShiprocketRate(null);
    }).catch((err) => {
      console.warn("[Shiprocket] Backend rate calculation failed:", err);
      setShiprocketRate(null);
    }).finally(() => {
      setShippingLoading(false);
    });
  // FIX: correct dependency — run whenever selectedAddressId or addresses list changes
  }, [selectedAddressId, addresses, items, shippingConfig]);

  // ── Load GST rates ──
  useEffect(() => {
    if (items.length === 0) return;
    let isMounted = true;
    (async () => {
      const map = new Map<string, number>();
      const missingIds: string[] = [];
      for (const item of items) {
        if (item.product.gst_rate !== undefined && item.product.gst_rate !== null) {
          map.set(String(item.product.id), Number(item.product.gst_rate));
        } else {
          missingIds.push(String(item.product.id));
        }
      }
      if (missingIds.length > 0) {
        const fetched = await Promise.all(
          missingIds.map((id) => productService.getProductById(id).catch(() => null))
        );
        for (const p of fetched) {
          if (p) {
            map.set(String(p.id), p.gst_rate ?? 18);
          }
        }
      }
      if (isMounted) {
        setGstRates(map);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [items]);

  // ── Cart guard ──
  const [cartChecked, setCartChecked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setCartChecked(true), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (cartChecked && items.length === 0) router.back();
  }, [cartChecked, items.length]);

  // ── Sync user profile ──
  useEffect(() => {
    if (user?.name && !name) setName(user.name);
    if (user?.phone && !phone) setPhone(user.phone);
  }, [user?.name, user?.phone]);

  // ── Load addresses ──
  async function loadAddresses(keepSelectedId?: string) {
    if (!user?.id) return;

    // Load from backend /shipping-addresses
    let loadedData: any[] | null = null;
    try {
      const res = await apiRequest<any>('/shipping-addresses');
      const list = res?.data ?? (Array.isArray(res) ? res : null);
      if (Array.isArray(list)) {
        loadedData = list;
      }
    } catch (e: any) {
      console.warn("[Checkout] Failed to load shipping addresses from backend:", e);
      return;
    }

    if (!loadedData) return;
    setAddresses(loadedData);

    // FIX: if we have a keepSelectedId and it exists, keep it selected
    // Otherwise pick default/first — but DON'T auto-select if user has explicitly deselected
    if (keepSelectedId) {
      const exists = loadedData.some((a) => String(a.id) === String(keepSelectedId));
      if (exists) {
        setSelectedAddressId(String(keepSelectedId));
        return;
      }
    }

    // FIX: Only auto-select on first load (when selectedAddressId is null).
    // After first load, preserve whatever user chose.
    if (selectedAddressId === null) {
      const def = loadedData.find((a) => a.is_default) ?? loadedData[0];
      if (def) {
        setSelectedAddressId(String(def.id));
        setName(def.full_name ?? name);
        setPhone(def.phone ?? phone);
      }
    }
  }

  useEffect(() => { loadAddresses(undefined); }, [user?.id]);

  // ── Address form helpers ──
  const resetAddressForm = () => {
    setEditingAddressId(null);
    setFormFullName(""); setFormAddressLine1(""); setFormAddressLine2("");
    setFormCity(""); setFormState(""); setFormPostalCode(""); setFormPhone("+91");
  };

  const handleEditAddress = (addr: any) => {
    setEditingAddressId(String(addr.id));
    setFormFullName(addr.full_name ?? "");
    setFormAddressLine1(addr.address_line1 ?? "");
    setFormAddressLine2(addr.address_line2 ?? "");
    setFormCity(addr.city ?? "");
    setFormState(addr.state ?? "");
    setFormPostalCode(addr.postal_code ?? "");
    const ph = addr.phone ?? "";
    setFormPhone(ph.startsWith("+91") ? ph : `+91${ph}`);
    setShowAddressForm(true);
  };

  const handleSaveAddress = async () => {
    if (!formFullName.trim() || !formAddressLine1.trim() || !formCity.trim() || !formState.trim() || !formPostalCode.trim() || !formPhone.trim()) {
      Alert.alert("Validation Error", "All fields except Address Line 2 are required."); return;
    }
    const rawPhone = formPhone.trim().replace(/^\+91/, "");
    if (!/^\d{10}$/.test(rawPhone)) {
      Alert.alert("Validation Error", "Phone must be a 10-digit number after +91."); return;
    }
    if (!/^\d{6}$/.test(formPostalCode.trim())) {
      Alert.alert("Validation Error", "Pincode must be exactly 6 digits."); return;
    }
    if (!user?.id) return;

    const addressPayload = {
      full_name: formFullName.trim(),
      address_line1: formAddressLine1.trim(),
      address_line2: formAddressLine2.trim() || undefined,
      city: formCity.trim(),
      state: formState.trim(),
      postal_code: formPostalCode.trim(),
      phone: formPhone.trim().replace(/^\+91/, ""),
    };

    try {
      if (editingAddressId) {
        await apiRequest(`/shipping-addresses/${editingAddressId}`, {
          method: "PATCH",
          body: JSON.stringify(addressPayload),
        });
        setShowAddressForm(false);
        resetAddressForm();
        await loadAddresses(selectedAddressId ?? undefined);
        return;
      } else {
        const isFirst = addresses.length === 0;
        const res = await apiRequest<any>("/shipping-addresses", {
          method: "POST",
          body: JSON.stringify({ ...addressPayload, is_default: isFirst }),
        });
        const inserted = res?.data ?? res;
        setShowAddressForm(false);
        resetAddressForm();
        const newId = inserted?.id ? String(inserted.id) : null;
        await loadAddresses(newId ?? undefined);
        return;
      }
    } catch (e: any) {
      const errMsg = Array.isArray(e?.message) ? e.message.join(", ") : (e?.message || "Failed to save address.");
      Alert.alert("Error", errMsg);
      return;
    }
  };

  const handleDeleteAddress = (addr: any) => {
    Alert.alert(
      "Delete Address",
      "Are you sure you want to remove this address?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            try {
              await apiRequest(`/shipping-addresses/${addr.id}`, { method: "DELETE" });
            } catch (e: any) {
              const errMsg = Array.isArray(e?.message) ? e.message.join(", ") : (e?.message || "Failed to delete address.");
              Alert.alert("Error", errMsg);
              return;
            }
            // FIX: if deleted address was selected, clear selection so user must pick again
            if (String(selectedAddressId) === String(addr.id)) {
              setSelectedAddressId(null);
              setShiprocketRate(null);
            }
            await loadAddresses(undefined);
          },
        },
      ]
    );
  };

  // ── Promo ──
  async function handleApplyPromo() {
    const code = promoCode.trim().toUpperCase();
    if (!code) return;
    setPromoError("");
    setPromoLoading(true);

    try {
      const res = await apiRequest<any>("/coupons/validate", {
        method: "POST",
        body: JSON.stringify({
          code,
          order_amount: total,
          product_ids: items.map((i) => String(i.product.id)),
        }),
      });
      const resData = res?.data ?? res;
      if (resData?.valid) {
        setAppliedPromo({
          code: resData.code || code,
          discount: Number(resData.discount_amount ?? 0),
          label: `${resData.code || code} applied`,
          id: resData.coupon_id,
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setPromoError(resData?.message || "Invalid coupon code.");
      }
    } catch (backendErr: any) {
      const errMsg = Array.isArray(backendErr?.message)
        ? backendErr.message.join(", ")
        : (backendErr?.message || "Invalid coupon code.");
      setPromoError(errMsg);
    } finally {
      setPromoLoading(false);
    }
  }

  // ── Pay ──
  async function handlePay() {
    if (hasPhysical && !activeAddress) {
      Alert.alert("Incomplete", "Please add and select a shipping address.");
      setLoading(false);
      return;
    }
    if (!hasPhysical && (!name.trim() || !phone.trim())) {
      Alert.alert("Incomplete", "Please fill in your name and phone number.");
      setLoading(false);
      return;
    }
    if (!user?.id) {
      Alert.alert("Login Required", "Please log in to place an order.");
      setLoading(false);
      return;
    }

    const hasCourses = items.some((i) => (i.product as any).is_course);
    if (hasCourses) {
      if (!hasPhysical) {
        Alert.alert("Course Purchase", "Digital courses require the separate course enrollment flow. Please enroll directly on the course screen.");
      } else {
        Alert.alert("Mixed Cart", "Your cart contains both courses and physical products. The store payment flow currently supports physical products only. Please remove courses to proceed with store checkout.");
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Deduplicate product lines and strictly validate numeric product IDs as required by Backend (5)
      const productItemsMap = new Map<string, number>();
      for (const item of items) {
        const pid = String(item.product.id).trim();
        if (!/^\d+$/.test(pid)) {
          Alert.alert("Invalid Product", `Product "${item.product.title || item.product.id}" has an invalid ID. Store checkout requires valid numeric product IDs.`);
          setLoading(false);
          return;
        }
        const qty = Math.max(1, Math.floor(item.quantity || 1));
        productItemsMap.set(pid, (productItemsMap.get(pid) || 0) + qty);
      }

      const itemsPayload = Array.from(productItemsMap.entries()).map(([productId, quantity]) => ({
        productId,
        quantity,
      }));

      if (itemsPayload.length === 0) {
        Alert.alert("Error", "No physical products found in cart for store checkout.");
        setLoading(false);
        return;
      }

      const shippingAddressPayload = activeAddress
        ? {
            name: activeAddress.full_name,
            address_line1: activeAddress.address_line1,
            address_line2: activeAddress.address_line2 || undefined,
            city: activeAddress.city,
            state: activeAddress.state,
            pincode: activeAddress.postal_code ?? activeAddress.pincode,
            phone: activeAddress.phone,
          }
        : null;

      let rzpOrder;
      try {
        rzpOrder = await createRazorpayOrder({
          amount: finalTotal,
          currency: "INR",
          receipt: `mobile_${Date.now()}`,
          items: itemsPayload,
          shipping_address: shippingAddressPayload,
          order_type: "product",
        });
      } catch (orderErr: any) {
        throw new Error(orderErr.message ?? "Failed to create Razorpay order.");
      }

      setPendingAddress(activeAddress);

      setRazorpayParams({
        orderId: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        keyId: rzpOrder.key_id,
        name: activeAddress?.full_name ?? name,
        email: user?.email ?? "",
        phone: activeAddress?.phone ?? phone,
        description: `${items.length} item${items.length > 1 ? "s" : ""} from MakersFlow`,
      });
      setShowPayment(true);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Could not start payment. Please try again.");
      setLoading(false);
    }
  }

  async function handlePaymentSuccess(
    paymentId: string,
    orderId: string,
    signature: string,
  ) {
    if (isVerifyingRef.current) return;
    isVerifyingRef.current = true;

    setShowPayment(false);
    setLoading(true);
    try {
      const verification = await verifyRazorpayPayment({
        razorpay_order_id: orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
      });

      if (!verification.success) {
        isVerifyingRef.current = false;
        Alert.alert(
          "Verification Failed",
          "We could not verify your payment. If money was deducted, contact support with ID: " + paymentId,
        );
        return;
      }

      // If backend did not create order during verify, transitional fallback to orderService
      let createdOrder = verification.order ?? null;
      if (!createdOrder) {
        try {
          const cartItemsForBackend = items.map((item) => ({
            id: String(item.product.id),
            price: Number(item.product.price) || 0,
            qty: item.quantity,
            is_course: (item.product as any).is_course ?? false,
            course_id: (item.product as any).course_id ?? null,
            title: item.product.title,
          }));

          createdOrder = await orderService.checkoutOrder({
            total_amount: finalTotal,
            subtotal: total,
            tax_amount: taxAmount,
            discount_amount: discount,
            order_type: hasPhysical ? 'product' : 'digital',
            shipping_address: pendingAddress
              ? {
                  name: pendingAddress.full_name,
                  address: `${pendingAddress.address_line1}${pendingAddress.address_line2 ? `, ${pendingAddress.address_line2}` : ''}`,
                  city: pendingAddress.city,
                  state: pendingAddress.state,
                  pincode: pendingAddress.postal_code ?? pendingAddress.pincode,
                  phone: pendingAddress.phone,
                }
              : null,
            items: cartItemsForBackend,
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            promo_code: appliedPromo?.code ?? null,
            coupon_id: appliedPromo?.id ?? null,
          });
        } catch (orderSaveErr) {
          console.error('[Checkout] Failed to persist order via backend:', orderSaveErr);
        }
      }

      // Prioritize server invoice URL if provided by backend verification
      try {
        const ordId = createdOrder?.id ? String(createdOrder.id) : Date.now().toString();
        const serverInvoiceUrl = verification.invoice?.invoice_url || (createdOrder as any)?.invoice_url;

        if (serverInvoiceUrl) {
          await setInvoicePath(ordId, serverInvoiceUrl);
        } else {
          // Fallback: Generate invoice via unified invoiceUtils generator only if server invoice not supplied
          const seller = await fetchSellerSettings();
          const invoiceNumber = await generateInvoiceNumber();

          const buyerAddress: InvoiceAddress = {
            name: name || "Customer",
            line1: pendingAddress?.address_line1 || "",
            line2: pendingAddress?.address_line2 || undefined,
            city: pendingAddress?.city || "",
            state: pendingAddress?.state || "Andhra Pradesh",
            pincode: pendingAddress?.pincode || "",
            phone: phone || undefined,
            gstin: undefined,
          };

        // HSN/SAC fallback: uses item.hsn_code / product.hsn_code when available in DB,
        // otherwise falls back to standard HSN 84733099 (goods/kits) / SAC 999294 (services/courses).
        const totalCartItems = items.reduce((s, i) => s + i.quantity, 0);
        const itemDiscountShare = totalCartItems > 0 ? discount / totalCartItems : 0;

        const invoiceItems: InvoiceLineItem[] = items.map((i) => {
          const isSvc = (i.product as any)?.isService === true;
          const hsn = (i.product as any)?.hsn_code
            ? (i.product as any).hsn_code
            : (isSvc ? "999294" : "84733099");
          const rate = typeof (i.product as any)?.gst_rate === "number"
            ? (i.product as any).gst_rate
            : 18;

          return {
            description: i.product.title,
            hsnSac: hsn,
            isService: isSvc,
            quantity: i.quantity,
            unitPrice: i.product.price,
            discountAmount: itemDiscountShare * i.quantity,
            gstRate: rate,
          };
        });

        const html = buildInvoiceHtml(
          {
            invoiceNumber,
            invoiceDate: new Date(),
            paymentId: paymentId || ordId,
            items: invoiceItems,
            billingAddress: buyerAddress,
            shippingAddress: pendingAddress ? buyerAddress : undefined,
            shippingFee,
            couponCode: appliedPromo?.code,
            totalDiscount: discount,
          },
          seller
        );

        if (Platform.OS === "web") {
          await setInvoicePath(ordId, `html:${html}`);
        } else {
          const { uri } = await Print.printToFileAsync({ html, base64: false });
          const dir = `${FileSystem.documentDirectory}invoices/`;
          const dirInfo = await FileSystem.getInfoAsync(dir);
          if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          const dest = `${dir}invoice_${ordId}.pdf`;
          await FileSystem.moveAsync({ from: uri, to: dest });
          await setInvoicePath(ordId, dest);
        }
      }
    } catch (e) {
        console.error("[Checkout] Invoice generation error:", e);
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      clearCart();

      Alert.alert(
        "🎉 Payment Successful!",
        `₹${finalTotal} paid.\nPayment ID: ${paymentId.slice(-8)}${appliedPromo ? `\nYou saved ₹${discount}!` : ""}`,
        [
          { text: "View Orders", onPress: () => router.replace("/store/orders") },
          { text: "OK", onPress: () => router.replace("/(tabs)") },
        ],
      );
    } catch (err: any) {
      console.error("[Checkout] Post-payment error:", err);
      Alert.alert(
        "Order Error",
        `Payment was successful (ID: ${paymentId}) but order saving failed. Please contact support.`,
      );
    } finally {
      setLoading(false);
      setPendingAddress(null);
      setRazorpayParams(null);
    }
  }

  function handlePaymentFailure(reason: string) {
    setLoading(false);
    setShowPayment(false);
    setRazorpayParams(null);
    Alert.alert(
      "Payment Failed",
      reason || "Your payment could not be completed. No amount has been deducted.",
      [
        { text: "Try Again" },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  if (items.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.background, paddingTop: topPad + 20 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Ionicons name="cart" size={48} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your cart is empty</Text>
        <Pressable style={[styles.shopBtn, { backgroundColor: "#0B6FAD" }]} onPress={() => router.push("/(tabs)/store")}>
          <Text style={styles.shopBtnText}>Browse Store</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Checkout</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Step Indicator — updates dynamically */}
        <StepIndicator step={currentStep} />

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: Platform.OS === "web" ? 120 : insets.bottom + 140 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Order Summary ── */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Order Summary</Text>
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {items.map((item) => (
              <View key={item.product.id} style={styles.orderItem}>
                <Image
                  source={
                    item.product.thumbnail
                      ? typeof item.product.thumbnail === "string"
                        ? { uri: item.product.thumbnail }
                        : item.product.thumbnail
                      : require("@/assets/images/courses/course_robotics.webp")
                  }
                  style={styles.itemThumbnail}
                />
                <View style={styles.itemInfo}>
                  <Text style={[styles.orderItemName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.product.title}
                  </Text>
                  <Text style={[styles.orderItemPrice, { color: colors.foreground }]}>₹{item.product.price}</Text>
                </View>
                <View style={[styles.controlsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Pressable onPress={() => decrementQuantity(String(item.product.id))} style={styles.controlBtn} hitSlop={8}>
                    <Ionicons name={item.quantity <= 1 ? "trash" : "remove"} size={14} color={item.quantity <= 1 ? "#ef4444" : colors.foreground} />
                  </Pressable>
                  <Text style={[styles.qtyText, { color: colors.foreground }]}>{item.quantity}</Text>
                  <Pressable onPress={() => addToCart(item.product)} style={styles.controlBtn} hitSlop={8}>
                    <Ionicons name="add" size={14} color={colors.foreground} />
                  </Pressable>
                </View>
              </View>
            ))}

            <View style={[styles.totalRow, { borderTopColor: "#D6E9F2" }]}>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>Subtotal</Text>
              <Text style={[styles.totalAmount, { color: colors.foreground }]}>₹{total}</Text>
            </View>
            {appliedPromo && (
              <View style={styles.discountRow}>
                <Text style={styles.discountLabel}>Coupon ({appliedPromo.code}) — {appliedPromo.label}</Text>
                <Text style={styles.discountAmount}>-₹{discount}</Text>
              </View>
            )}
            <View style={styles.discountRow}>
              <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>GST</Text>
              <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>+₹{taxAmount}</Text>
            </View>
            {hasPhysical && (
              <View style={styles.discountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>
                    {!activeAddress
                      ? "Shipping"
                      : shippingLoading
                        ? "Calculating shipping..."
                        : shippingFee === 0 && taxable >= shippingConfig.threshold
                          ? "Shipping (Free)"
                          : shiprocketRate?.source === "shiprocket"
                            ? `via ${shiprocketRate.courierName}`
                            : isRemoteState
                              ? "Shipping (remote area)"
                              : "Shipping"}
                  </Text>
                  {shiprocketRate?.source === "shiprocket" && shiprocketRate.estimatedDays && activeAddress ? (
                    <Text style={{ fontSize: 11, color: "#10B981", fontFamily: "Inter_400Regular", marginTop: 2 }}>
                      ✓ Est. delivery: {shiprocketRate.estimatedDays}
                    </Text>
                  ) : null}
                </View>
                {!activeAddress ? (
                  <View style={styles.addAddressBadge}>
                    <Text style={styles.addAddressBadgeText}>📍 Add address</Text>
                  </View>
                ) : (
                  <Text style={[styles.totalLabel, { color: shippingFee === 0 ? "#10B981" : colors.mutedForeground }]}>
                    {shippingLoading
                      ? "..."
                      : shippingFee === 0
                        ? "Free"
                        : `+₹${shippingFee}`}
                  </Text>
                )}
              </View>
            )}
            <View style={[styles.totalRow, { borderTopColor: "#D6E9F2" }]}>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>Total</Text>
              <Text style={[styles.totalAmount, { color: colors.foreground }]}>₹{finalTotal}</Text>
            </View>
          </View>

          {/* ── Promo Code ── */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Promo Code</Text>
          {appliedPromo ? (
            <View style={[styles.promoApplied, { backgroundColor: "#DCF7F4", borderColor: "#17E5D3" }]}>
              <Ionicons name="checkmark-circle" size={16} color="#0B6FAD" />
              <Text style={styles.promoAppliedText}>{appliedPromo.code} — {appliedPromo.label} applied!</Text>
              <Pressable onPress={() => { setAppliedPromo(null); setPromoCode(""); }} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#0B6FAD" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.promoRow}>
              <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: promoError ? "#DC2626" : colors.border, flex: 1 }]}>
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  value={promoCode}
                  onChangeText={(t) => { setPromoCode(t.toUpperCase()); setPromoError(""); }}
                  placeholder="Enter promo code"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                />
              </View>
              <Pressable style={[styles.promoBtn, { opacity: promoLoading ? 0.7 : 1 }]} onPress={handleApplyPromo} disabled={promoLoading}>
                {promoLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.promoBtnText}>Apply</Text>}
              </Pressable>
            </View>
          )}
          {promoError ? <Text style={styles.promoError}>{promoError}</Text> : null}

          {/* ── Shipping Address (physical items) ── */}
          {hasPhysical ? (
            <>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Shipping Address</Text>
                <Pressable onPress={() => { resetAddressForm(); setShowAddressForm(true); }} style={styles.addAddrBtn}>
                  <Ionicons name="add" size={14} color="#0B6FAD" />
                  <Text style={[styles.addAddrBtnText, { color: "#0B6FAD" }]}>Add New</Text>
                </Pressable>
              </View>

              {addresses.length === 0 ? (
                <View style={[styles.emptyAddressesCard, { borderColor: colors.border }]}>
                  <Ionicons name="location-outline" size={28} color={colors.mutedForeground} style={{ marginBottom: 8 }} />
                  <Text style={[styles.emptyAddressesText, { color: colors.mutedForeground }]}>
                    No saved addresses. Add one to continue.
                  </Text>
                  <Pressable
                    onPress={() => { resetAddressForm(); setShowAddressForm(true); }}
                    style={[styles.addFirstAddrBtn, { backgroundColor: "#0B6FAD" }]}
                  >
                    <Ionicons name="add" size={16} color="#FFF" />
                    <Text style={styles.addFirstAddrBtnText}>Add Address</Text>
                  </Pressable>
                </View>
              ) : (
                addresses.map((addr) => {
                  const isSelected = String(addr.id) === String(selectedAddressId);
                  return (
                    <Pressable
                      key={addr.id}
                      onPress={() => {
                        setSelectedAddressId(String(addr.id));
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      }}
                      style={[
                        styles.addressCard,
                        {
                          backgroundColor: isSelected ? "#0B6FAD" : colors.card,
                          borderColor: isSelected ? "#0B6FAD" : colors.border,
                          borderWidth: isSelected ? 2.5 : 1.2,
                        },
                      ]}
                    >
                      {/* Selection indicator */}
                      <View style={styles.addrSelectIcon}>
                        <Ionicons
                          name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                          size={24}
                          color={isSelected ? "#FFFFFF" : colors.mutedForeground}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.addressCardHeader}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                            <Text style={[styles.addressName, { color: isSelected ? "#FFF" : colors.foreground }]}>
                              {addr.full_name}
                            </Text>
                            {addr.is_default && (
                              <View style={[styles.defaultBadge, { backgroundColor: isSelected ? "#FFFFFF" : "#0B6FAD" }]}>
                                <Text style={[styles.defaultBadgeText, { color: isSelected ? "#0B6FAD" : "#FFF" }]}>Default</Text>
                              </View>
                            )}
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <Pressable onPress={() => handleEditAddress(addr)} hitSlop={8}>
                              <Ionicons name="create-outline" size={18} color={isSelected ? "#FFFFFF" : "#0B6FAD"} />
                            </Pressable>
                            <Pressable onPress={() => handleDeleteAddress(addr)} hitSlop={12} style={{ padding: 4 }}>
                              <Ionicons name="trash-outline" size={18} color={isSelected ? "#FFBCBC" : "#EF4444"} />
                            </Pressable>
                          </View>
                        </View>

                        <Text style={[styles.addressText, { color: isSelected ? "rgba(255,255,255,0.9)" : colors.foreground, marginTop: 6 }]}>
                          {addr.address_line1}{addr.address_line2 ? `, ${addr.address_line2}` : ""}
                        </Text>
                        <Text style={[styles.addressText, { color: isSelected ? "rgba(255,255,255,0.9)" : colors.mutedForeground }]}>
                          {addr.city}, {addr.state} — {addr.postal_code}
                        </Text>
                        <Text style={[styles.addressText, { color: isSelected ? "#FFF" : colors.foreground, marginTop: 4, fontFamily: "Inter_600SemiBold" }]}>
                          📱 +91 {addr.phone}
                        </Text>

                        {/* FIX: Show live Shiprocket rate inline on selected card */}
                        {isSelected && (
                          <View style={styles.shippingBadgeRow}>
                            {shippingLoading ? (
                              <View style={styles.shippingBadge}>
                                <ActivityIndicator size="small" color="#0B6FAD" style={{ marginRight: 6 }} />
                                <Text style={styles.shippingBadgeText}>Calculating shipping...</Text>
                              </View>
                            ) : shiprocketRate?.source === "shiprocket" ? (
                              <View style={[styles.shippingBadge, { backgroundColor: "#E8F8F0", borderColor: "#10B981" }]}>
                                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                                <Text style={[styles.shippingBadgeText, { color: "#065F46" }]}>
                                  {shiprocketRate.courierName} • ₹{shiprocketRate.fee} • {shiprocketRate.estimatedDays}
                                </Text>
                              </View>
                            ) : (
                              <View style={[styles.shippingBadge, { backgroundColor: "#EFF6FF", borderColor: "#93C5FD" }]}>
                                <Ionicons name="car-outline" size={14} color="#3B82F6" />
                                <Text style={[styles.shippingBadgeText, { color: "#1D4ED8" }]}>
                                  Standard Delivery • ₹{fallbackShippingFee}
                                </Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Contact Details</Text>
              {[
                { label: "Full Name", value: name, setter: setName, placeholder: "Your full name", keyboard: "default" as const },
                { label: "Phone", value: phone, setter: setPhone, placeholder: "10-digit mobile number", keyboard: "phone-pad" as const },
              ].map((field) => (
                <View key={field.label} style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.input, { color: colors.foreground }]}
                      value={field.value}
                      onChangeText={field.setter}
                      placeholder={field.placeholder}
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType={field.keyboard}
                    />
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ── Payment Section — only visible when shipping is ready ── */}
          {isShippingReady && (
            <>
              <View style={styles.paymentSectionHeader}>
                <View style={[styles.stepCircle, { backgroundColor: "#0B6FAD", width: 24, height: 24, borderRadius: 12 }]}>
                  <Text style={[styles.stepNum, { color: "#FFF", fontSize: 13 }]}>3</Text>
                </View>
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 0, marginBottom: 0 }]}>Payment</Text>
              </View>

              <View style={[styles.paymentCard, { backgroundColor: "#EFF6FF", borderColor: "#0B6FAD" }]}>
                <View style={styles.paymentCardRow}>
                  <Ionicons name="card" size={22} color="#0B6FAD" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paymentText, { color: "#0B6FAD" }]}>Pay via Razorpay</Text>
                    <Text style={[styles.paymentSubText, { color: "#3B82F6" }]}>
                      UPI · Debit / Credit Card · Net Banking · Wallets
                    </Text>
                  </View>
                  <Ionicons name="lock-closed" size={16} color="#10B981" />
                </View>

                {/* Summary before pay */}
                <View style={[styles.paymentSummary, { borderTopColor: "#BFDBFE" }]}>
                  <View style={styles.paymentSummaryRow}>
                    <Text style={styles.paymentSummaryLabel}>Subtotal</Text>
                    <Text style={styles.paymentSummaryValue}>₹{taxable}</Text>
                  </View>
                  {taxAmount > 0 && (
                    <View style={styles.paymentSummaryRow}>
                      <Text style={styles.paymentSummaryLabel}>GST</Text>
                      <Text style={styles.paymentSummaryValue}>₹{taxAmount}</Text>
                    </View>
                  )}
                  {shippingFee > 0 && (
                    <View style={styles.paymentSummaryRow}>
                      <Text style={styles.paymentSummaryLabel}>Shipping</Text>
                      <Text style={styles.paymentSummaryValue}>₹{shippingFee}</Text>
                    </View>
                  )}
                  {discount > 0 && (
                    <View style={styles.paymentSummaryRow}>
                      <Text style={[styles.paymentSummaryLabel, { color: "#10B981" }]}>Discount</Text>
                      <Text style={[styles.paymentSummaryValue, { color: "#10B981" }]}>-₹{discount}</Text>
                    </View>
                  )}
                  <View style={[styles.paymentSummaryRow, styles.paymentTotalRow]}>
                    <Text style={styles.paymentTotalLabel}>You Pay</Text>
                    <Text style={styles.paymentTotalValue}>₹{finalTotal}</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* ── Hint when shipping not ready ── */}
          {!isShippingReady && hasPhysical && (
            <View style={[styles.shippingHintCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
              <Text style={[styles.shippingHintText, { color: colors.mutedForeground }]}>
                Select a shipping address above to proceed to payment
              </Text>
            </View>
          )}

        </ScrollView>

        {/* ── Bottom CTA — only show Slide to Pay when ready ── */}
        <View style={[styles.cta, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Platform.OS === "web" ? 20 : insets.bottom + 8 }]}>
          {isShippingReady ? (
            <SlideToPayButton amount={finalTotal} onSlideComplete={handlePay} loading={loading} />
          ) : (
            <View style={[styles.disabledPayBtn, { backgroundColor: colors.muted }]}>
              <Ionicons name="lock-closed" size={16} color={colors.mutedForeground} />
              <Text style={[styles.disabledPayBtnText, { color: colors.mutedForeground }]}>
                {hasPhysical ? "Select shipping address to pay" : "Fill contact details to pay"}
              </Text>
            </View>
          )}
          <Text style={[styles.secureNote, { color: colors.mutedForeground }]}>
            <Ionicons name="lock-closed" size={11} color={colors.mutedForeground} /> Secured by Razorpay · 100% Safe
          </Text>
        </View>
      </View>

      {/* ── Razorpay Payment WebView ── */}
      <RazorpayWebView
        visible={showPayment}
        params={razorpayParams}
        onSuccess={handlePaymentSuccess}
        onFailure={handlePaymentFailure}
        onDismiss={() => {
          setShowPayment(false);
          setRazorpayParams(null);
          setLoading(false);
        }}
      />

      {/* ── Add / Edit Address Modal ── */}
      <Modal visible={showAddressForm} transparent animationType="slide" onRequestClose={() => setShowAddressForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editingAddressId ? "Edit Address" : "Add New Address"}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {[
                  { label: "Full Name", value: formFullName, setter: setFormFullName, placeholder: "e.g. John Doe" },
                  { label: "Address Line 1", value: formAddressLine1, setter: setFormAddressLine1, placeholder: "Flat / House No / Street" },
                  { label: "Address Line 2 (Optional)", value: formAddressLine2, setter: setFormAddressLine2, placeholder: "Area / Landmark" },
                  { label: "City", value: formCity, setter: setFormCity, placeholder: "e.g. Mumbai" },
                  { label: "State", value: formState, setter: setFormState, placeholder: "e.g. Maharashtra" },
                ].map((field) => (
                  <View key={field.label} style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: colors.foreground }]}>{field.label}</Text>
                    <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.input, { color: colors.foreground }]}
                        value={field.value}
                        onChangeText={field.setter}
                        placeholder={field.placeholder}
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                  </View>
                ))}

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Pincode</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <TextInput
                      style={[styles.input, { color: colors.foreground }]}
                      value={formPostalCode}
                      onChangeText={(t) => setFormPostalCode(t.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6-digit pincode"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="numeric"
                      maxLength={6}
                    />
                  </View>
                  {formPostalCode.length > 0 && formPostalCode.length < 6 && (
                    <Text style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>
                      {6 - formPostalCode.length} more digits needed
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Phone</Text>
                  <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center" }]}>
                    <Text style={[styles.input, { color: colors.mutedForeground, marginRight: 4 }]}>+91</Text>
                    <TextInput
                      style={[styles.input, { flex: 1, color: colors.foreground }]}
                      value={formPhone.replace(/^\+91/, "")}
                      onChangeText={(t) => setFormPhone("+91" + t.replace(/\D/g, "").slice(0, 10))}
                      placeholder="10-digit number"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="phone-pad"
                      maxLength={10}
                    />
                  </View>
                </View>
              </ScrollView>
              <View style={styles.modalBtnRow}>
                <Pressable style={[styles.modalBtn, { backgroundColor: "#0B6FAD" }]} onPress={handleSaveAddress}>
                  <Text style={styles.modalBtnText}>Save Address</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                  onPress={() => { setShowAddressForm(false); resetAddressForm(); }}
                >
                  <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: "center", paddingHorizontal: 24, gap: 16 },
  backBtn: { alignSelf: "flex-start", marginBottom: 32 },
  emptyTitle: { fontSize: 20, fontFamily: "Fredoka_700Bold" },
  shopBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 24 },
  shopBtnText: { fontSize: 15, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  sectionTitle: { fontSize: 17, fontFamily: "Fredoka_700Bold", marginTop: 8, marginBottom: 10 },
  card: { borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 10, marginBottom: 4 },
  orderItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  itemThumbnail: { width: 48, height: 48, borderRadius: 8 },
  itemInfo: { flex: 1, gap: 2 },
  controlsContainer: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 8, paddingVertical: 2 },
  controlBtn: { padding: 4 },
  qtyText: { fontSize: 13, fontFamily: "Inter_600SemiBold", minWidth: 16, textAlign: "center" },
  orderItemName: { fontSize: 14, fontFamily: "Fredoka_600SemiBold", flex: 1 },
  orderItemPrice: { fontSize: 14, fontWeight: "800" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 12, borderTopWidth: 1.5, marginTop: 4 },
  totalLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  totalAmount: { fontSize: 18, fontWeight: "800" },
  fieldGroup: { gap: 6, marginBottom: 12 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  inputWrapper: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12 },
  input: { fontSize: 15, fontFamily: "Inter_400Regular" },
  cta: { padding: 16, borderTopWidth: 1 },
  secureNote: { textAlign: "center", fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 6 },
  promoRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 4 },
  promoBtn: { paddingHorizontal: 20, height: 48, borderRadius: 24, backgroundColor: "#0B6FAD", alignItems: "center", justifyContent: "center" },
  promoBtnText: { fontSize: 14, fontFamily: "Fredoka_600SemiBold", color: "#fff" },
  promoApplied: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, marginBottom: 4 },
  promoAppliedText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#0B6FAD" },
  promoError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 4, marginBottom: 8 },
  discountRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  discountLabel: { fontSize: 13, color: "#10B981", fontFamily: "Inter_600SemiBold" },
  discountAmount: { fontSize: 13, color: "#10B981", fontFamily: "Fredoka_700Bold" },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 10 },
  addAddrBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 6 },
  addAddrBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  // Address cards
  addressCard: { borderRadius: 14, marginBottom: 10, flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  addrSelectIcon: { paddingTop: 2 },
  addressCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  addressName: { fontSize: 15, fontFamily: "Fredoka_600SemiBold" },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  defaultBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  addressText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  shippingBadgeRow: { marginTop: 10 },
  shippingBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  shippingBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#065F46", flex: 1 },
  emptyAddressesCard: { borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", padding: 28, alignItems: "center", justifyContent: "center", marginBottom: 10, gap: 8 },
  emptyAddressesText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  addFirstAddrBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, marginTop: 4 },
  addFirstAddrBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  // Payment section
  paymentSectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 20, marginBottom: 10 },
  paymentCard: { borderRadius: 16, borderWidth: 2, padding: 16, marginBottom: 8 },
  paymentCardRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  paymentText: { fontSize: 15, fontFamily: "Fredoka_600SemiBold" },
  paymentSubText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  paymentSummary: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  paymentSummaryRow: { flexDirection: "row", justifyContent: "space-between" },
  paymentSummaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#64748B" },
  paymentSummaryValue: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#1E293B" },
  paymentTotalRow: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#BFDBFE" },
  paymentTotalLabel: { fontSize: 16, fontFamily: "Fredoka_700Bold", color: "#0B6FAD" },
  paymentTotalValue: { fontSize: 20, fontFamily: "Fredoka_700Bold", color: "#0B6FAD" },
  // Hint card
  shippingHintCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", padding: 16, marginTop: 12, marginBottom: 8 },
  shippingHintText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  // Disabled pay button
  disabledPayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: 28 },
  disabledPayBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { width: "100%", maxWidth: 400, maxHeight: "85%", borderRadius: 20, borderWidth: 1, padding: 24, gap: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  modalBtnRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  modalBtnText: { color: "#FFF", fontFamily: "Fredoka_600SemiBold", fontSize: 14 },
  // Step indicator
  stepIndicatorContainer: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#D6E9F2" },
  stepItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepCircle: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 11, fontFamily: "Fredoka_700Bold" },
  stepLabel: { fontSize: 12 },
  stepLine: { width: 32, height: 2, marginHorizontal: 8 },
  // Slide to pay
  slideTrack: { width: "100%", height: 56, borderRadius: 28, overflow: "hidden", justifyContent: "center" },
  slideThumb: { position: "absolute", left: 4, width: 48, height: 48, borderRadius: 24, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  slideLabel: { textAlign: "center", fontSize: 15, fontFamily: "Fredoka_600SemiBold", color: "#FFF", letterSpacing: 0.5 },
  addAddressBadge: { backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#BFDBFE", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  addAddressBadgeText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#1D4ED8" },
});
