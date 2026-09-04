import { Feather, Ionicons } from "@expo/vector-icons";
import GoogleLogo from "@/components/GoogleLogo";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

function getFriendlyErrorMessage(err: string): string {
  const msg = err.toLowerCase();
  // Supabase deliberately returns the same message for a wrong password and a
  // non-existent account (prevents user enumeration), so we cannot tell them
  // apart. Flag it and let the UI offer both paths.
  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "__NO_ACCOUNT_OR_WRONG_PASSWORD__";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email address before logging in.";
  }
  if (msg.includes("user not found") || msg.includes("no user found") || msg.includes("account not found")) {
    return "__NO_ACCOUNT_OR_WRONG_PASSWORD__";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many requests. Please try again in a few minutes.";
  }
  if (msg.includes("network")) {
    return "Network error. Please check your connection.";
  }
  return err;
}

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    // Biometric auto-login disabled
  }, []);

  async function handleGoogleLogin() {
    if (googleLoading) return;
    setError("");
    setGoogleLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await loginWithGoogle();

    if (result.success) {
      const profile = (result as any).profile;
      setGoogleLoading(false);
      if (profile && profile.grade) {
        router.replace("/(tabs)");
      } else {
        router.replace("/(auth)/onboarding");
      }
    } else {
      setGoogleLoading(false);
      setError(result.error || "Google sign-in failed. Please try again.");
    }
  }

  async function handleLogin() {
    if (loading) return;

    setEmailError("");
    setPasswordError("");
    setError("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let hasError = false;

    if (!email) {
      setEmailError("Email is required");
      hasError = true;
    } else if (!emailRegex.test(email)) {
      setEmailError("Please enter a valid email address");
      hasError = true;
    }

    if (!password) {
      setPasswordError("Password is required");
      hasError = true;
    }

    if (hasError) return;

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      const profile = (result as any).profile;
      if (profile && profile.grade) {
        router.replace("/(tabs)");
      } else {
        router.replace("/(auth)/onboarding");
      }
    } else {
      const rawError = (result.error || "").toLowerCase();
      const accountExists = !rawError.includes("not found") && !rawError.includes("no account") && !rawError.includes("no user");

      if (!accountExists) {
        Alert.alert(
          "Account Not Found",
          "You do not have an account. Please sign up.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Sign Up", onPress: () => router.push("/(auth)/register") }
          ]
        );
        setError("");
      } else {
        const msg = getFriendlyErrorMessage(result.error || "Invalid credentials. Please try again.");
        if (msg === "__NO_ACCOUNT_OR_WRONG_PASSWORD__") {
          Alert.alert(
            "Incorrect Password",
            "The password you entered is incorrect. Please try again or reset your password.",
            [
              { text: "Try Again", style: "cancel" },
              { text: "Reset Password", onPress: () => router.push("/(auth)/forgot-password") },
              { text: "Create Account", onPress: () => router.push("/(auth)/register") }
            ]
          );
          setError("");
        } else {
          setError(msg);
        }
      }
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Image
            source={require("@/assets/images/logos/logo.webp")}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={[styles.appName, { color: colors.foreground }]}>MAKERSFLOW</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>Learn · Explore · Excel</Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.title, { color: colors.foreground }]}>Welcome back!</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to continue your learning journey</Text>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Email input */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: emailError ? "#DC2626" : (emailFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="mail" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setEmailError("");
                }}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="Enter your email"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            {emailError ? <Text style={styles.fieldError}>{emailError}</Text> : null}
          </View>

          {/* Password input */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
            <View style={[
              styles.inputWrapper,
              {
                borderColor: passwordError ? "#DC2626" : (passwordFocused ? "#0B6FAD" : colors.border),
                backgroundColor: colors.card,
              }
            ]}>
              <Ionicons name="lock-closed" size={16} color="#0B6FAD" />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setPasswordError("");
                }}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="Enter your password"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? "eye-off" : "eye"} size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {passwordError ? <Text style={styles.fieldError}>{passwordError}</Text> : null}
          </View>

          <Pressable onPress={() => router.push("/(auth)/forgot-password")} style={styles.forgotRow}>
            <Text style={[styles.forgotText, { color: "#0B6FAD", fontSize: 14, fontFamily: "Inter_600SemiBold" }]}>Forgot password?</Text>
          </Pressable>

          {/* Login Button */}
          <Pressable
            style={({ pressed }) => [styles.loginBtn, { backgroundColor: "#0B6FAD", opacity: pressed ? 0.85 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.primaryButtonContent}>
                <Ionicons name="log-in" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.loginBtnText}>Sign In</Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" style={{ marginLeft: "auto" }} />
              </View>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          {/* Google Login button */}
          <Pressable
            style={({ pressed }) => [
              styles.googleBtn,
              {
                backgroundColor: colors.card,
                borderWidth: 1.5,
                borderColor: colors.border,
                borderRadius: 12,
                height: 52,
                elevation: 2,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: pressed ? 0.85 : 1
              },
            ]}
            onPress={handleGoogleLogin}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <GoogleLogo size={18} />
                <Text style={[styles.googleBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* Biometric login button removed per specification */}

        </View>

        {/* Sign Up section */}
        <View style={[
          styles.signUpCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="person-add" size={16} color={colors.accentForeground} />
            </View>
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
              New to MakersFlow?
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center", lineHeight: 18 }}>
            Join thousands of students learning robotics, AI & electronics
          </Text>
          <Pressable
            onPress={() => router.push("/(auth)/register")}
            style={({ pressed }) => ({ width: "100%", opacity: pressed ? 0.85 : 1 })}
          >
            <View style={{ paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#0B6FAD", borderRadius: 14, flexDirection: "row", gap: 8 }}>
              <Text style={{ color: "#FFF", fontSize: 15, fontFamily: "Inter_700Bold" }}>
                Create Free Account
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#FFF" />
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  header: { alignItems: "center", marginBottom: 36 },
  logoImage: {
    width: 80,
    height: 80,
    marginBottom: 12,
  },
  appName: { fontSize: 24, fontFamily: "Fredoka_700Bold", letterSpacing: 2 },
  tagline: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  form: { gap: 16 },
  title: { fontSize: 26, fontFamily: "Fredoka_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -8 },
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
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
  forgotRow: { alignSelf: "flex-end", marginTop: -8 },
  forgotText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  loginBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 20,
  },
  loginBtnText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold", color: "#FFF" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  googleBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  signUpCard: {
    marginTop: 24,
    marginBottom: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 12,
  },
  primaryButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: 8,
  },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24, paddingBottom: 24 },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  registerLink: { fontSize: 14, fontFamily: "Inter_700Bold" },
  fieldError: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#DC2626", marginTop: 4 },
});
