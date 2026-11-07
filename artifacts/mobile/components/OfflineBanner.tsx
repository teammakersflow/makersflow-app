import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, Animated, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetwork } from "@/context/NetworkContext";

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isInternetReachable } = useNetwork();
  const [statusText, setStatusText] = useState("No internet connection");
  const [backgroundColor, setBackgroundColor] = useState("#1F2937");
  const [isVisible, setIsVisible] = useState(false);

  // Animation values
  const translateY = useRef(new Animated.Value(-100)).current;
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevInternetReachable = useRef<boolean | null>(null);

  // Pulsing animation for the status dot
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isInternetReachable === false) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => {
      if (animation) animation.stop();
    };
  }, [isInternetReachable]);

  useEffect(() => {
    if (isInternetReachable === null) {
      return;
    }

    if (isInternetReachable === false) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setStatusText("No internet connection");
      setBackgroundColor("#1F2937");
      setIsVisible(true);

      // Slide in
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    } else if (isInternetReachable === true && prevInternetReachable.current === false) {
      setStatusText("Back online");
      setBackgroundColor("#10B981");

      // Wait 2 seconds before sliding out
      hideTimeoutRef.current = setTimeout(() => {
        Animated.timing(translateY, {
          toValue: -100 - insets.top,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setIsVisible(false);
        });
      }, 2000);
    }

    prevInternetReachable.current = isInternetReachable;
  }, [isInternetReachable, insets.top]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, []);

  if (!isVisible || isInternetReachable === null) return null;

  // Position it below status bar on iOS/Android, at top on Web
  const topOffset = Platform.OS === "web" ? 0 : insets.top;

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          top: topOffset,
          backgroundColor: backgroundColor,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.content}>
        <Ionicons
          name={isInternetReachable ? "wifi" : "wifi-outline"}
          size={16}
          color="#FFF"
          style={{ marginRight: 8 }}
        />
        <Text style={styles.text}>{statusText}</Text>
        {!isInternetReachable && (
          <Animated.View style={[styles.dot, { opacity: pulseAnim }]} />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 44,
    justifyContent: "center",
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    elevation: 5,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  text: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#EF4444",
    marginLeft: 8,
  },
});
