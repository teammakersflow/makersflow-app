import { coursePriceLabel } from "@/lib/courseAccess";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useFavorites } from "@/context/FavoritesContext";
import { useColors } from "@/hooks/useColors";
import { useCart } from "@/context/CartContext";

export default function FavoritesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addToCart, items: cartItems } = useCart();
  const {
    favoriteCourses,
    watchLaterLessons,
    downloadedLessons,
    removeFromWatchLater,
    removeFavoriteCourse,
    removeDownloadedLesson,
  } = useFavorites();
  const [activeTab, setActiveTab] = useState<"favorites" | "watchLater" | "downloads">("favorites");
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Favorites & Downloads</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tab Selector */}
      <View style={[styles.tabSelector, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "favorites" && { borderBottomColor: "#0B6FAD", borderBottomWidth: 2 },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab("favorites");
          }}
        >
          <Text
            style={[
              styles.tabButtonText,
              { color: activeTab === "favorites" ? "#0B6FAD" : "#5A7A8C" },
            ]}
          >
            Favorites {favoriteCourses.length > 0 ? `(${favoriteCourses.length})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "watchLater" && { borderBottomColor: "#0B6FAD", borderBottomWidth: 2 },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab("watchLater");
          }}
        >
          <Text
            style={[
              styles.tabButtonText,
              { color: activeTab === "watchLater" ? "#0B6FAD" : "#5A7A8C" },
            ]}
          >
            Watch Later {watchLaterLessons.length > 0 ? `(${watchLaterLessons.length})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabButton,
            activeTab === "downloads" && { borderBottomColor: "#0B6FAD", borderBottomWidth: 2 },
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab("downloads");
          }}
        >
          <Text
            style={[
              styles.tabButtonText,
              { color: activeTab === "downloads" ? "#0B6FAD" : "#5A7A8C" },
            ]}
          >
            Downloads {downloadedLessons.length > 0 ? `(${downloadedLessons.length})` : ""}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100,
        }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "favorites" ? (
          favoriteCourses.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: "#DCF7F4" }]}>
                <Ionicons name="heart" size={48} color="#0B6FAD" />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No favorites yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Tap the heart icon on any course to save it here
              </Text>
              <Pressable
                style={{ height: 48, marginTop: 8 }}
                onPress={() => router.push("/(tabs)/courses")}
              >
                <LinearGradient
                  colors={["#0B6FAD", "#17E5D3"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.emptyButtonGradient}
                >
                  <Text style={styles.emptyButtonText}>Browse Courses</Text>
                  <Ionicons name="chevron-forward" size={16} color="#FFF" />
                </LinearGradient>
              </Pressable>
            </View>
          ) : (
            <View style={styles.lessonsList}>
              {favoriteCourses.map((fav) => (
                <Pressable
                  key={fav.courseId}
                  style={[styles.lessonItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() =>
                    router.push({
                      pathname: "/course/[id]",
                      params: { id: fav.courseId },
                    })
                  }
                >
                  {fav.courseThumbnail ? (
                    <Image
                      source={
                        typeof fav.courseThumbnail === "string"
                          ? { uri: fav.courseThumbnail }
                          : fav.courseThumbnail
                      }
                      style={styles.lessonThumbnail}
                    />
                  ) : (
                    <View style={[styles.lessonThumbnail, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="book" size={24} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={styles.lessonInfo}>
                    <Text style={[styles.lessonCourse, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {fav.category}
                    </Text>
                    <Text style={[styles.lessonTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {fav.courseTitle}
                    </Text>
                    <Text style={[styles.lessonCourse, { color: "#0B6FAD", marginTop: 2 }]}>
                      {coursePriceLabel({ isFree: fav.isFree, price: fav.price })}
                    </Text>

                    {/* C-5: courses cannot be bought in-app; the add-to-cart action for courses was removed. */}
                  </View>
                  <Pressable
                    style={styles.removeButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      removeFavoriteCourse(fav.courseId);
                    }}
                  >
                    <Ionicons name="heart" size={18} color="#EF4444" />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )
        ) : activeTab === "watchLater" ? (
          watchLaterLessons.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: "#DCF7F4" }]}>
                <Ionicons name="bookmark" size={48} color="#0B6FAD" />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No saved lessons
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Save lessons while watching to find them here later
              </Text>
            </View>
          ) : (
            <View style={styles.lessonsList}>
              {watchLaterLessons.map((lesson) => (
                <Pressable
                  key={lesson.lessonId}
                  style={[styles.lessonItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() =>
                    router.push({
                      pathname: "/course/learn",
                      params: { courseId: lesson.courseId, lessonId: lesson.lessonId },
                    })
                  }
                >
                  {lesson.courseThumbnail ? (
                    <Image
                      source={
                        typeof lesson.courseThumbnail === "string"
                          ? { uri: lesson.courseThumbnail }
                          : lesson.courseThumbnail
                      }
                      style={styles.lessonThumbnail}
                    />
                  ) : (
                    <View style={[styles.lessonThumbnail, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                      <Ionicons name="play" size={24} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={styles.lessonInfo}>
                    <Text style={[styles.lessonCourse, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {lesson.courseTitle}
                    </Text>
                    <Text style={[styles.lessonTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {lesson.lessonTitle}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.removeButton}
                    onPress={(e) => {
                      e.stopPropagation();
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      removeFromWatchLater(lesson.lessonId);
                    }}
                  >
                    <Ionicons name="bookmark" size={18} color="#0B6FAD" />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )
        ) : downloadedLessons.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: "#DCF7F4" }]}>
              <Ionicons name="download" size={48} color="#0B6FAD" />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No downloads
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Download lessons to watch them offline
            </Text>
          </View>
        ) : (
          <View style={styles.lessonsList}>
            {downloadedLessons.map((lesson) => (
              <Pressable
                key={lesson.lessonId}
                style={[styles.lessonItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() =>
                  router.push({
                    pathname: "/course/learn",
                    params: { courseId: lesson.courseId, lessonId: lesson.lessonId },
                  })
                }
              >
                {lesson.courseThumbnail ? (
                  <Image
                    source={
                      typeof lesson.courseThumbnail === "string"
                        ? { uri: lesson.courseThumbnail }
                        : lesson.courseThumbnail
                    }
                    style={styles.lessonThumbnail}
                  />
                ) : (
                  <View style={[styles.lessonThumbnail, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="download" size={24} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={styles.lessonInfo}>
                  <Text style={[styles.lessonCourse, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {lesson.courseTitle}
                  </Text>
                  <Text style={[styles.lessonTitle, { color: colors.foreground }]} numberOfLines={2}>
                    {lesson.lessonTitle}
                  </Text>
                </View>
                <Pressable
                  style={styles.removeButton}
                  onPress={(e) => {
                    e.stopPropagation();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    removeDownloadedLesson(lesson.lessonId);
                  }}
                >
                  <Ionicons name="trash" size={18} color="#EF4444" />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
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
  tabSelector: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabButtonText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: "Fredoka_700Bold",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  lessonsList: {
    gap: 12,
  },
  lessonItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 12,
  },
  lessonThumbnail: {
    width: 70,
    height: 70,
    borderRadius: 12,
  },
  lessonInfo: {
    flex: 1,
    gap: 4,
  },
  lessonCourse: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  lessonTitle: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    lineHeight: 18,
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  moveToCartBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0B6FAD",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  moveToCartText: {
    fontSize: 12,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
});
