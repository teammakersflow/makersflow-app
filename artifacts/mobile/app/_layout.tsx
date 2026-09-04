import { useFonts, Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold } from "@expo-google-fonts/fredoka";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Alert, Modal, StyleSheet, Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Polyfill/Intercept Alert.alert to render our custom Modal
const originalAlert = Alert.alert;
let globalShowAlert: ((title: string, message?: string, buttons?: any[]) => void) | null = null;

Alert.alert = (title: string, message?: string, buttons?: any[]) => {
  if (globalShowAlert) {
    globalShowAlert(title, message, buttons);
  } else {
    originalAlert(title, message, buttons);
  }
};

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AuthRequireProvider } from "@/context/AuthRequireContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppGate } from "@/components/AppGate";
import { CartProvider } from "@/context/CartContext";
import { ProgressProvider } from "@/context/ProgressContext";
import { FavoritesProvider } from "@/context/FavoritesContext";
import { useColors } from "@/hooks/useColors";
import { OfflineScreen } from "@/components/OfflineScreen";
import { NetworkProvider, useNetwork } from "@/context/NetworkContext";
import { OfflineBanner } from "@/components/OfflineBanner";
import AsyncStorage from "@react-native-async-storage/async-storage";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  const { isConnected } = useNetwork();
  const { user, isLoading: isAuthLoading } = useAuth();
  
  const [hasEverLoaded, setHasEverLoaded] = React.useState<boolean | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);

  const [alertConfig, setAlertConfig] = React.useState<{
    visible: boolean;
    title: string;
    message?: string;
    buttons?: any[];
  }>({
    visible: false,
    title: "",
  });

  useEffect(() => {
    globalShowAlert = (title, message, buttons) => {
      setAlertConfig({
        visible: true,
        title,
        message,
        buttons,
      });
    };
    return () => {
      globalShowAlert = null;
    };
  }, []);

  const [fontsLoaded, fontError] = useFonts({ 
    Fredoka_500Medium, 
    Fredoka_600SemiBold, 
    Fredoka_700Bold, 
    Inter_400Regular, 
    Inter_500Medium, 
    Inter_600SemiBold 
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    AsyncStorage.getItem("app_has_ever_loaded").then((val) => {
      setHasEverLoaded(val === "true");
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded && isConnected && !isAuthLoading && hasEverLoaded === false) {
      AsyncStorage.setItem("app_has_ever_loaded", "true");
      setHasEverLoaded(true);
    }
  }, [fontsLoaded, isConnected, isAuthLoading, hasEverLoaded]);

  const handleRetry = async () => {
    setIsChecking(true);
    setTimeout(() => {
      setIsChecking(false);
    }, 1500);
  };

  if (!fontsLoaded || hasEverLoaded === null) {
    return <View style={{ flex: 1, backgroundColor: '#F4FAFD' }} />;
  }

  // Level 1: startup failure condition
  // isConnected === null means "checking" — don't show offline screen yet
  const showStartupOfflineScreen = 
    isConnected === false && // explicit false, not null (null = still checking)
    !isAuthLoading && 
    !user && 
    hasEverLoaded === false;

  if (showStartupOfflineScreen) {
    return <OfflineScreen onRetry={handleRetry} isChecking={isChecking} />;
  }

  return (
    <>
      <OfflineBanner />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          // Smooth and fast transitions
          animation: "slide_from_right",
          animationDuration: 150,  // FIX: 150ms feels snappy without being jarring
          gestureEnabled: true,
          gestureDirection: "horizontal",
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false, animation: "fade", animationDuration: 120 }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "none" }} />
        <Stack.Screen name="course/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="course/learn" options={{ headerShown: false }} />
        <Stack.Screen name="store/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="store/checkout" options={{ headerShown: false }} />
        <Stack.Screen name="store/orders" options={{ headerShown: false }} />
        <Stack.Screen name="news/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile/edit" options={{ headerShown: false, presentation: "modal", animationDuration: 200 }} />
        <Stack.Screen name="favorites" options={{ headerShown: false }} />
        <Stack.Screen name="settings/index" options={{ headerShown: false }} />
        <Stack.Screen name="settings/security" options={{ headerShown: false }} />
        <Stack.Screen name="settings/notifications" options={{ headerShown: false }} />
        <Stack.Screen name="settings/help" options={{ headerShown: false }} />
        <Stack.Screen name="settings/feedback" options={{ headerShown: false }} />
        <Stack.Screen name="settings/security-log" options={{ headerShown: false }} />
        <Stack.Screen name="settings/privacy-policy" options={{ headerShown: false }} />
        <Stack.Screen name="settings/terms-of-service" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="certificate" options={{ headerShown: false }} />
      </Stack>
      <CustomAlertModal
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onClose={() => setAlertConfig((prev) => ({ ...prev, visible: false }))}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <NetworkProvider>
                <AuthProvider>
                  <AuthRequireProvider>
                    <ProtectedRoute>
                      <CartProvider>
                        <FavoritesProvider>
                          <ProgressProvider>
                            <AppGate>
                              <RootLayoutNav />
                            </AppGate>
                          </ProgressProvider>
                        </FavoritesProvider>
                      </CartProvider>
                    </ProtectedRoute>
                  </AuthRequireProvider>
                </AuthProvider>
              </NetworkProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

interface CustomAlertModalProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: any[];
  onClose: () => void;
}

function CustomAlertModal({ visible, title, message, buttons, onClose }: CustomAlertModalProps) {
  const colors = useColors();

  if (!visible) return null;

  // Decide icon type
  let iconName: any = "information-circle-outline";
  let iconColor = "#0B6FAD";
  let iconBg = "#DCF7F4";

  const lowerTitle = title.toLowerCase();
  const lowerMsg = (message ?? "").toLowerCase();
  if (
    lowerTitle.includes("error") || 
    lowerTitle.includes("failed") || 
    lowerTitle.includes("incomplete") || 
    lowerTitle.includes("suspicious") || 
    lowerTitle.includes("wrong") ||
    lowerMsg.includes("failed") ||
    lowerMsg.includes("invalid")
  ) {
    iconName = "alert-circle-outline";
    iconColor = "#EF4444";
    iconBg = "#FEE2E2";
  } else if (
    lowerTitle.includes("success") || 
    lowerTitle.includes("complete") || 
    lowerTitle.includes("done") || 
    lowerTitle.includes("verified") ||
    lowerTitle.includes("saved") ||
    lowerMsg.includes("success")
  ) {
    iconName = "checkmark-circle-outline";
    iconColor = "#10B981";
    iconBg = "#D1FAE5";
  } else if (
    lowerTitle.includes("clear") || 
    lowerTitle.includes("delete") || 
    lowerTitle.includes("remove")
  ) {
    iconName = "trash-outline";
    iconColor = "#EF4444";
    iconBg = "#FEE2E2";
  }

  // Parse buttons
  let alertButtons = buttons;
  if (!alertButtons || alertButtons.length === 0) {
    alertButtons = [{ text: "OK", onPress: () => {} }];
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={alertStyles.alertOverlay}>
        <View style={[alertStyles.alertModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header Icon */}
          <View style={[alertStyles.alertIconCircle, { backgroundColor: iconBg }]}>
            <Ionicons name={iconName} size={32} color={iconColor} />
          </View>

          {/* Texts */}
          <Text style={[alertStyles.alertTitle, { color: colors.foreground }]}>{title}</Text>
          {message ? (
            <Text style={[alertStyles.alertMessage, { color: colors.mutedForeground }]}>{message}</Text>
          ) : null}

          {/* Action Buttons Row */}
          <View style={[alertStyles.alertBtnRow, { flexDirection: alertButtons.length > 2 ? "column" : "row" }]}>
            {alertButtons.map((btn, index) => {
              const isDestructive = btn.style === "destructive" || btn.text.toLowerCase().includes("delete") || btn.text.toLowerCase().includes("clear") || btn.text.toLowerCase().includes("remove");
              const isCancel = btn.style === "cancel" || btn.text.toLowerCase().includes("cancel");

              let btnBgColor = "#0B6FAD";
              let btnTextColor = "#FFF";
              let btnBorderColor = "transparent";
              let btnBorderWidth = 0;

              if (isDestructive) {
                btnBgColor = "#EF4444";
              } else if (isCancel) {
                btnBgColor = colors.card;
                btnTextColor = colors.mutedForeground;
                btnBorderColor = colors.border;
                btnBorderWidth = 1.5;
              }

              return (
                <Pressable
                  key={index}
                  style={({ pressed }) => [
                    alertStyles.alertBtn,
                    {
                      backgroundColor: btnBgColor,
                      borderColor: btnBorderColor,
                      borderWidth: btnBorderWidth,
                      flex: alertButtons.length > 2 ? undefined : 1,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    }
                  ]}
                  onPress={() => {
                    onClose();
                    if (btn.onPress) {
                      btn.onPress();
                    }
                  }}
                >
                  <Text style={[alertStyles.alertBtnText, { color: btnTextColor }]}>{btn.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const alertStyles = StyleSheet.create({
  alertOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  alertModal: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  alertIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
    textAlign: "center",
    marginBottom: 10,
  },
  alertMessage: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 24,
  },
  alertBtnRow: {
    width: "100%",
    gap: 12,
  },
  alertBtn: {
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  alertBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
  },
});
