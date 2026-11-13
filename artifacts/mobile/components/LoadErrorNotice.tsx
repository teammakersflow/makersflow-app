import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

/**
 * Shown when course data could not be loaded (offline, timeout, API error).
 * - "card": nothing could be shown (replaces a misleading empty state).
 * - "banner": saved data is still shown above/below it.
 * Retry reloads the relevant data. Uses the existing MakersFlow colours.
 */
export function LoadErrorNotice({
  message,
  onRetry,
  variant = "banner",
  retrying = false,
}: {
  message: string;
  onRetry: () => void;
  variant?: "banner" | "card";
  retrying?: boolean;
}) {
  const colors = useColors();
  const isCard = variant === "card";
  return (
    <View
      accessibilityRole="alert"
      style={[
        isCard ? styles.card : styles.banner,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Ionicons
        name="cloud-offline-outline"
        size={isCard ? 28 : 16}
        color={colors.mutedForeground}
        style={isCard ? { marginBottom: 8 } : undefined}
      />
      <Text
        style={[
          isCard ? styles.cardText : styles.bannerText,
          { color: colors.mutedForeground },
        ]}
      >
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={[styles.retry, isCard && styles.retryCard, { borderColor: colors.primary }]}
      >
        {retrying ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  card: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  cardText: { fontSize: 14, textAlign: "center", fontFamily: "Inter_400Regular", marginBottom: 12 },
  retry: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 64,
    alignItems: "center",
  },
  retryCard: { paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
