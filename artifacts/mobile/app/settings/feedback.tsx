import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/auth/apiClient";

export default function FeedbackScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  async function handleSubmit() {
    setError("");
    if (rating === 0) {
      setError("Please select a star rating.");
      return;
    }
    if (!message.trim()) {
      setError("Please describe your experience in the message field.");
      return;
    }
    if (!user?.id) {
      setError("You must be signed in to submit feedback.");
      return;
    }

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    let backendSuccess = false;
    try {
      await apiRequest("/feedback", {
        method: "POST",
        body: JSON.stringify({
          rating,
          message: message.trim() || undefined,
        }),
      });
      backendSuccess = true;
    } catch (err: any) {
      console.warn("[Feedback] Backend submission failed, trying Supabase fallback:", err?.message || err);
    }

    if (!backendSuccess) {
      const { error: dbError } = await supabase.from("feedback").insert({
        user_id: user.id,
        rating,
        message: message.trim() || null,
      });

      if (dbError) {
        setLoading(false);
        setError("Failed to submit feedback. Please try again.");
        return;
      }
    }

    setLoading(false);

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Feedback</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.successContainer}>
          <View style={[styles.successIconWrap, { backgroundColor: "#DCF7F4" }]}>
            <Ionicons name="checkmark-circle" size={48} color="#0B6FAD" />
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>Thank you!</Text>
          <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
            Your feedback helps us improve EDODWAJA for everyone.
          </Text>
          <Pressable
            style={[styles.doneBtn, { backgroundColor: "#0B6FAD" }]}
            onPress={() => router.back()}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Feedback</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>How would you rate your experience?</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  key={star}
                  onPress={async () => {
                    setRating(star);
                    setError("");
                    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={styles.starBtn}
                >
                  <Ionicons
                    name={star <= rating ? "star" : "star-outline"}
                    size={36}
                    color={star <= rating ? "#0B6FAD" : "#D6E9F2"}
                  />
                </Pressable>
              ))}
            </View>

            {rating > 0 && (
              <Text style={[styles.ratingLabel, { color: colors.mutedForeground }]}>
                {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][rating]}
              </Text>
            )}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
              Tell us more
            </Text>
            <TextInput
              style={[styles.textArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              value={message}
              onChangeText={setMessage}
              placeholder="What did you like or what can we improve?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              maxLength={500}
            />
            <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
              {message.length}/500
            </Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={14} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.submitBtn, { backgroundColor: "#0B6FAD", opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitBtnText}>Submit Feedback</Text>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
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
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  content: { padding: 20, gap: 16 },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    gap: 14,
  },
  sectionLabel: { fontSize: 15, fontFamily: "Fredoka_600SemiBold" },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
  starBtn: { padding: 4 },
  ratingLabel: { textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: -4 },
  textArea: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 120,
  },
  charCount: { fontSize: 11, textAlign: "right", marginTop: -8, fontFamily: "Inter_400Regular" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  errorText: { fontSize: 13, color: "#DC2626", flex: 1, fontFamily: "Inter_400Regular" },
  submitBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitBtnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 16,
  },
  successIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successTitle: { fontSize: 26, fontFamily: "Fredoka_700Bold" },
  successSub: { fontSize: 15, textAlign: "center", lineHeight: 22, fontFamily: "Inter_400Regular" },
  doneBtn: {
    marginTop: 8,
    height: 48,
    paddingHorizontal: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
});
