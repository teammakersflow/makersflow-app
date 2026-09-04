import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notificationService } from "@/services/notificationService";
import { announcementService } from "@/services/announcementService";

function TabLayout() {
  const colors = useColors();
  const { items } = useCart();
  const cartCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { user } = useAuth();
  const [hasUnread, setHasUnread] = React.useState(false);

  React.useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setHasUnread(false);
      return;
    }

    async function checkNotifications() {
      try {
        const lastSeen = await AsyncStorage.getItem('announcements_last_seen');
        const [unreadCount, broadcast] = await Promise.all([
          notificationService.getUnreadCount().catch(() => 0),
          announcementService.getActiveAnnouncements().catch(() => []),
        ]);
        const unreadBroadcasts = broadcast.filter(
          (a: any) => !lastSeen || new Date(a.created_at) > new Date(lastSeen),
        ).length;
        setHasUnread(unreadCount + unreadBroadcasts > 0);
      } catch {
        setHasUnread(false);
      }
    }

    checkNotifications();
    const interval = setInterval(checkNotifications, 15000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // FIX: ensure a safe minimum floor on Android devices that report
  // insets.bottom = 0 (gesture-nav phones still have a system bar).
  const ANDROID_NAV_FLOOR = 16;
  const bottomPad = Platform.OS === "ios"
    ? Math.max(insets.bottom, 16)
    : Math.max(insets.bottom + 4, ANDROID_NAV_FLOOR);
  const tabBarHeight = 56 + bottomPad;

  return (
    <Tabs
      // FIX: lazy=true — only the active tab mounts on startup.
      // Other tabs mount only when first visited → much faster cold start
      // and sign-in → home transition.
      screenOptions={{
        lazy: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: colors.card,
          borderTopWidth: 0,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: "visible",
          height: isWeb ? 84 : tabBarHeight,
          paddingBottom: bottomPad,
          paddingTop: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 12,
          zIndex: 999,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Ionicons name="home" size={22} color={color} />,
          tabBarAccessibilityLabel: "Home tab",
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: "Store",
          tabBarIcon: ({ color }) => <Ionicons name="storefront" size={22} color={color} />,
          tabBarBadge: cartCount > 0 ? cartCount : undefined,
          tabBarBadgeStyle: { backgroundColor: "#EF4444", color: "#FFF", fontSize: 10 },
          tabBarAccessibilityLabel: "Store tab",
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: "Courses",
          tabBarIcon: ({ focused }) => (
            <View style={[
              styles.fabContainer,
              {
                backgroundColor: focused ? colors.primaryPressed : colors.primary,
                borderColor: colors.card
              }
            ]}>
              <Ionicons name="book" size={22} color="#FFF" />
            </View>
          ),
          tabBarLabelStyle: {
            fontSize: 11,
            fontFamily: "Inter_600SemiBold",
            marginTop: 4,
          },
          tabBarAccessibilityLabel: "Courses tab",
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <Ionicons name="search" size={22} color={color} />,
          tabBarAccessibilityLabel: "Search tab",
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="news"
        options={{
          href: null,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <View style={{ position: "relative" }}>
              <Ionicons name="person" size={22} color={color} />
              {hasUnread && (
                <View style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: "#EF4444",
                  borderWidth: 1.5,
                  borderColor: colors.card,
                }} />
              )}
            </View>
          ),
          tabBarAccessibilityLabel: "Profile tab",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top: -22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 4,
  },
});

export default TabLayout;
