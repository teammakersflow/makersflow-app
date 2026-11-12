import { useNetwork } from "@/context/NetworkContext";
import { flushPendingProgress } from "@/lib/progressStorage";
import { routeForNotification } from "@/lib/notificationRouting";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  AppState,
  AppStateStatus,
  Platform,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as Application from "expo-application";
import { useAuth } from "@/context/AuthContext";
import { registerForPushNotifications } from "@/lib/pushNotifications";

const BIOMETRIC_KEY = "makersflow_biometric_enabled";
const LOCK_AFTER_MS = 30_000;

function isExpoGo(): boolean {
  return (
    Application.applicationId === "host.exp.Exponent" ||
    Platform.OS === "web"
  );
}

export function AppGate({ children }: { children: React.ReactNode }) {
  const { user, authInitialized } = useAuth();
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const registeredFor = useRef<string | null>(null);
  const didInitialLockCheck = useRef(false);
  const promptOpen = useRef(false);

  // ── 1. Register push token for returning users ──────────────────────────
  // AuthContext only fires registerForPushNotifications on SIGNED_IN event.
  // Returning users hit INITIAL_SESSION so token was never saved.
  useEffect(() => {
    if (!user?.id) return;
    // Register token on initial mount / session restore
    registerForPushNotifications(user.id).catch(() => {});

    // Re-verify / refresh token when app resumes from background
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && user?.id) {
        // L-25: refresh the token silently on resume; no permission prompt.
        registerForPushNotifications(user.id, { prompt: false }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  // M-17 (2026-11-10): re-send lesson progress queued while offline or after a
  // failed save, on sign-in, on return to the foreground and on reconnect.
  const { addReconnectListener } = useNetwork();
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    const flush = () => { flushPendingProgress(uid).catch(() => {}); };
    flush();
    const appSub = AppState.addEventListener("change", (s) => { if (s === "active") flush(); });
    const offReconnect = addReconnectListener(flush);
    return () => { appSub.remove(); offReconnect(); };
  }, [user?.id, addReconnectListener]);

  // ── 2. Notification tap handling ─────────────────────────────────────────
  // M-29 (2026-11-10):
  //  - The listener is registered immediately. The old 3 s delay dropped taps,
  //    and its cleanup was returned from inside setTimeout, so it never ran.
  //  - Cold start: the tap that launched the app is read once with
  //    getLastNotificationResponseAsync and routed after a short delay that
  //    lets the root navigator mount.
  //  - Payloads are validated by routeForNotification (untrusted input).
  const handledResponseIds = useRef(new Set<string>());
  useEffect(() => {
    if (isExpoGo()) return;
    let Notifications: any;
    try {
      Notifications = require("expo-notifications");
    } catch {
      return; // expo-notifications not available
    }
    const go = (response: any) => {
      try {
        const reqId = String(response?.notification?.request?.identifier ?? "");
        if (reqId && handledResponseIds.current.has(reqId)) return;
        if (reqId) handledResponseIds.current.add(reqId);
        router.push(routeForNotification(response?.notification?.request?.content?.data) as any);
      } catch {
        // ignore malformed payloads
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    let coldStartTimer: ReturnType<typeof setTimeout> | null = null;
    Notifications.getLastNotificationResponseAsync?.()
      .then((last: any) => {
        if (last) coldStartTimer = setTimeout(() => go(last), 600);
      })
      .catch(() => {});
    return () => {
      sub?.remove?.();
      if (coldStartTimer) clearTimeout(coldStartTimer);
    };
  }, []);

  // ── 3. Biometric lock helpers ────────────────────────────────────────────
  const runUnlock = useCallback(async () => {
    setLocked(false);
  }, []);

  const shouldLock = useCallback(async (): Promise<boolean> => {
    // Biometric lock disabled per specification
    return false;
  }, []);

  // Lock on first launch after auth settles
  useEffect(() => {
    if (!authInitialized || didInitialLockCheck.current) return;
    didInitialLockCheck.current = true;
    (async () => {
      if (await shouldLock()) {
        setLocked(true);
        runUnlock();
      }
    })();
  }, [authInitialized, shouldLock, runUnlock]);

  // Lock after returning from background
  useEffect(() => {
    const onChange = async (next: AppStateStatus) => {
      if (promptOpen.current) return;
      if (next === "background" || next === "inactive") {
        backgroundedAt.current = Date.now();
        return;
      }
      if (next === "active" && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= LOCK_AFTER_MS && (await shouldLock())) {
          setLocked(true);
          runUnlock();
        }
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [shouldLock, runUnlock]);

  // Children ALWAYS render — lock is a Modal overlay so splash screen hides
  return (
    <>
      {children}
      <Modal visible={locked} animationType="fade" statusBarTranslucent>
        <View style={styles.lockScreen}>
          <View style={styles.lockIcon}>
            <Ionicons name="finger-print" size={44} color="#0B6FAD" />
          </View>
          <Text style={styles.lockTitle}>MakersFlow is locked</Text>
          <Text style={styles.lockSub}>Verify your identity to continue</Text>
          <Pressable
            style={[styles.unlockBtn, { opacity: checking ? 0.7 : 1 }]}
            onPress={runUnlock}
            disabled={checking}
          >
            {checking ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.unlockBtnText}>Unlock</Text>
            )}
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  lockScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 10,
    backgroundColor: "#F4FAFD",
  },
  lockIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#DCF7F4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  lockTitle: { fontSize: 20, fontWeight: "700", color: "#1a2a3a", textAlign: "center" },
  lockSub: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 20 },
  unlockBtn: {
    height: 48,
    minWidth: 180,
    borderRadius: 24,
    backgroundColor: "#0B6FAD",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  unlockBtnText: { fontSize: 16, fontWeight: "600", color: "#FFF" },
});
