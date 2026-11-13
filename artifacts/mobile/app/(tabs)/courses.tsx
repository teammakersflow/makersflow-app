import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, Platform, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { CourseProgressCard } from "@/components/CourseProgressCard";
import { CourseCardSkeleton } from "@/components/SkeletonLoader";
import { CourseCard } from "@/components/CourseCard";
import { coursesRepository } from "@/repositories/coursesRepository";
import { useNetwork } from "@/context/NetworkContext";
import { useTabSwipe } from "@/hooks/useTabSwipe";
import { getProgressVersion } from "@/lib/courseCompletion";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";

export default function CoursesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { panHandlers, SwipeIndicator } = useTabSwipe("/(tabs)/courses");
  const { user, isOffline } = useAuth();
  const { addReconnectListener } = useNetwork();

  const [isLoading, setIsLoading] = useState(true);
  const [isInProgressOpen, setIsInProgressOpen] = useState(true);
  const [isNotStartedOpen, setIsNotStartedOpen] = useState(true);
  const [isCompletedOpen, setIsCompletedOpen] = useState(true);
  const [enrolledCourses, setEnrolledCourses] = useState<any[]>([]);
  const [browseMoreCourses, setBrowseMoreCourses] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // The last load failed: what is shown (if anything) is saved data.
  const [loadError, setLoadError] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Debounce ref — prevents rapid reconnect events from triggering repeated refreshes
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnce = useRef(false);
  const previousUserId = useRef(user?.id);
  const requestGenerationRef = useRef(0);
  const loadedProgressVersion = useRef(getProgressVersion());

  useEffect(() => {
    if (previousUserId.current !== user?.id) {
      previousUserId.current = user?.id;
      requestGenerationRef.current += 1;
      hasLoadedOnce.current = false;
      setRefreshing(false);
      setEnrolledCourses([]);
    }
  }, [user?.id]);

  // ── Single repository call — screen does not know data origin ─────────────
  const loadData = useCallback(async (isRefreshing = false) => {
    const requestId = ++requestGenerationRef.current;
    const requestUserId = user?.id;
    loadedProgressVersion.current = getProgressVersion();

    if (!isRefreshing && !hasLoadedOnce.current) setIsLoading(true);
    try {
      const result = await coursesRepository.get(
        requestUserId,
        isOffline,
        isRefreshing,
        (bgData) => {
          if (
            requestId !== requestGenerationRef.current ||
            requestUserId !== previousUserId.current
          ) return;

          setEnrolledCourses(bgData.enrollments);
          setBrowseMoreCourses(bgData.catalog);
          setLoadError(false);
        }
      );

      if (
        requestId !== requestGenerationRef.current ||
        requestUserId !== previousUserId.current
      ) return;

      if (result.error) {
        // Failed request: never replace what is shown with an empty list.
        setLoadError(true);
        setEnrolledCourses((prev) => (result.data.enrollments.length > 0 || prev.length === 0 ? result.data.enrollments : prev));
        setBrowseMoreCourses((prev) => (result.data.catalog.length > 0 || prev.length === 0 ? result.data.catalog : prev));
      } else {
        setLoadError(false);
        setEnrolledCourses(result.data.enrollments);
        setBrowseMoreCourses(result.data.catalog);
      }
      hasLoadedOnce.current = true;
    } catch (err) {
      if (requestId === requestGenerationRef.current) {
        console.error('[CoursesScreen] loadData error:', err);
        setLoadError(true);
      }
    } finally {
      if (requestId === requestGenerationRef.current) {
        setIsLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.id, isOffline]);

  // ── Reconnect listener with debounce (prevents rapid refresh storms) ──────
  useEffect(() => {
    const unsubscribe = addReconnectListener(() => {
      if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
      reconnectDebounceRef.current = setTimeout(() => {
        loadData(true);
      }, 1500);
    });
    return () => {
      unsubscribe();
      if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
    };
  }, [addReconnectListener, loadData]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) {
        loadData(false); // first load only — cached after that
      } else if (loadedProgressVersion.current !== getProgressVersion()) {
        // A lesson was completed or a course enrolled since the last load
        // (e.g. the final lesson on the learn screen): reload so progress and
        // the Completed section are current without a pull-to-refresh.
        loadData(true);
      }
      // Otherwise no refetch on tab switch — use pull-to-refresh for fresh data
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
  };

  // Completion follows the backend rule (lib/courseCompletion.ts); entries
  // cached by an older build have no isCompleted and fall back to 100%.
  const isDone = (c: any) => (typeof c.isCompleted === "boolean" ? c.isCompleted : c.progress === 100);

  const inProgressCourses = useMemo(() => {
    return enrolledCourses.filter((c) => !isDone(c) && c.progress > 0);
  }, [enrolledCourses]);

  const notStartedCourses = useMemo(() => {
    return enrolledCourses.filter((c) => !isDone(c) && !(c.progress > 0));
  }, [enrolledCourses]);

  const completedCourses = useMemo(() => {
    return enrolledCourses.filter((c) => isDone(c));
  }, [enrolledCourses]);

  const filteredBrowseCourses = useMemo(() => {
    if (selectedCategory === "All") return browseMoreCourses;
    return browseMoreCourses.filter(c => c.category.toLowerCase() === selectedCategory.toLowerCase());
  }, [browseMoreCourses, selectedCategory]);

  const totalEnrolled = enrolledCourses.length;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panHandlers}>
      <SwipeIndicator />
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.titleRow}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>
              {user ? "My Courses" : "Explore Courses"}
            </Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {user ? `${totalEnrolled} enrolled` : "Explore our technical catalog"}
            </Text>
          </View>
          <Pressable
            style={[styles.cartBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push("/(tabs)/store")}
          >
            <Ionicons name="cart" size={20} color="#0B6FAD" />
          </Pressable>
        </View>
      </View>

      {/* Category filter chips row */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsScroll}
        >
          {["All", "Robotics", "IoT", "Coding", "Embedded Systems"].map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: isActive ? colors.primary : colors.card,
                    borderColor: isActive ? "transparent" : colors.border,
                  }
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                {isActive && (
                  <Ionicons name="checkmark" size={14} color="#FFF" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color: isActive ? "#FFF" : colors.mutedForeground,
                      fontFamily: isActive ? "Inter_600SemiBold" : "Inter_400Regular",
                    }
                  ]}
                >
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0B6FAD']} />
        }
      >
        {isLoading ? (
          <View style={[styles.browseSection, { marginTop: 8 }]}>
            <View style={styles.gridContainer}>
              <CourseCardSkeleton />
              <CourseCardSkeleton />
              <CourseCardSkeleton />
              <CourseCardSkeleton />
            </View>
          </View>
        ) : (
          <>
            {!user ? (
              <View style={[styles.guestBanner, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                <View style={styles.guestBannerHeader}>
                  <Ionicons name="information-circle" size={18} color={colors.accentForeground} />
                  <Text style={[styles.guestBannerTitle, { color: colors.foreground }]}>Sign in to track progress</Text>
                </View>
                <Text style={[styles.guestBannerText, { color: colors.mutedForeground }]}>
                  Log in to see your enrolled courses, certificates, and continue learning where you left off.
                </Text>
                <Pressable
                  style={[styles.guestBtn, { backgroundColor: "#0B6FAD" }]}
                  onPress={() => router.push("/(auth)/login")}
                >
                  <Text style={styles.guestBtnText}>Sign In</Text>
                </Pressable>
              </View>
            ) : totalEnrolled === 0 && loadError ? (
              // A failed request is not "no enrolled courses".
              <LoadErrorNotice
                variant="card"
                message="We couldn't load your courses. Check your connection and try again."
                onRetry={onRefresh}
                retrying={refreshing}
              />
            ) : totalEnrolled === 0 ? (
              <View style={[styles.emptyEnrolledCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="book" size={32} color={colors.mutedForeground} style={{ opacity: 0.5, marginBottom: 8 }} />
                <Text style={[styles.emptyEnrolledText, { color: colors.mutedForeground }]}>
                  No enrolled courses yet. Choose a course from "Explore Courses" below to start learning!
                </Text>
              </View>
            ) : (
              <>
                {loadError && (
                  <View style={{ marginBottom: 12 }}>
                    <LoadErrorNotice
                      message="Couldn't refresh your courses. Showing what was last loaded."
                      onRetry={onRefresh}
                      retrying={refreshing}
                    />
                  </View>
                )}
                {/* IN PROGRESS SECTION */}
                <View style={styles.section}>
                  <Pressable
                    style={[styles.sectionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => setIsInProgressOpen(!isInProgressOpen)}
                  >
                    <View style={styles.sectionLeft}>
                      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                        In Progress
                      </Text>
                      <View style={[styles.countBadge, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.countText, { color: colors.accentForeground }]}>
                          {inProgressCourses.length}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name={isInProgressOpen ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                  {isInProgressOpen && (
                    <View style={styles.sectionContent}>
                      {inProgressCourses.length === 0 ? (
                        <Text style={[styles.emptySection, { color: colors.mutedForeground }]}>
                          Start a lesson to see progress here
                        </Text>
                      ) : (
                        inProgressCourses.map((course) => (
                          <CourseProgressCard key={course.courseId} course={course} />
                        ))
                      )}
                    </View>
                  )}
                </View>

                {/* NOT STARTED SECTION */}
                {notStartedCourses.length > 0 && (
                  <View style={styles.section}>
                    <Pressable
                      style={[styles.sectionHeader, { borderBottomColor: colors.border }]}
                      onPress={() => setIsNotStartedOpen(!isNotStartedOpen)}
                    >
                      <View style={styles.sectionLeft}>
                        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                          Not Started
                        </Text>
                        <View style={[styles.countBadge, { backgroundColor: colors.accent }]}>
                          <Text style={[styles.countText, { color: colors.accentForeground }]}>
                            {notStartedCourses.length}
                          </Text>
                        </View>
                      </View>
                      <Ionicons
                        name={isNotStartedOpen ? "chevron-up" : "chevron-down"}
                        size={20}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                    {isNotStartedOpen && (
                      <View style={styles.sectionContent}>
                        {notStartedCourses.map((course) => (
                          <CourseProgressCard key={course.courseId} course={course} />
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* COMPLETED SECTION */}
                <View style={styles.section}>
                  <Pressable
                    style={[styles.sectionHeader, { borderBottomColor: colors.border }]}
                    onPress={() => setIsCompletedOpen(!isCompletedOpen)}
                  >
                    <View style={styles.sectionLeft}>
                      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                        Completed
                      </Text>
                      <View style={[styles.countBadge, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.countText, { color: colors.accentForeground }]}>
                          {completedCourses.length}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name={isCompletedOpen ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                  {isCompletedOpen && (
                    <View style={styles.sectionContent}>
                      {completedCourses.length === 0 ? (
                        <Text style={[styles.emptySection, { color: colors.mutedForeground }]}>
                          Complete a course to see it here
                        </Text>
                      ) : (
                        completedCourses.map((course) => (
                          <CourseProgressCard key={course.courseId} course={course} />
                        ))
                      )}
                    </View>
                  )}
                </View>
              </>
            )}

            {/* BROWSE MORE SUBSECTION */}
            {filteredBrowseCourses.length > 0 && (
              <View style={[styles.browseSection, { marginTop: 24 }]}>
                <Text style={[styles.browseTitle, { color: colors.foreground }]}>
                  {user ? "Explore More Courses" : "Explore Courses"}
                </Text>
                <View style={styles.gridContainer}>
                  {filteredBrowseCourses.map((course) => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: "Fredoka_700Bold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  cartBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
  },
  scroll: {
    paddingTop: 16,
  },
  section: {
    marginBottom: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sectionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  countBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  countText: {
    fontSize: 12,
    fontFamily: "Fredoka_700Bold",
  },
  sectionContent: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  emptySection: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    paddingLeft: 16,
    paddingVertical: 12,
  },
  skeletonContainer: {
    paddingHorizontal: 20,
    gap: 12,
    paddingTop: 8,
  },
  emptyEnrolledCard: {
    marginHorizontal: 20,
    marginVertical: 10,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyEnrolledText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  browseSection: {
    paddingBottom: 24,
  },
  browseTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
    marginLeft: 20,
    marginBottom: 16,
  },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    justifyContent: "space-between",
    rowGap: 16,
  },
  guestBanner: {
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  guestBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  guestBannerTitle: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  guestBannerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  guestBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 4,
  },
  guestBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  
  // Custom filter chips styling
  filterChipsScroll: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 13,
  },
});
