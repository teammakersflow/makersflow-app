import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useRef, useState, useEffect, useCallback } from "react";
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, ActivityIndicator, Modal, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import {
  buildInvoiceHtml,
  generateInvoiceNumber,
  fetchSellerSettings,
  type InvoiceLineItem,
} from "@/lib/invoiceUtils";


import { orderService } from "@/services/orderService";

// ── Order Tracking Timeline ───────────────────────────────────────────────────
const TRACKING_STEPS = [
  { key: "pending",   label: "Order Placed",      icon: "receipt-outline" },
  { key: "paid",      label: "Payment Confirmed", icon: "card-outline" },
  { key: "packed",    label: "Packed",            icon: "cube-outline" },
  { key: "shipped",         label: "Shipped",            icon: "airplane-outline" },
  { key: "out_for_delivery",  label: "Out for Delivery",   icon: "bicycle-outline" },
  { key: "delivered",         label: "Delivered",          icon: "checkmark-circle-outline" },
];

// Map various status strings to our step keys
function normalizeStatus(raw: string | undefined): string {
  const s = (raw ?? "").toLowerCase().replace(/ /g, "_");
  // Match exact admin statuses: pending, paid, packed, shipped, delivered, completed, cancelled, refund_requested
  if (s === "delivered" || s === "completed") return "delivered";
  if (s === "out_for_delivery" || s === "out for delivery") return "out_for_delivery";
  if (s === "shipped") return "shipped";
  if (s === "packed") return "packed";
  if (s === "paid") return "paid";
  if (s.includes("refund") || s === "cancelled" || s === "failed") return "cancelled";
  return "pending";
}

function OrderTrackingTimeline({ status, trackingNumber }: { status?: string; trackingNumber?: string | null }) {
  const colors = useColors();
  const normalized = normalizeStatus(status);

  // Don't show timeline for cancelled/refund orders
  if (normalized === "cancelled") return null;

  const currentIdx = TRACKING_STEPS.findIndex((s) => s.key === normalized);
  const activeIdx = currentIdx === -1 ? 0 : currentIdx;

  return (
    <View style={{ marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 12 }}>
        📦 Order Tracking
      </Text>
      {TRACKING_STEPS.map((step, idx) => {
        const isDone = idx <= activeIdx;
        const isCurrent = idx === activeIdx;
        const isLast = idx === TRACKING_STEPS.length - 1;
        return (
          <View key={step.key} style={{ flexDirection: "row", alignItems: "flex-start" }}>
            {/* Left column: icon + line */}
            <View style={{ alignItems: "center", width: 32 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: isDone ? "#0B6FAD" : colors.muted,
                alignItems: "center", justifyContent: "center",
                borderWidth: isCurrent ? 2.5 : 0,
                borderColor: isCurrent ? "#17E5D3" : "transparent",
              }}>
                <Ionicons
                  name={step.icon as any}
                  size={14}
                  color={isDone ? "#FFF" : "#9CA3AF"}
                />
              </View>
              {!isLast && (
                <View style={{
                  width: 2, flex: 1, minHeight: 20,
                  backgroundColor: idx < activeIdx ? "#0B6FAD" : colors.border,
                  marginVertical: 2,
                }} />
              )}
            </View>
            {/* Right column: label */}
            <View style={{ flex: 1, paddingLeft: 10, paddingBottom: isLast ? 0 : 16, paddingTop: 4 }}>
              <Text style={{
                fontSize: 13,
                fontFamily: isCurrent ? "Inter_700Bold" : "Inter_400Regular",
                color: isDone ? colors.foreground : colors.mutedForeground,
              }}>
                {step.label}
              </Text>
              {isCurrent && (
                <Text style={{ fontSize: 11, color: "#0B6FAD", fontFamily: "Inter_400Regular", marginTop: 2 }}>
                  Current status
                </Text>
              )}
              {isCurrent && (step.key === "shipped" || step.key === "out_for_delivery") && trackingNumber && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4,
                  backgroundColor: "#EEF7FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" }}>
                  <Ionicons name="locate-outline" size={12} color="#0B6FAD" />
                  <Text style={{ fontSize: 11, color: "#0B6FAD", fontFamily: "Inter_600SemiBold" }}>
                    Tracking: {trackingNumber}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id: filterOrderId } = useLocalSearchParams<{ id?: string }>();
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [sharingId, setSharingId] = useState<string | null>(null);

  // Refund Modal States
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const loadOrders = useCallback(async (isRefreshing = false) => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }
    if (!isRefreshing && !hasLoadedOnce.current) setIsLoading(true);
    try {
      const data = await orderService.getMyOrders();

      if (data) {
        const mapped = data.map((order: any) => {
          let itemsList: any[] = [];
          try {
            itemsList = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
          } catch (e) {
            itemsList = Array.isArray(order.items) ? order.items : [];
          }
          const dateObj = new Date(order.created_at);
          const dateStr = dateObj.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }) + ", " + dateObj.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "numeric",
            hour12: true,
          });
          return {
            id: String(order.id),
            date: dateStr,
            status: order.status === 'refund_requested' ? 'Refund Requested' :
                    order.status ? (order.status.charAt(0).toUpperCase() + order.status.slice(1)) : 'Processing',
            rawStatus: order.status,
            tracking_number: order.tracking_number ?? null,
            items: itemsList.map((i: any) => i.title || "Untitled Product"),
            total: Number(order.total_amount) || 0,
            tax: Number(order.tax_amount) || 0,
            shipping: order.shipping_address ?? null,
            created_at: order.created_at,
            total_amount: Number(order.total_amount) || 0,
          };
        });
        setOrders(mapped);
      }
    } catch (err) {
      console.error('[Orders] Load error:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) {
        loadOrders(false);
      } else {
        loadOrders(true);
      }
    }, [loadOrders])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders(true);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const submitRefundRequest = async () => {
    if (!refundReason.trim()) {
      Alert.alert('Validation Error', 'Reason cannot be blank.');
      return;
    }
    if (!user?.id || !refundOrderId) return;

    setIsSubmittingRefund(true);
    try {
      await orderService.requestRefund(refundOrderId, refundReason.trim());

      Alert.alert('Submitted', 'Your refund request has been submitted. Our team will review it shortly.');
      
      setOrders(prev => prev.map(o => o.id === refundOrderId ? { ...o, status: 'Refund Requested', rawStatus: 'refund_requested' } : o));
      
      setShowRefundModal(false);
      setRefundReason("");
      setRefundOrderId(null);
    } catch (e: any) {
      console.error('[Refund] Error:', e);
      Alert.alert('Error', e.message || 'Failed to submit refund request. Please try again.');
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const generateInvoice = async (order: any) => {
    setSharingId(order.id);
    try {
      let buyerName = 'Valued Customer';
      let buyerPhone = '';
      let buyerGstin: string | undefined;

      if (user) {
        buyerName = user.name || buyerName;
        buyerPhone = user.phone || '';
      }

      // Resolve shipping address — stored as JSON object in order.shipping
      const addr = order.shipping;
      const billingAddress = {
        name: addr?.name || buyerName,
        line1: addr?.address || '',
        city: addr?.city || '',
        state: addr?.state || 'Andhra Pradesh',
        pincode: addr?.pincode || '',
        phone: addr?.phone || buyerPhone || undefined,
        gstin: buyerGstin,
      };

      // Rebuild line items from order.items (array of title strings)
      // orders table only stores titles, so we reconstruct best-effort items
      const rawItems: string[] = order.items && order.items.length > 0
        ? order.items
        : ['Course/Product Purchase'];

      const perItemTotal = order.total / rawItems.length;
      const invoiceItems: InvoiceLineItem[] = rawItems.map((title: string) => ({
        description: title,
        // Heuristic: titles containing 'kit' or 'board' are physical
        hsnSac: /kit|board|module|sensor|component/i.test(title) ? '84733099' : '999294',
        isService: !/kit|board|module|sensor|component/i.test(title),
        quantity: 1,
        unitPrice: parseFloat(perItemTotal.toFixed(2)),
        discountAmount: 0,
        gstRate: 18,
      }));

      const seller = await fetchSellerSettings();
      const invoiceNumber = await generateInvoiceNumber();

      const html = buildInvoiceHtml(
        {
          invoiceNumber,
          invoiceDate: new Date(order.created_at),
          paymentId: order.id,
          items: invoiceItems,
          billingAddress,
          shippingAddress: addr ? billingAddress : undefined,
          shippingFee: 0,
          totalDiscount: 0,
        },
        seller
      );

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch (e) {
      console.error('[Invoice] Error generating invoice:', e);
      Alert.alert('Error', 'Failed to generate or share invoice.');
    } finally {
      setSharingId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#0B6FAD" />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Loading...</Text>
      </View>
    );
  }

  const getStatusStyle = (status: string) => {
    const s = status.toLowerCase();
    if (s === "paid") {
      return { bg: "#E8F4F9", text: "#0B6FAD" };
    }
    if (s === "completed" || s === "delivered") {
      return { bg: "#DCF7F4", text: "#10B981" };
    }
    if (s === "failed" || s === "refunded" || s === "refund requested" || s === "refund_requested") {
      return { bg: "#FEE2E2", text: "#DC2626" };
    }
    return { bg: "#FEF3C7", text: "#D97706" };
  };

  const filteredOrders = filterOrderId
    ? orders.filter(o => o.id === filterOrderId)
    : orders;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>My Orders</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#0B6FAD']}
          />
        }
      >
        {filterOrderId && (
          <View style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            padding: 12,
            backgroundColor: colors.muted,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: 16,
            gap: 10,
          }}>
            <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: "Inter_600SemiBold", flex: 1 }}>
              Showing details for Order #{filterOrderId.toUpperCase()}
            </Text>
            <Pressable onPress={() => router.setParams({ id: undefined })}>
              <Text style={{ fontSize: 13, color: "#0B6FAD", fontFamily: "Inter_700Bold", textDecorationLine: "underline" }}>
                Show All
              </Text>
            </Pressable>
          </View>
        )}

        {filteredOrders.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="cube" size={40} color="#0B6FAD" />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {filterOrderId ? "Order not found" : "No orders yet"}
            </Text>
          </View>
        ) : (
          filteredOrders.map((order) => {
            const statusStyle = getStatusStyle(order.status);
            return (
              <View key={order.id} style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: statusStyle.bg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        { color: statusStyle.text },
                      ]}
                    >
                      {order.status}
                    </Text>
                  </View>
                  <Text style={[styles.date, { color: colors.mutedForeground }]}>{order.date}</Text>
                </View>
                <Text style={[styles.orderId, { color: colors.mutedForeground }]}>Order #{order.id.toUpperCase()}</Text>
                {order.items.map((item: string, i: number) => (
                  <Text key={i} style={[styles.item, { color: colors.foreground }]}>
                    · {item}
                  </Text>
                ))}
                <View style={[styles.totalRow, { borderTopColor: "#D6E9F2" }]}>
                  <Text style={[styles.totalLabel, { color: colors.mutedForeground }]}>Total Paid</Text>
                  <Text style={[styles.totalAmount, { color: "#EF4444" }]}>₹{order.total}</Text>
                </View>
                {order.tax > 0 && (
                  <Text style={[styles.date, { color: colors.mutedForeground, marginTop: 4 }]}>
                    Includes GST: ₹{order.tax}
                  </Text>
                )}
                {order.shipping?.address && (
                  <View style={{ marginTop: 6, gap: 2 }}>
                    <Text style={[styles.date, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                      Ship to: {order.shipping.name}
                    </Text>
                    <Text style={[styles.date, { color: colors.mutedForeground }]}>
                      {order.shipping.address}{order.shipping.city ? `, ${order.shipping.city}` : ""}
                    </Text>
                    {order.shipping.phone && (
                      <Text style={[styles.date, { color: colors.mutedForeground }]}>
                        {order.shipping.phone}
                      </Text>
                    )}
                    {/* Order Tracking Timeline */}
                    <OrderTrackingTimeline status={order.rawStatus} trackingNumber={order.tracking_number} />
                  </View>
                )}
                
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.invoiceBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                    onPress={() => generateInvoice(order)}
                    disabled={sharingId === order.id}
                  >
                    <Ionicons name="download" size={14} color="#0B6FAD" />
                    <Text style={[styles.invoiceBtnText, { color: "#0B6FAD" }]}>
                      {sharingId === order.id ? 'Generating...' : 'Invoice'}
                    </Text>
                  </Pressable>
                  
                  {(order.rawStatus === 'completed' || order.rawStatus === 'failed') && (
                    <Pressable
                      style={[styles.refundBtn, { borderColor: '#FEE2E2', backgroundColor: '#FEF2F2' }]}
                      onPress={() => {
                        setRefundOrderId(order.id);
                        setRefundReason("");
                        setShowRefundModal(true);
                      }}
                    >
                      <Ionicons name="refresh" size={14} color="#DC2626" />
                      <Text style={[styles.refundBtnText]}>Refund</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Refund Request Modal */}
      <Modal
        visible={showRefundModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingRefund) {
            setShowRefundModal(false);
            setRefundReason("");
            setRefundOrderId(null);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Request Refund</Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              Please describe your reason for requesting a refund (max 200 characters).
            </Text>
            <TextInput
              style={[styles.textArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              multiline
              numberOfLines={4}
              value={refundReason}
              onChangeText={(text) => {
                if (text.length <= 200) {
                  setRefundReason(text);
                }
              }}
              placeholder="Enter reason here..."
              placeholderTextColor={colors.mutedForeground}
            />
            <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
              {refundReason.trim().length}/200
            </Text>

            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: "#0B6FAD" }]}
                onPress={submitRefundRequest}
                disabled={isSubmittingRefund}
              >
                {isSubmittingRefund ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.modalBtnText}>Submit</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.modalBtn, { backgroundColor: colors.muted }]}
                onPress={() => {
                  setShowRefundModal(false);
                  setRefundReason("");
                  setRefundOrderId(null);
                }}
                disabled={isSubmittingRefund}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#DCF7F4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  orderCard: { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 14, gap: 8 },
  orderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  date: { fontSize: 12, fontFamily: "Inter_400Regular" },
  item: { fontSize: 14, fontFamily: "Fredoka_600SemiBold" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1.5, marginTop: 4 },
  totalLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  totalAmount: { fontSize: 16, fontFamily: "Fredoka_700Bold" },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  invoiceBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5 },
  invoiceBtnText: { fontSize: 13, fontFamily: 'Fredoka_600SemiBold' },
  refundBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5 },
  refundBtnText: { fontSize: 13, fontFamily: 'Fredoka_600SemiBold', color: '#DC2626' },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
  textArea: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    height: 100,
    textAlignVertical: "top",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  charCount: {
    alignSelf: "flex-end",
    fontSize: 11,
    marginTop: -8,
    fontFamily: "Inter_400Regular",
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnText: {
    color: "#FFF",
    fontFamily: "Fredoka_600SemiBold",
    fontSize: 14,
  },
});


