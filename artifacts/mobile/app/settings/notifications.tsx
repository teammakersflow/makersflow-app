import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { registerForPushNotifications } from "@/lib/pushNotifications";

// Lazy-load: importing expo-notifications at the top crashes Expo Go (SDK 53+)
function getNotifications(): typeof import("expo-notifications") | null {
  if (Application.applicationId === "host.exp.Exponent" || Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-notifications");
  } catch {
    return null;
  }
}

const NOTIF_SETTINGS = [
  { key: "lessons", label: "New Lessons", sub: "When new content is available" },
  { key: "quiz", label: "Quiz Reminders", sub: "Reminders to take pending quizzes" },
  { key: "streak", label: "Learning Streak", sub: "Daily reminders to keep your streak" },
  { key: "news", label: "News & Updates", sub: "Latest educational news" },
  { key: "offers", label: "Offers & Promotions", sub: "Deals on courses and products" },
  { key: "progress", label: "Progress Reports", sub: "Weekly learning summary" },
];

const NOTIF_STORAGE_KEY = "@makersflow_notification_prefs";

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_SETTINGS.map((s) => [s.key, true]))
  );
  const [loading, setLoading] = useState(true);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    loadPreferences();
    checkPermissionStatus();
  }, []);

  async function checkPermissionStatus() {
    if (Application.applicationId === 'host.exp.Exponent') {
      return;
    }
    try {
      const Notifications = getNotifications();
      if (!Notifications) return;
      const { status } = await Notifications.getPermissionsAsync() as any;
      setPushEnabled(status === "granted");
    } catch (e) {
      console.error("Failed to check notifications permission:", e);
    }
  }

  async function togglePushNotifications() {
    if (Application.applicationId === 'host.exp.Exponent') {
      Alert.alert(
        "Expo Go Constraint",
        "Push notifications cannot be configured inside Expo Go. Please use a development build to configure notifications.",
        [{ text: "OK" }]
      );
      return;
    }
    if (pushEnabled) {
      Alert.alert(
        "Disable Notifications",
        "To turn off notifications completely, please disable them in your device's system settings.",
        [{ text: "OK" }]
      );
    } else {
      try {
        const Notifications = getNotifications();
        if (!Notifications) return;
        const { status: currentStatus, canAskAgain } = await Notifications.getPermissionsAsync() as any;
        let finalStatus = currentStatus;
        if (finalStatus !== "granted" && canAskAgain) {
          const { status } = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          }) as any;
          finalStatus = status;
        }

        if (finalStatus === "granted") {
          setPushEnabled(true);
          if (user?.id) {
            await registerForPushNotifications(user.id);
          }
          Alert.alert("Enabled", "Push notifications are now enabled!");
        } else {
          Alert.alert(
            "Permission Required",
            "Notifications are disabled. Please enable them in your device settings to receive push notifications.",
            [{ text: "OK" }]
          );
        }
      } catch (e) {
        console.error("Error requesting notifications permission:", e);
      }
    }
  }

  async function loadPreferences() {
    try {
      const stored = await AsyncStorage.getItem(NOTIF_STORAGE_KEY);
      if (stored) {
        setPrefs(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load notification preferences:", error);
    } finally {
      setLoading(false);
    }
  }

  async function savePreferences(newPrefs: Record<string, boolean>) {
    try {
      await AsyncStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(newPrefs));
    } catch (error) {
      console.error("Failed to save notification preferences:", error);
      Alert.alert("Error", "Failed to save notification preferences. Please try again.");
    }
  }

  async function toggle(key: string) {
    if (!prefs[key] && !pushEnabled) {
      Alert.alert(
        "Notifications Disabled",
        "You must enable push notifications to receive these updates.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Enable", onPress: () => togglePushNotifications() }
        ]
      );
      return;
    }
    const newPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(newPrefs);
    savePreferences(newPrefs);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#D6E9F2", marginBottom: 16 }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Push Notifications</Text>
              <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>Enable system push notifications</Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={togglePushNotifications}
              trackColor={{ true: "#0B6FAD", false: "#D6E9F2" }}
              thumbColor="#FFF"
              disabled={loading}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: "#D6E9F2" }]}>
          {NOTIF_SETTINGS.map((item, idx) => (
            <React.Fragment key={item.key}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{item.sub}</Text>
                </View>
                <Switch
                  value={prefs[item.key]}
                  onValueChange={() => toggle(item.key)}
                  trackColor={{ true: "#0B6FAD", false: "#D6E9F2" }}
                  thumbColor="#FFF"
                  disabled={loading}
                />
              </View>
              {idx < NOTIF_SETTINGS.length - 1 && (
                <View style={[styles.divider, { backgroundColor: "#D6E9F2" }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      </ScrollView>
    </View>
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
  headerTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold" },
  card: { borderRadius: 16, borderWidth: 1.5, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: 16, gap: 14 },
  rowLabel: { fontSize: 15, fontFamily: "Fredoka_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  divider: { height: 1, marginLeft: 16 },
});
