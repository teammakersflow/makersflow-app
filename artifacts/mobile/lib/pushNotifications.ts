import * as Device from "expo-device";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/auth/apiClient";

const devLog = (...args: any[]) => {
  if (__DEV__) console.log(...args);
};

function isExpoGo(): boolean {
  return Application.applicationId === "host.exp.Exponent";
}

// IMPORTANT: expo-notifications must NOT be imported at the top of this file.
// In Expo Go (SDK 53+) merely importing it on Android throws an uncaught
// error at app startup. We lazy-require it only in dev/production builds.
function getNotifications(): typeof import("expo-notifications") | null {
  if (isExpoGo() || Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-notifications");
  } catch {
    return null;
  }
}

let handlerConfigured = false;

/**
 * Requests permission (if needed), fetches the Expo push token and stores it
 * in the `push_tokens` table so the backend can send pushes to this device.
 * Safe to call on every app start — it upserts. No-ops in Expo Go/simulators.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      devLog("[Push] Skipping registration (simulator)");
      return null;
    }
    const Notifications = getNotifications();
    if (!Notifications) {
      devLog("[Push] Skipping registration (Expo Go / web)");
      return null;
    }

    // Show notifications while the app is foregrounded (configure once)
    if (!handlerConfigured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerConfigured = true;
    }

    if (Platform.OS === "android") {
      // MAX importance = shows on lock screen, makes sound, shows in status bar
      await Notifications.setNotificationChannelAsync("default", {
        name: "MakersFlow Notifications",
        description: "Order updates, course announcements and more",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#0B6FAD",
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      });
      // Order updates channel — separate so user can control independently
      await Notifications.setNotificationChannelAsync("orders", {
        name: "Order Updates",
        description: "Shipping and delivery status updates",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      });
    }

    const { status: existing } = (await Notifications.getPermissionsAsync()) as any;
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = (await Notifications.requestPermissionsAsync()) as any;
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      devLog("[Push] Permission not granted");
      return null;
    }

    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;

    const deviceInfo = [Device.modelName, Device.osName, Device.osVersion, Platform.OS]
      .filter(Boolean)
      .join(" | ");

    // 1. Try backend POST /push-tokens
    let backendSuccess = false;
    try {
      await apiRequest("/push-tokens", {
        method: "POST",
        body: JSON.stringify({
          token,
          platform: Platform.OS,
          device_info: deviceInfo,
        }),
      });
      backendSuccess = true;
      devLog("[Push] Registered push token with backend");
    } catch (backendErr: any) {
      devLog("[Push] Backend push token registration failed, trying Supabase:", backendErr?.message || backendErr);
    }

    if (!backendSuccess) {
      const { error } = await supabase.from("push_tokens").upsert(
        {
          user_id: userId,
          token,
          device_info: deviceInfo,
          platform: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "token" }
      );
      if (error) {
        devLog("[Push] Failed to persist token:", error.message);
        return token;
      }
    }

    devLog("[Push] Registered push token");
    return token;
  } catch (e: any) {
    devLog("[Push] Registration failed:", e?.message ?? e);
    return null;
  }
}

/** Remove this device's push token (call on logout). Best-effort. */
export async function unregisterPushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const Notifications = getNotifications();
    if (!Notifications) return;
    const { status } = (await Notifications.getPermissionsAsync()) as any;
    if (status !== "granted") return;
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResponse.data;

    try {
      const res = await apiRequest<any>("/push-tokens");
      const tokens = res?.data ?? (Array.isArray(res) ? res : []);
      const matched = tokens.find((t: any) => t.token === token);
      if (matched?.id) {
        await apiRequest(`/push-tokens/${matched.id}`, { method: "DELETE" });
      }
    } catch {
      // ignore
    }

    await supabase
      .from("push_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("token", token);
  } catch {
    // best-effort cleanup
  }
}
