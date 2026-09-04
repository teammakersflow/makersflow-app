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

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();

  const [fullName, setFullName] = useState(user?.name ?? "");
  const [age, setAge] = useState("");
  const [grade, setGrade] = useState("");
  const [school, setSchool] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fullNameError, setFullNameError] = useState("");
  const [ageError, setAgeError] = useState("");
  const [gradeError, setGradeError] = useState("");
  const [schoolError, setSchoolError] = useState("");

  async function handleSubmit() {
    setFullNameError("");
    setAgeError("");
    setGradeError("");
    setSchoolError("");
    setError("");

    let hasError = false;
    if (!fullName.trim()) {
      setFullNameError("Full name is required");
      hasError = true;
    }
    const parsedAge = parseInt(age.trim(), 10);
    if (!age.trim()) {
      setAgeError("Age is required");
      hasError = true;
    } else if (isNaN(parsedAge) || parsedAge < 10 || parsedAge > 25) {
      setAgeError("Age must be between 10 and 25");
      hasError = true;
    }
    if (!grade.trim()) {
      setGradeError("Grade is required");
      hasError = true;
    }
    if (!school.trim()) {
      setSchoolError("School name is required");
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await updateUser({
      name: fullName.trim(),
      age: parsedAge,
      grade: grade.trim(),
      school: school.trim(),
      onboarding_completed: true,
    });
    setLoading(false);

    if (result.success) {
      router.replace("/(tabs)");
    } else {
      setError(result.error || "Failed to save profile. Please try again.");
    }
  }

  async function handleSkip() {
    setLoading(true);
    await updateUser({ onboarding_completed: true });
    setLoading(false);
    router.replace("/(tabs)");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accent }]}>
            <Ionicons name="person-add" size={32} color="#0B6FAD" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>Complete your profile</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Help us personalise your learning experience
          </Text>
        </View>

        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Full Name */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Full Name</Text>
            <View style={[styles.inputWrapper, { borderColor: fullNameError ? "#DC2626" : colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="person" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={fullName}
                onChangeText={(t) => { setFullName(t); setFullNameError(""); }}
                placeholder="Your full name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
            </View>
            {fullNameError ? <Text style={styles.fieldError}>{fullNameError}</Text> : null}
          </View>

          {/* Age */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Age</Text>
            <View style={[styles.inputWrapper, { borderColor: ageError ? "#DC2626" : colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="information-circle" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={age}
                onChangeText={(t) => { setAge(t); setAgeError(""); }}
                placeholder="Your age (10-25)"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
              />
            </View>
            {ageError ? <Text style={styles.fieldError}>{ageError}</Text> : null}
          </View>

          {/* Grade */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Grade / Class</Text>
            <View style={[styles.inputWrapper, { borderColor: gradeError ? "#DC2626" : colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="book" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={grade}
                onChangeText={(t) => { setGrade(t); setGradeError(""); }}
                placeholder="e.g., 10th Grade"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            {gradeError ? <Text style={styles.fieldError}>{gradeError}</Text> : null}
          </View>

          {/* School Name */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>School Name</Text>
            <View style={[styles.inputWrapper, { borderColor: schoolError ? "#DC2626" : colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="school" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={school}
                onChangeText={(t) => { setSchool(t); setSchoolError(""); }}
                placeholder="Your school name"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            {schoolError ? <Text style={styles.fieldError}>{schoolError}</Text> : null}
          </View>

          {/* Submit Button */}
          <Pressable
            style={[styles.btn, { backgroundColor: "#0B6FAD" }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.btnContent}>
                <Ionicons name="rocket" size={16} color="#FFF" />
                <Text style={styles.btnText}>Get Started</Text>
                <Ionicons name="chevron-forward" size={16} color="#FFF" style={{ marginLeft: "auto" }} />
              </View>
            )}
          </Pressable>

          <Pressable onPress={handleSkip} style={styles.skipBtn}>
            <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip for now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  header: { alignItems: "center", marginBottom: 32 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { fontSize: 24, fontFamily: "Fredoka_700Bold", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 6, textAlign: "center" },
  form: { gap: 16 },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626", flex: 1 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: {
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
    paddingHorizontal: 20,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
  skipBtn: { alignItems: "center", paddingVertical: 12 },
  skipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  fieldError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 4 },
});
