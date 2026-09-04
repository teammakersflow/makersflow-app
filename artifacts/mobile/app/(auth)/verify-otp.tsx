import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { TEXT_STYLES } from "@/constants/typography";

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:         "#F4FAFD",
  card:       "#FFFFFF",
  border:     "#D6E9F2",
  primary:    "#0B6FAD",
  pressed:    "#085380",
  muted:      "#F0F4F8",
  mutedText:  "#5A7A8C",
  darkText:   "#0F2A3D",
  accentBg:   "#DCF7F4",
  accentText: "#063B4F",
  error:      "#DC2626",
  errorBg:    "#FEE2E2",
};

export default function VerifyOtpScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { phone, provider } = useLocalSearchParams<{ phone: string; provider?: string }>();
  const { verifyOtp, sendOtp, verifyWhatsappOtp, sendWhatsappOtp } = useAuth();
  const isWhatsapp = provider === "whatsapp";

  // ── All existing state — untouched ─────────────────────────────────────────
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCountdown, setResendCountdown] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // ── All existing logic — untouched ─────────────────────────────────────────
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => {
        setResendCountdown(resendCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendCountdown]);

  async function handleVerify() {
    if (otpCode.length !== 6) return;
    setError("");
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = isWhatsapp
      ? await verifyWhatsappOtp(phone!, otpCode)
      : await verifyOtp(phone!, otpCode);
    setLoading(false);
    if (result.success) {
      router.replace("/(tabs)");
    } else {
      setError("Invalid code. Please try again.");
    }
  }

  async function handleResend() {
    if (!canResend) return;
    setError("");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = isWhatsapp ? await sendWhatsappOtp(phone!) : await sendOtp(phone!);
    if (result.success) {
      setResendCountdown(30);
      setCanResend(false);
    } else {
      setError(result.error || "Failed to resend OTP. Please try again.");
    }
  }

  // ── OTP display helpers ────────────────────────────────────────────────────
  const otpArray = otpCode.split("");
  const inputs   = Array(6).fill(0);

  const isReady = otpCode.length === 6;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingTop:    insets.top    + 20,
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        {/* Back button — white circle with filled arrow-back */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </Pressable>

        {/* Icon box — pale aqua rounded square with filled phone icon */}
        <View style={styles.iconBox}>
          <Ionicons name="phone-portrait" size={32} color={colors.primary} />
        </View>

        {/* Heading */}
        <Text style={[TEXT_STYLES.pageTitle, styles.title, { color: colors.foreground }]}>
          Verify your number
        </Text>

        {/* Subtitle */}
        <Text style={[styles.subtitle]}>
          Enter the 6-digit code sent to{" "}
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
            {phone}
          </Text>
        </Text>

        <View style={styles.form}>
          {/* Error banner */}
          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={15} color={colors.destructive} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* OTP 6-box row */}
          <Pressable onPress={() => inputRef.current?.focus()} style={styles.otpRow}>
            {inputs.map((_, idx) => {
              const digit    = otpArray[idx] || "";
              const isFocused = idx === otpArray.length && otpArray.length < 6;
              const isFilled  = idx < otpArray.length;
              const isActive  = isFocused || isFilled;

              return (
                <View
                  key={idx}
                  style={[
                    styles.otpBox,
                    {
                      backgroundColor: isFilled ? "#F0F9FF" : colors.card,
                      borderColor: isActive ? colors.primary : colors.border,
                      borderWidth: isActive ? 2 : 1.5,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.otpDigit,
                      { color: isFilled ? colors.primary : colors.mutedForeground },
                    ]}
                  >
                    {digit}
                  </Text>
                </View>
              );
            })}

            {/* Hidden native input — captures keyboard; all logic untouched */}
            <TextInput
              ref={inputRef}
              style={styles.hiddenInput}
              value={otpCode}
              onChangeText={(text) => {
                setOtpCode(text.replace(/[^0-9]/g, ""));
                setError("");
              }}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
          </Pressable>

          {/* Verify button — XL pill: h56, borderRadius 28, fontSize 17 */}
          <Pressable
            style={({ pressed }) => [
              styles.verifyBtn,
              {
                backgroundColor: isReady
                  ? pressed ? colors.primaryPressed : colors.primary
                  : colors.muted,
                opacity: loading ? 0.9 : 1,
              },
            ]}
            onPress={handleVerify}
            disabled={loading || !isReady}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnContent}>
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={isReady ? "#FFF" : colors.mutedForeground}
                  style={{ marginRight: 8 }}
                />
                <Text
                  style={[
                    styles.verifyBtnText,
                    { color: isReady ? "#FFF" : colors.mutedForeground },
                  ]}
                >
                  Verify &amp; Continue
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={isReady ? "#FFF" : colors.mutedForeground}
                  style={{ marginLeft: 8 }}
                />
              </View>
            )}
          </Pressable>

          {/* Resend — gray while counting, Deep Sea when active */}
          <View style={styles.resendRow}>
            <Text style={styles.resendLabel}>Didn't receive a code? </Text>
            <Pressable onPress={handleResend} disabled={!canResend}>
              <Text
                style={[
                  styles.resendLink,
                  { color: canResend ? colors.primary : colors.mutedForeground },
                ]}
              >
                {canResend ? "Resend code" : `Resend in ${resendCountdown}s`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },

  // Back button — white circle
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },

  // Icon area — pale aqua rounded square
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#DCF7F4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },

  // Heading — Fredoka_700Bold via TEXT_STYLES.pageTitle
  title: {
    color: "#0F2A3D",
    marginBottom: 8,
  },

  // Subtitle — Inter_400Regular, muted
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
    color: "#6B7280",
    marginBottom: 32,
  },

  form: {
    gap: 24,
  },

  // Error banner
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#DC2626",
    flex: 1,
  },

  // OTP row
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    position: "relative",
    height: 64,
  },

  // Individual OTP box — rounded-xl (12px) white square
  otpBox: {
    width: "14%",
    height: 60,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  // Digit — Fredoka_700Bold, 24px
  otpDigit: {
    fontSize: 24,
    fontFamily: "Fredoka_700Bold",
    textAlign: "center",
  },

  // Invisible TextInput that drives all input logic
  hiddenInput: {
    position: "absolute",
    width: "100%",
    height: "100%",
    opacity: 0,
  },

  // Verify button — XL spec: h56, borderRadius 28
  verifyBtn: {
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyBtnText: {
    fontSize: 17,
    fontFamily: "Fredoka_600SemiBold",
  },

  // Resend row
  resendRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 4,
  },
  resendLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7280",
  },
  resendLink: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
