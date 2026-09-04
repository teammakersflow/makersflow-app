import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function SecurityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, resetPassword } = useAuth() as any;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [sending, setSending] = useState(false);

  // ── Change Password ───────────────────────────────────────────────────────
  async function handleChangePassword() {
    if (!user?.email) {
      Alert.alert("Error", "Could not find your email address.");
      return;
    }
    Alert.alert(
      "Change Password",
      `We will send a password reset link to:\n\n${user.email}\n\nCheck your inbox after confirming.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send Reset Link",
          onPress: async () => {
            setSending(true);
            try {
              const result = await resetPassword(user.email!);
              if (result.success) {
                Alert.alert(
                  "✅ Email Sent",
                  `Password reset link sent to ${user.email}. Check your inbox (and spam folder).`
                );
              } else {
                Alert.alert("Error", result.error || "Failed to send reset email. Please try again.");
              }
            } catch (e: any) {
              Alert.alert("Error", e.message || "Something went wrong.");
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Security</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Change Password */}
        <Pressable
          style={[styles.changePasswordBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: sending ? 0.6 : 1 }]}
          onPress={handleChangePassword}
          disabled={sending}
        >
          <Ionicons name="lock-closed" size={18} color="#0B6FAD" />
          <Text style={[styles.changePasswordText, { color: colors.foreground }]}>Change Password</Text>
          <Ionicons name="chevron-forward" size={18} color="#0B6FAD" />
        </Pressable>

        {/* Info box */}
        <View style={[styles.infoBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Ionicons name="information-circle" size={16} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            To change your password, we'll email you a secure reset link. The link expires after a short time for your security.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  changePasswordBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 1.5,
  },
  changePasswordText: { flex: 1, fontSize: 15, fontFamily: "Fredoka_600SemiBold" },
  infoBox: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 12, borderWidth: 1,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
