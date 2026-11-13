import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { WatchlistItem } from "@/lib/progressStorage";
import { useColors } from "@/hooks/useColors";
import { ProgressCalculator } from "@/lib/progressCalculator";

interface WatchlistCardProps {
  item: WatchlistItem;
}

export function WatchlistCard({ item }: WatchlistCardProps) {
  const colors = useColors();

  const handlePress = () => {
    router.push({
      pathname: "/course/learn",
      // Opens the course at the lesson to resume; the learn screen offers to
      // continue from the saved position.
      params: { courseId: item.courseId, moduleId: item.moduleId, lessonId: item.lessonId ?? item.moduleId },
    });
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
      onPress={handlePress}
    >
      <Image source={item.courseThumbnail} style={styles.thumbnail} />
      <View style={styles.content}>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Feather name="play-circle" size={10} color={colors.primary} />
          <Text style={[styles.badgeText, { color: colors.primary }]}>Continue</Text>
        </View>
        <Text style={[styles.courseTitle, { color: colors.foreground }]} numberOfLines={2}>
          {item.courseTitle}
        </Text>
        <Text style={[styles.moduleTitle, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.moduleTitle}
        </Text>
        <View style={styles.progressRow}>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${item.videoProgress.watchedPercentage}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
            {ProgressCalculator.formatTime(item.videoProgress.currentTime)}
          </Text>
        </View>
        <Text style={[styles.courseProgressText, { color: colors.mutedForeground }]}>
          Course: {item.courseProgress}% complete
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginRight: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  thumbnail: {
    width: "100%",
    height: 120,
    resizeMode: "cover",
  },
  content: {
    padding: 14,
    gap: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  courseTitle: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  moduleTitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  timeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  courseProgressText: {
    fontSize: 11,
    marginTop: -2,
  },
});
