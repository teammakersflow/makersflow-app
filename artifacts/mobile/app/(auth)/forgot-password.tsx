import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    
    setError("");
    setLoading(true);
    
    const result = await resetPassword(email);
    setLoading(false);
    
    if (result.success) {
      setSent(true);
    } else {
      setError(result.error || "Failed to send reset link. Please try again.");
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <Pressable onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(auth)/login");
          }
        }} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        <View style={[styles.iconBox, { backgroundColor: colors.accent }]}>
          <Feather name="mail" size={32} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>Reset Password</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Enter your email address and we'll send you a link to reset your password.
        </Text>

        {sent ? (
          <View style={[styles.successBox, { backgroundColor: "#DCFCE7" }]}>
            <Feather name="check-circle" size={18} color="#16A34A" />
            <Text style={styles.successText}>Password reset email sent! Check your inbox.</Text>
          </View>
        ) : (
          <View style={styles.form}>
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="alert-circle" size={14} color="#DC2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="mail" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: pressed || !email ? 0.8 : 1 }]}
              onPress={handleReset}
              disabled={loading || !email}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Send Reset Link</Text>}
            </Pressable>
          </View>
        )}

        <Pressable onPress={() => router.push("/(auth)/login")} style={styles.backToLogin}>
          <Text style={[styles.backToLoginText, { color: colors.primary }]}>Back to Login</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 32, width: 40 },
  iconBox: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: { fontSize: 26, fontWeight: "800", marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 28 },
  form: { gap: 16 },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 15 },
  btn: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  btnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  successBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderRadius: 12,
  },
  successText: { fontSize: 14, color: "#16A34A", flex: 1 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  errorText: { fontSize: 13, color: "#DC2626", flex: 1 },
  backToLogin: { alignItems: "center", marginTop: 28 },
  backToLoginText: { fontSize: 15, fontWeight: "600" },
});
