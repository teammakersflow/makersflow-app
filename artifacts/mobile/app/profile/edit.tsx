import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useNetwork } from "@/context/NetworkContext";
import { TEXT_STYLES } from "@/constants/typography";
import { getAvatarSource } from "@/constants/avatars";
import { AvatarPickerModal } from "@/components/AvatarPickerModal";

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const { isConnected } = useNetwork();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [grade, setGrade] = useState(user?.grade ?? "");
  const [school, setSchool] = useState(user?.school ?? "");
  const [avatarUri, setAvatarUri] = useState(user?.avatar ?? "");
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  async function handleSave() {
    if (!user?.id) return;

    if (isConnected === false) {
      Alert.alert(
        "You're Offline",
        "You're offline — profile changes cannot be saved right now. Please reconnect to the internet and try again.",
        [{ text: "OK" }]
      );
      return;
    }

    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await updateUser({
      name,
      phone: phone.trim() || undefined,
      grade,
      school,
      avatar: avatarUri,
    });
    setLoading(false);

    if (result.success) {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/profile");
      }
    } else {
      Alert.alert(
        "Save Failed",
        result.error?.toLowerCase().includes("network") || result.error?.toLowerCase().includes("fetch")
          ? "You're offline — changes will sync when reconnected."
          : (result.error || "Failed to update profile.")
      );
    }
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const avatarSource = getAvatarSource(avatarUri);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Pressable onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(tabs)/profile");
            }
          }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, TEXT_STYLES.pageTitle, { color: colors.foreground, fontSize: 18 }]}>Edit Profile</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 24, gap: 16, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <Pressable onPress={() => setPickerModalVisible(true)} style={styles.avatarPressable}>
              {avatarSource ? (
                <Image source={avatarSource} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.initials, TEXT_STYLES.pageTitle, { color: "#FFF", fontSize: 36 }]}>{initials || "S"}</Text>
                </View>
              )}
              <View style={[styles.editBadge, { backgroundColor: colors.primary }]}>
                <Ionicons name="pencil" size={15} color="#FFF" />
              </View>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 20 }}>
              <Pressable onPress={() => setPickerModalVisible(true)}>
                <Text style={[styles.changePhotoText, TEXT_STYLES.label, { color: colors.primary }]}>
                  Choose Avatar
                </Text>
              </Pressable>
              {avatarUri ? (
                <Pressable onPress={() => setAvatarUri("")}>
                  <Text style={[styles.changePhotoText, TEXT_STYLES.label, { color: "#DC2626" }]}>Remove Avatar</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {/* Email (Read-only) */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, TEXT_STYLES.label, { color: colors.foreground }]}>Email</Text>
            <View style={[styles.inputWrapper, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="mail" size={16} color={colors.mutedForeground} />
              <Text style={[styles.disabledText, TEXT_STYLES.description, { color: colors.mutedForeground }]}>{user?.email}</Text>
            </View>
          </View>

          {/* Phone Number */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, TEXT_STYLES.label, { color: colors.foreground }]}>Phone Number</Text>
            <View style={[styles.inputWrapper, {
              backgroundColor: colors.card,
              borderColor: focusedField === "phone" ? colors.primary : colors.border,
              borderWidth: focusedField === "phone" ? 1.5 : 1
            }]}>
              <Ionicons name="call" size={16} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, TEXT_STYLES.description, { color: colors.foreground }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                onFocus={() => setFocusedField("phone")}
                onBlur={() => setFocusedField(null)}
              />
            </View>
          </View>

          {[
            { label: "Full Name", key: "name", value: name, setter: setName, placeholder: "Your full name", keyboard: "default" as const, icon: "person" },
            { label: "Grade / Class", key: "grade", value: grade, setter: setGrade, placeholder: "e.g. Class 10", keyboard: "default" as const, icon: "book" },
            { label: "School / Institution", key: "school", value: school, setter: setSchool, placeholder: "Your school name", keyboard: "default" as const, icon: "home" },
          ].map((field) => (
            <View key={field.label} style={styles.fieldGroup}>
              <Text style={[styles.label, TEXT_STYLES.label, { color: colors.foreground }]}>{field.label}</Text>
              <View style={[styles.inputWrapper, {
                backgroundColor: colors.card,
                borderColor: focusedField === field.key ? colors.primary : colors.border,
                borderWidth: focusedField === field.key ? 1.5 : 1
              }]}>
                <Ionicons name={field.icon as any} size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, TEXT_STYLES.description, { color: colors.foreground }]}
                  value={field.value}
                  onChangeText={field.setter}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType={field.keyboard}
                  onFocus={() => setFocusedField(field.key)}
                  onBlur={() => setFocusedField(null)}
                />
              </View>
            </View>
          ))}

          {/* Save Changes gradient CTA */}
          <LinearGradient
            colors={[colors.gradientStart || "#0B6FAD", colors.gradientEnd || "#17E5D3"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.saveBtnGradient}
          >
            <Pressable
              style={({ pressed }) => [styles.saveBtn, { opacity: pressed ? 0.9 : 1 }]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={[styles.saveBtnText, TEXT_STYLES.button, { color: "#FFF" }]}>Save Changes</Text>
              )}
            </Pressable>
          </LinearGradient>

          {/* Cancel ghost button */}
          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              { borderColor: colors.primary, opacity: pressed ? 0.9 : 1 }
            ]}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/profile");
              }
            }}
          >
            <Text style={[styles.cancelBtnText, TEXT_STYLES.button, { color: colors.primary }]}>Cancel</Text>
          </Pressable>
        </ScrollView>
        <AvatarPickerModal
          visible={pickerModalVisible}
          selectedAvatarId={avatarUri}
          onSelectAvatar={(id) => setAvatarUri(id)}
          onClose={() => setPickerModalVisible(false)}
        />
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
  headerTitle: { fontSize: 18, fontWeight: "700" },
  saveText: { fontSize: 16, fontWeight: "700" },
  avatarSection: { alignItems: "center", gap: 8, marginBottom: 24 },
  avatarPressable: { position: "relative" },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  initials: { fontSize: 36, fontWeight: "800", color: "#FFF" },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFF",
  },
  changePhotoText: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  disabledText: { flex: 1, fontSize: 15 },
  email: { fontSize: 14 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 14, fontWeight: "600" },
  inputWrapper: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  input: { flex: 1, fontSize: 15 },
  saveBtnGradient: { height: 48, borderRadius: 24, overflow: "hidden", marginTop: 16 },
  saveBtn: { height: 48, alignItems: "center", justifyContent: "center", width: "100%" },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  cancelBtn: { height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 12, backgroundColor: "#FFFFFF" },
  cancelBtnText: { fontSize: 15, fontWeight: "700" },
});
