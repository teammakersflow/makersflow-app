import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function ResetPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { updatePassword } = useAuth();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    setError("");

    if (!password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await updatePassword(password);
    setLoading(false);

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Success",
        "Your password has been reset successfully. Please log in with your new password.",
        [{ text: "OK", onPress: () => router.replace("/(auth)/login") }]
      );
    } else {
      setError(result.error || "Failed to reset password. Please try again.");
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        <View style={[styles.iconBox, { backgroundColor: colors.accent }]}>
          <Feather name="lock" size={32} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>New Password</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Please enter your new password below.
        </Text>

        <View style={styles.form}>
          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="alert-circle" size={14} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Password Input */}
          <Text style={[styles.label, { color: colors.foreground }]}>New Password</Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="lock" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Min 6 characters"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
              <Feather name={showPassword ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Confirm Password Input */}
          <Text style={[styles.label, { color: colors.foreground }]}>Confirm Password</Text>
          <View style={[styles.inputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="lock" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showConfirmPassword}
              autoCapitalize="none"
            />
            <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} hitSlop={8}>
              <Feather name={showConfirmPassword ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 }]}
            onPress={handleReset}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Reset Password</Text>}
          </Pressable>
        </View>
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
  form: { gap: 12 },
  label: { fontSize: 14, fontWeight: "600", marginTop: 4 },
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
  btn: { paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 12 },
  btnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, marginBottom: 8 },
  errorText: { fontSize: 13, color: "#DC2626", flex: 1 },
});
