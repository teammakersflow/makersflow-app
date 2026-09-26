 import React, { useRef } from "react";
import {
  Modal,
  View,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Text,
  Platform,
  SafeAreaView,
  Image,
} from "react-native";
import { WebView, WebViewMessageEvent, WebViewProps } from "react-native-webview";

const LOCAL_BRAND_ICON =
  Image.resolveAssetSource(require("@/assets/images/logos/icon.png"))?.uri ||
  "https://makersflow.in/makersflow-logo-dark.png";

// react-native-webview's class-component typings collapse to `never` under
// React 19's stricter types. Alias with explicit props so TS type-checks the
// props we pass while runtime behavior is unchanged.
const RNWebView = WebView as unknown as React.ComponentType<
  WebViewProps & { ref?: React.Ref<WebView> }
>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type RazorpayPaymentParams = {
  orderId: string;
  amount: number;      // in paise
  currency: string;
  keyId: string;
  name: string;        // customer name
  email: string;
  phone: string;
  description: string;
};

type Props = {
  visible: boolean;
  params: RazorpayPaymentParams | null;
  onSuccess: (paymentId: string, orderId: string, signature: string) => void;
  onFailure: (reason: string) => void;
  onDismiss: () => void;
};

// ─── Build HTML ───────────────────────────────────────────────────────────────

function buildRazorpayHTML(p: RazorpayPaymentParams): string {
  const safeName = p.name.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const safeEmail = p.email.replace(/"/g, '\\"');
  const safePhone = p.phone.replace(/\s/g, "").replace(/^\+91/, "");
  const safeDesc = p.description.replace(/"/g, '\\"');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <title>MakersFlow Payment</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#f5f5f5;
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;
    }
    .loader{text-align:center;padding:40px 20px;}
    .ring{
      width:52px;height:52px;
      border:4px solid #e5e7eb;
      border-top-color:#4F46E5;
      border-radius:50%;
      animation:spin 0.8s linear infinite;
      margin:0 auto 20px;
    }
    @keyframes spin{to{transform:rotate(360deg);}}
    h3{font-size:16px;color:#111827;margin-bottom:8px;}
    p{font-size:13px;color:#6b7280;line-height:1.5;}
    .amount{font-size:22px;font-weight:700;color:#4F46E5;margin:12px 0;}
    .lock{font-size:11px;color:#9ca3af;margin-top:16px;}
  </style>
</head>
<body>
  <div class="loader">
    <div class="ring"></div>
    <h3>Opening Secure Payment</h3>
    <div class="amount">₹${Math.round(p.amount / 100).toLocaleString("en-IN")}</div>
    <p>Powered by Razorpay</p>
    <p class="lock">🔒 Your payment information is encrypted</p>
  </div>

  <script>
    var rzpOptions = {
      key:         "${p.keyId}",
      amount:      ${p.amount},
      currency:    "${p.currency}",
      order_id:    "${p.orderId}",
      name:        "MakersFlow",
      description: "${safeDesc}",
      image:       "${LOCAL_BRAND_ICON}",
      prefill: {
        name:    "${safeName}",
        email:   "${safeEmail}",
        contact: "${safePhone}",
      },
      theme: {
        color: "#4F46E5",
        hide_topbar: false,
      },
      modal: {
        backdropclose: false,
        escape:        false,
        animation:     true,
        ondismiss: function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:   "payment_dismissed",
            reason: "User closed the payment window",
          }));
        },
      },
      handler: function(response) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type:      "payment_success",
          paymentId: response.razorpay_payment_id,
          orderId:   response.razorpay_order_id,
          signature: response.razorpay_signature,
        }));
      },
    };

    var rzp = new Razorpay(rzpOptions);

    rzp.on("payment.failed", function(response) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type:   "payment_failed",
        reason: response.error.description || "Payment failed",
        code:   response.error.code || "",
      }));
    });

    // Auto-open after small delay so the page renders first
    setTimeout(function() {
      try { rzp.open(); }
      catch(e) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type:   "payment_failed",
          reason: "Could not open payment window: " + e.message,
        }));
      }
    }, 500);
  </script>
</body>
</html>`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RazorpayWebView({
  visible,
  params,
  onSuccess,
  onFailure,
  onDismiss,
}: Props) {
  const webViewRef = useRef<WebView>(null);

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "payment_success") {
        onSuccess(data.paymentId, data.orderId, data.signature);
      } else if (data.type === "payment_failed") {
        onFailure(data.reason ?? "Payment was not completed");
      } else if (data.type === "payment_dismissed") {
        onDismiss();
      }
    } catch (e) {
      console.warn("[RazorpayWebView] Could not parse message:", event.nativeEvent.data);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onDismiss}
    >
      <SafeAreaView style={styles.container}>
        {/* Header bar */}
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Secure Checkout</Text>
            <Text style={styles.headerSub}>🔒 Powered by Razorpay</Text>
          </View>
          <Pressable onPress={onDismiss} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* WebView */}
        {params ? (
          <RNWebView
            ref={webViewRef}
            source={{ html: buildRazorpayHTML(params) }}
            onMessage={handleMessage}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#4F46E5" />
                <Text style={styles.loadingText}>Connecting to payment…</Text>
              </View>
            )}
            style={styles.webview}
            originWhitelist={["*"]}
            mixedContentMode="always"
            allowsInlineMediaPlayback
            userAgent={
              Platform.OS === "android"
                ? "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36"
                : undefined
            }
          />
        ) : (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingText}>Preparing payment…</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  headerLeft: { width: 36 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  headerSub: { fontSize: 11, color: "#6b7280", marginTop: 1 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontSize: 14, color: "#6b7280", fontWeight: "700" },
  webview: { flex: 1 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
});