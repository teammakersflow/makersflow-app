import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import React, { useRef, useMemo, useState, useEffect, useCallback } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useProgress } from "@/context/ProgressContext";
import { fetchAllCourses, getCourseModules, fetchLessonDurations } from "@/services/courseDataProvider";
import { useColors } from "@/hooks/useColors";
import { ProgressAnalytics } from "@/lib/progressAnalytics";
import { ProgressStats } from "@/components/ProgressStats";
import { WatchlistCard } from "@/components/WatchlistCard";
import { SectionHeader } from "@/components/SectionHeader";
import { useAuth } from "@/context/AuthContext";
import { fetchEnrolledCourses } from "@/services/enrollmentService";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/auth/apiClient";
import { ProgressCalculator } from "@/lib/progressCalculator";
import { HomeSkeleton } from "@/components/SkeletonLoader";
import { fetchCourseProgress, fetchCourseLessonsProgress } from "@/lib/progressStorage";

function formatTotalTime(totalMinutes: number): string {
  const minutes = Math.round(totalMinutes);
  if (minutes < 60) return `${minutes} min`;
  const hours = totalMinutes / 60;
  return `${hours.toFixed(1)} hrs`;
}

const MOCK_LEADERBOARD = [
  { rank: 1, name: "Aarav Sharma", points: 2840, isSelf: false },
  { rank: 2, name: "Ishaan Patel", points: 2610, isSelf: false },
  { rank: 3, name: "Sneha Reddy", points: 2450, isSelf: false },
  { rank: 12, name: "You (Student)", points: 1280, isSelf: true },
];

export default function ProgressScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { courseProgress, watchlist } = useProgress();
  const { user } = useAuth();
  const [currentTab, setCurrentTab] = useState<"courses" | "stats" | "leaderboard">("courses");
  const [selectedDay, setSelectedDay] = useState<{
    day: string;
    minutes: number;
    lessonsCompleted: number;
    index: number;
  } | null>(null);

  const [courses, setCourses] = useState<any[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [enrolledCoursesProgress, setEnrolledCoursesProgress] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<any>({
    totalCoursesEnrolled: 0,
    coursesCompleted: 0,
    coursesInProgress: 0,
    totalLessonsCompleted: 0,
    averageProgress: 0,
    totalTimeSpent: 0,
    learningStreak: 0,
    weeklyActivity: [],
    recentlyCompleted: [],
  });

  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);

  const loadStatsAndCourses = useCallback(async (isRefreshing = false) => {
    if (!user?.id) {
      setIsLoadingCourses(false);
      return;
    }
    if (!isRefreshing) {
      setIsLoadingCourses(true);
    }
    try {
      const all = await fetchAllCourses();
      const mapped = all.map((c: any) => ({
        id: String(c.id),
        title: c.title,
        category: c.category || "General",
        level: c.level ? (c.level.charAt(0).toUpperCase() + c.level.slice(1)) : "Beginner",
        price: c.price || 0,
        isFree: c.is_free,
        thumbnail: c.thumbnail_url ? { uri: c.thumbnail_url } : require('@/assets/images/courses/course_robotics.webp'),
        instructor: "MakersFlow Instructor",
        rating: 4.8,
        reviews: 120,
        description: c.description || "",
        modules: []
      }));
      setCourses(mapped);

      const enrollments = await fetchEnrolledCourses(user.id);
      const totalCoursesEnrolled = enrollments.length;
      setEnrolledCount(totalCoursesEnrolled);

      const progressList: any[] = [];
      let completedCoursesCount = 0;
      let coursesInProgress = 0;
      let progressSum = 0;
      const enrolledProgressList = [];

      for (const enr of enrollments) {
        const courseId = String(enr.course_id);
        const courseDetails = mapped.find((c: any) => c.id === courseId);
        if (!courseDetails) continue;

        // Use same fetchCourseProgress function
        const prog = await fetchCourseProgress(user.id, courseId);
        const courseProgPct = prog.percentage;

        try {
          const lessons = await fetchCourseLessonsProgress(user.id, courseId);
          lessons.forEach((lp: any) => {
            progressList.push({
              course_id: Number(courseId),
              lesson_id: Number(lp.lesson_id),
              time_spent_secs: lp.time_spent_secs || lp.current_time_secs || 0,
              is_completed: lp.is_completed,
              last_watched_at: lp.last_watched_at,
            });
          });
        } catch {
          // ignore
        }

        progressSum += courseProgPct;

        if (enr.completed_at !== null) {
          completedCoursesCount++;
        }

        if (courseProgPct > 0 && courseProgPct < 100) {
          coursesInProgress++;
        }

        enrolledProgressList.push({
          courseId,
          courseTitle: courseDetails.title,
          thumbnail: courseDetails.thumbnail,
          progress: courseProgPct,
        });
      }
      setEnrolledCoursesProgress(enrolledProgressList);

      const averageProgress = totalCoursesEnrolled > 0 ? Math.round(progressSum / totalCoursesEnrolled) : 0;

      // Fetch the published duration of every lesson the user has touched so
      // learning time reflects real lesson durations (dynamic, not estimates).
      const touchedLessonIds = Array.from(new Set(progressList.map((p) => p.lesson_id).filter(Boolean)));
      const lessonDurationSecs = touchedLessonIds.length > 0
        ? await fetchLessonDurations(touchedLessonIds)
        : new Map<number, number>();

      // Credited time per lesson: completed lessons count their full published
      // duration; in-progress lessons count actual watch time.
      const creditedSecs = (p: any): number => {
        const watched = p.time_spent_secs || 0;
        const duration = lessonDurationSecs.get(Number(p.lesson_id)) || 0;
        return p.is_completed ? Math.max(watched, duration) : watched;
      };

      const totalTimeSpentSecs = progressList.reduce((sum, p) => sum + creditedSecs(p), 0);
      const totalTimeSpent = totalTimeSpentSecs / 60;
      const totalLessonsCompleted = progressList.filter((p) => p.is_completed).length;
      // calculateStreak returns { current, longest } — rendering the raw
      // object as a React child crashes the screen, so extract the number.
      const streakResult = ProgressCalculator.calculateStreak(progressList);
      let learningStreak = streakResult?.current ?? 0;
      try {
        const streakRes = await apiRequest<any>('/streaks/me');
        const sData = streakRes?.data ?? streakRes;
        if (sData && typeof sData.current_streak === 'number') {
          learningStreak = sData.current_streak;
        }
      } catch {
        // Fall back to locally computed streak
      }

      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weeklyActivity = [];
      const now = new Date();

      for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const dayName = days[date.getDay()];
        const dateString = date.toDateString();

        const dayProgress = progressList.filter(p => {
          if (!p.last_watched_at) return false;
          return new Date(p.last_watched_at).toDateString() === dateString;
        });

        const dayMinutes = dayProgress.reduce((sum, p) => sum + creditedSecs(p), 0) / 60;
        const dayCompleted = dayProgress.filter(p => p.is_completed).length;

        weeklyActivity.push({
          day: dayName,
          minutes: Math.round(dayMinutes),
          lessonsCompleted: dayCompleted,
        });
      }

      const moduleCache = new Map<string, any[]>();
      const getCachedModules = async (courseId: string) => {
        if (!moduleCache.has(courseId)) {
          moduleCache.set(courseId, await getCourseModules(courseId));
        }
        return moduleCache.get(courseId);
      };

      const recentlyCompleted: any[] = [];
      for (const p of progressList) {
        if (p.is_completed && p.last_watched_at) {
          const course = mapped.find((c: any) => c.id === String(p.course_id));
          if (!course) continue;

          const courseModules = await getCachedModules(String(p.course_id)) || [];
          const matchedModule = courseModules.find((m: any) => (m.lessons ?? []).some((l: any) => l.id === p.lesson_id));

          if (matchedModule) {
            recentlyCompleted.push({
              courseId: course.id,
              courseTitle: course.title,
              moduleId: matchedModule.id,
              moduleTitle: matchedModule.title,
              completedAt: p.last_watched_at,
              courseThumbnail: course.thumbnail,
            });
          }
        }
      }
      recentlyCompleted.sort((a: any, b: any) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
      const topRecentlyCompleted = recentlyCompleted.slice(0, 10);

      setStats({
        totalCoursesEnrolled,
        coursesCompleted: completedCoursesCount,
        coursesInProgress,
        totalLessonsCompleted,
        averageProgress,
        totalTimeSpent,
        learningStreak,
        weeklyActivity,
        recentlyCompleted: topRecentlyCompleted,
      });

      // Fetch Leaderboard from Backend /leaderboard (with Supabase fallback)
      setIsLoadingLeaderboard(true);
      try {
        let backendLeaderboardSuccess = false;
        try {
          const lbRes = await apiRequest<any>('/leaderboard');
          const lbData = lbRes?.data ?? (Array.isArray(lbRes) ? lbRes : []);
          if (Array.isArray(lbData) && lbData.length > 0) {
            const mapped = lbData.map((item: any, index: number) => ({
              rank: item.rank ?? index + 1,
              name: item.name || "Unknown Student",
              points: item.longest_streak ?? 0,
              avatar: item.avatar || null,
              isSelf: item.user_id === user.id,
            }));
            setLeaderboard(mapped);
            backendLeaderboardSuccess = true;
          }
        } catch (backendLbErr) {
          console.warn('[Progress] Backend /leaderboard failed, falling back to Supabase:', backendLbErr);
        }

        if (!backendLeaderboardSuccess) {
          const { data: streakData, error: streakError } = await supabase
            .from('streaks')
            .select('user_id, longest_streak')
            .order('longest_streak', { ascending: false })
            .limit(10);

          if (!streakError && streakData && streakData.length > 0) {
            const userIds = streakData.map((s) => s.user_id);
            const { data: profilesData, error: profilesError } = await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', userIds);

            if (!profilesError && profilesData) {
              const mapped = streakData.map((s, index) => {
                const profile = profilesData.find((p) => p.id === s.user_id);
                return {
                  rank: index + 1,
                  name: profile?.full_name || "Unknown Student",
                  points: s.longest_streak,
                  isSelf: s.user_id === user.id,
                };
              });
              setLeaderboard(mapped);
            }
          }
        }
      } catch (err) {
        console.error('[Progress] Error loading leaderboard:', err);
      } finally {
        setIsLoadingLeaderboard(false);
      }

    } catch (err) {
      console.error('[Progress] Error loading stats & courses:', err);
    } finally {
      setIsLoadingCourses(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) {
        hasLoadedOnce.current = true;   // mark loaded so we never show the skeleton again
        loadStatsAndCourses(false); // first load only — instant on return
      }
    }, [loadStatsAndCourses])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStatsAndCourses(true);
    setRefreshing(false);
  };

  const coursesWithProgress = useMemo(() => {
    return enrolledCoursesProgress;
  }, [enrolledCoursesProgress]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoadingCourses) {
    return <HomeSkeleton />;
  }

  // Guest / signed-out state — mirrors the pre-login browsing experience
  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: topPad + 16, paddingHorizontal: 20 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Your Progress</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Track your learning journey</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Ionicons name="stats-chart" size={40} color={colors.accentForeground} />
          </View>
          <Text style={{ fontFamily: 'Fredoka_700Bold', fontSize: 22, color: colors.foreground, textAlign: 'center' }}>
            Track Your Progress
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.mutedForeground, textAlign: 'center', lineHeight: 22 }}>
            Sign in to see your enrolled courses, learning streaks, weekly activity, and completion stats.
          </Text>
          <Pressable
            style={{ marginTop: 8, backgroundColor: '#0B6FAD', borderRadius: 28, paddingVertical: 14, paddingHorizontal: 40, alignItems: 'center', width: '100%' }}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#fff' }}>Sign In</Text>
          </Pressable>
          <Pressable
            style={{ borderRadius: 28, paddingVertical: 14, paddingHorizontal: 40, alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.border }}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.primary }}>Create Account</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const maxMinutes = Math.max(...stats.weeklyActivity.map((d: any) => d.minutes), 1);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: topPad + 16,
        paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0B6FAD']} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Your Progress</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Track your learning journey
          </Text>
        </View>
        <Pressable
          style={styles.cartBtn}
          onPress={() => router.push("/(tabs)/store")}
        >
          <Ionicons name="cart" size={20} color="#0B6FAD" />
        </Pressable>
      </View>

      {/* Segmented Tab Switcher */}
      <View style={styles.segmentedContainer}>
        {[
          { id: "courses", label: "Courses", icon: "book" },
          { id: "stats", label: "Progress", icon: "stats-chart" },
          { id: "leaderboard", label: "Leaderboard", icon: "trophy" }
        ].map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={[
                styles.segmentBtn,
                isActive && { backgroundColor: colors.primary }
              ]}
              onPress={() => setCurrentTab(tab.id as any)}
            >
              <Ionicons name={tab.icon as any} size={14} color={isActive ? "#FFF" : colors.mutedForeground} />
              <Text style={[styles.segmentLabel, { color: isActive ? "#FFF" : colors.mutedForeground, fontFamily: isActive ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {stats.totalCoursesEnrolled === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
            <Ionicons name="stats-chart" size={48} color={colors.accentForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Your Learning Journey Starts Here!
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Enroll in courses to track your progress and achieve your learning goals
          </Text>
          <Pressable
            style={[styles.emptyBtn, { backgroundColor: "#0B6FAD" }]}
            onPress={() => router.push("/(tabs)/courses")}
          >
            <Text style={styles.emptyBtnText}>Browse Courses</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFF" />
          </Pressable>
        </View>
      ) : (
        <>
          {currentTab === "courses" && (
            <View style={{ gap: 16 }}>
              {/* Stats Summary Grid */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 12, alignItems: "center" }}>
                  <Ionicons name="time" size={20} color="#0B6FAD" />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 4 }}>
                    {formatTotalTime(stats.totalTimeSpent)}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Study Time</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 12, alignItems: "center" }}>
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 4 }}>
                    {stats.totalLessonsCompleted}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Lessons Done</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 12, alignItems: "center" }}>
                  <Ionicons name="ribbon" size={20} color="#F59E0B" />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 4 }}>
                    {stats.coursesCompleted}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Certificates</Text>
                </View>
              </View>

              {isLoadingCourses ? (
                <ActivityIndicator color="#0B6FAD" style={{ marginTop: 20 }} />
              ) : coursesWithProgress.length > 0 ? (
                <>
                  {/* Hero Active Course Card */}
                  {coursesWithProgress[0] && (
                    <View style={{ backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1.5, borderRadius: 18, padding: 16, gap: 12 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <Image source={coursesWithProgress[0].thumbnail} style={{ width: 54, height: 54, borderRadius: 12 }} />
                        <View style={{ flex: 1 }}>
                          <View style={{ backgroundColor: "rgba(11, 111, 173, 0.1)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: "flex-start", marginBottom: 4 }}>
                            <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#0B6FAD" }}>ACTIVE COURSE</Text>
                          </View>
                          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }} numberOfLines={1}>
                            {coursesWithProgress[0].courseTitle}
                          </Text>
                        </View>
                      </View>
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>Course Progress</Text>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#0B6FAD" }}>{coursesWithProgress[0].progress}%</Text>
                        </View>
                        <View style={{ height: 8, backgroundColor: colors.muted, borderRadius: 4, overflow: "hidden" }}>
                          <LinearGradient
                            colors={["#0B6FAD", "#17E5D3"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={{ height: "100%", width: `${coursesWithProgress[0].progress}%` }}
                          />
                        </View>
                      </View>
                      <Pressable
                        style={{ backgroundColor: "#0B6FAD", borderRadius: 12, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
                        onPress={() => router.push({ pathname: "/course/[id]", params: { id: coursesWithProgress[0].courseId } })}
                      >
                        <Text style={{ color: "#FFF", fontSize: 13, fontFamily: "Inter_700Bold" }}>Continue Learning</Text>
                        <Ionicons name="play" size={14} color="#FFF" />
                      </Pressable>
                    </View>
                  )}

                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground, marginTop: 4 }}>All Enrolled Courses</Text>

                  {/* Enrolled courses with progress bars */}
                  {coursesWithProgress.map((c) => (
                    <Pressable
                      key={c.courseId}
                      style={styles.courseProgressRowCard}
                      onPress={() => router.push({ pathname: "/course/[id]", params: { id: c.courseId } })}
                    >
                      <Image source={c.thumbnail} style={styles.courseProgressThumbnail} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.courseProgressTitle, { color: colors.foreground }]}>{c.courseTitle}</Text>
                        <View style={styles.courseProgressRow}>
                          <View style={[styles.courseProgressTrack, { backgroundColor: colors.muted }]}>
                            <LinearGradient
                              colors={["#0B6FAD", "#17E5D3"]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 0 }}
                              style={[styles.courseProgressFill, { width: `${c.progress}%` }]}
                            />
                          </View>
                          <Text style={styles.courseProgressPct}>{c.progress}%</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : (
                // New user — show browse prompt
                <View style={{ alignItems: "center", paddingVertical: 40, gap: 16 }}>
                  <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="book-outline" size={40} color={colors.accentForeground} />
                  </View>
                  <Text style={[styles.emptyActivityText, { fontSize: 18, fontFamily: "Fredoka_600SemiBold", color: colors.foreground, textAlign: "center" }]}>
                    {"Your Learning Journey\nStarts Here!"}
                  </Text>
                  <Text style={[styles.emptyActivityText, { textAlign: "center", color: colors.mutedForeground }]}>
                    {"Enroll in courses to track your progress\nand achieve your learning goals"}
                  </Text>
                  <Pressable
                    style={{ backgroundColor: "#0B6FAD", paddingHorizontal: 28, paddingVertical: 14, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 8 }}
                    onPress={() => router.push("/(tabs)/courses")}
                  >
                    <Text style={{ color: "#FFF", fontSize: 16, fontFamily: "Fredoka_600SemiBold" }}>Browse Courses</Text>
                    <Ionicons name="chevron-forward" size={18} color="#FFF" />
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {currentTab === "stats" && (
            <>
              {/* Overall Progress Card */}
              <View style={[styles.overallCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.overallLeft}>
                  <Text style={[styles.overallLabel, { color: colors.mutedForeground }]}>OVERALL PROGRESS</Text>
                  <Text style={[styles.overallTitle, { color: colors.foreground }]}>Learning Journey</Text>
                  <Text style={[styles.overallDesc, { color: colors.mutedForeground }]}>
                    You've finished {stats.coursesCompleted} of {stats.totalCoursesEnrolled} course{stats.totalCoursesEnrolled !== 1 ? "s" : ""}.
                  </Text>
                </View>
                <View style={styles.overallRight}>
                  <View style={styles.circleContainer}>
                    <Svg width={80} height={80} viewBox="0 0 100 100">
                      <Defs>
                        <SvgLinearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <Stop offset="0%" stopColor="#0B6FAD" />
                          <Stop offset="100%" stopColor="#17E5D3" />
                        </SvgLinearGradient>
                      </Defs>
                      <Circle
                        cx="50"
                        cy="50"
                        r="40"
                        stroke={colors.muted}
                        strokeWidth="8"
                        fill="transparent"
                      />
                      <Circle
                        cx="50"
                        cy="50"
                        r="40"
                        stroke="url(#progressGrad)"
                        strokeWidth="8"
                        fill="transparent"
                        strokeDasharray={`${2 * Math.PI * 40}`}
                        strokeDashoffset={`${2 * Math.PI * 40 * (1 - stats.averageProgress / 100)}`}
                        strokeLinecap="round"
                        transform="rotate(-90 50 50)"
                      />
                    </Svg>
                    <View style={styles.circleTextWrapper}>
                      <Text style={[styles.circleText, { color: colors.foreground }]}>
                        {stats.averageProgress}%
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Progress Statistics Grid */}
              <View style={styles.section}>
                <ProgressStats
                  totalCoursesEnrolled={stats.totalCoursesEnrolled}
                  coursesCompleted={stats.coursesCompleted}
                  coursesInProgress={stats.coursesInProgress}
                  totalLessonsCompleted={stats.totalLessonsCompleted}
                  averageProgress={stats.averageProgress}
                  learningStreak={stats.learningStreak}
                />
              </View>

              {/* Time Spent & Learning Streak Cards */}
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.statIconWrapper, { backgroundColor: colors.accent }]}>
                    <Ionicons name="time" size={20} color={colors.accentForeground} />
                  </View>
                  <Text style={[styles.statCardValue, { color: colors.foreground }]}>
                    {formatTotalTime(stats.totalTimeSpent)}
                  </Text>
                  <Text style={[styles.statCardLabel, { color: colors.mutedForeground }]}>Total Time Spent</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={[styles.statIconWrapper, { backgroundColor: colors.accent }]}>
                    <Ionicons name="flash" size={20} color={colors.accentForeground} />
                  </View>
                  <Text style={[styles.statCardValue, { color: colors.foreground }]}>
                    {stats.learningStreak} Days
                  </Text>
                  <Text style={[styles.statCardLabel, { color: colors.mutedForeground }]}>Learning Streak</Text>
                </View>
              </View>

              {/* Weekly Activity Chart */}
              <View style={styles.section}>
                <View style={styles.activityHeader}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 4, paddingHorizontal: 0 }]}>
                      Weekly Activity
                    </Text>
                    <Text style={[styles.activitySubtitle, { color: colors.mutedForeground }]}>
                      Tap on a day to see details
                    </Text>
                  </View>
                  <View style={[styles.activityBadge, { backgroundColor: colors.accent }]}>
                    <Ionicons name="trending-up" size={14} color={colors.accentForeground} />
                    <Text style={[styles.activityBadgeText, { color: colors.accentForeground }]}>
                      {stats.weeklyActivity.reduce((sum: number, d: any) => sum + d.minutes, 0)} min
                    </Text>
                  </View>
                </View>

                <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.activityChart}>
                    {stats.weeklyActivity.map((day: any, index: number) => {
                      const height = maxMinutes > 0 ? (day.minutes / maxMinutes) * 100 : 0;
                      const hasActivity = day.minutes > 0;
                      const isSelected = selectedDay?.index === index;

                      return (
                        <Pressable
                          key={`week-${index}-${day.day}`}
                          style={styles.activityBarContainer}
                          onPress={() => {
                            if (hasActivity) {
                              setSelectedDay({ ...day, index });
                            }
                          }}
                        >
                          <View style={styles.activityBarWrapper}>
                            <View
                              style={[
                                styles.activityBar,
                                {
                                  height: `${Math.max(height, 5)}%`,
                                  backgroundColor: hasActivity 
                                    ? isSelected 
                                      ? "#0B6FAD" 
                                      : "#17E5D3"
                                    : colors.muted,
                                  transform: [{ scale: isSelected ? 1.1 : 1 }],
                                },
                              ]}
                            />
                          </View>
                          <Text
                            style={[
                              styles.activityDay,
                              {
                                color: isSelected ? "#0B6FAD" : colors.mutedForeground,
                                fontWeight: isSelected ? "700" : "600",
                              },
                            ]}
                          >
                            {day.day}
                          </Text>
                          {hasActivity && (
                            <View style={[styles.activityDot, { backgroundColor: "#0B6FAD" }]} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>

                  {selectedDay && (
                    <View style={[styles.tooltipCard, { backgroundColor: colors.accent }]}>
                      <View style={styles.tooltipHeader}>
                        <Ionicons name="calendar" size={16} color={colors.accentForeground} />
                        <Text style={[styles.tooltipDay, { color: colors.foreground }]}>
                          {selectedDay.day}
                        </Text>
                      </View>
                      <View style={styles.tooltipStats}>
                        <View style={styles.tooltipStat}>
                          <Ionicons name="time" size={14} color={colors.mutedForeground} />
                          <Text style={[styles.tooltipStatText, { color: colors.foreground }]}>
                            {selectedDay.minutes} minutes
                          </Text>
                        </View>
                        <View style={styles.tooltipStat}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.mutedForeground} />
                          <Text style={[styles.tooltipStatText, { color: colors.foreground }]}>
                            {selectedDay.lessonsCompleted} lesson{selectedDay.lessonsCompleted !== 1 ? "s" : ""}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Achievement Badges Section */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: 20, color: colors.foreground }]}>Achievement Badges</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.badgesScroll}
                >
                  {[
                    { id: "1", title: "First Step", desc: "Start learning", earned: stats.totalLessonsCompleted > 0, icon: "trophy" },
                    { id: "2", title: "Streak Master", desc: "3 Days streak", earned: stats.learningStreak >= 3, icon: "ribbon" },
                    { id: "3", title: "Graduate", desc: "Complete 1 course", earned: stats.coursesCompleted > 0, icon: "medal" },
                    { id: "4", title: "Fast Track", desc: "Spend 2 hours", earned: stats.totalTimeSpent >= 120, icon: "star" },
                  ].map((badge) => (
                    <View
                      key={badge.id}
                      style={[
                        styles.badgeCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: badge.earned ? "#17E5D3" : colors.border,
                          opacity: badge.earned ? 1 : 0.55,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.badgeIconCircle,
                          {
                            backgroundColor: badge.earned ? colors.accent : colors.muted,
                          },
                        ]}
                      >
                        <Ionicons
                          name={badge.icon as any}
                          size={22}
                          color={badge.earned ? colors.accentForeground : colors.mutedForeground}
                        />
                      </View>
                      <Text style={[styles.badgeTitle, { color: colors.foreground }]}>{badge.title}</Text>
                      <Text style={[styles.badgeDesc, { color: colors.mutedForeground }]}>{badge.desc}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>

              {/* shortcut */}
              <View style={styles.section}>
                <Pressable
                  style={[styles.coursesShortcut, { backgroundColor: colors.accent, borderColor: colors.secondary }]}
                  onPress={() => router.push("/(tabs)/courses")}
                >
                  <Ionicons name="book" size={20} color={colors.accentForeground} />
                  <View style={styles.coursesShortcutText}>
                    <Text style={[styles.coursesShortcutTitle, { color: colors.accentForeground }]}>
                      My Enrolled Courses
                    </Text>
                    <Text style={[styles.coursesShortcutSubtitle, { color: colors.mutedForeground }]}>
                      {stats.totalCoursesEnrolled} course{stats.totalCoursesEnrolled !== 1 ? "s" : ""} enrolled
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.accentForeground} />
                </Pressable>
              </View>
            </>
          )}

          {currentTab === "leaderboard" && (
            <View style={styles.leaderboardSection}>
              <View style={styles.leaderboardHeader}>
                <Ionicons name="trophy" size={32} color="#F59E0B" />
                <Text style={[styles.leaderboardTitle, { color: colors.foreground }]}>Top Learners</Text>
              </View>
              {isLoadingLeaderboard ? (
                <ActivityIndicator color="#0B6FAD" style={{ marginTop: 20 }} />
              ) : leaderboard.length === 0 ? (
                <Text style={[styles.emptyActivityText, { color: colors.mutedForeground }]}>No leaderboard entries yet.</Text>
              ) : (
                leaderboard.map((item) => (
                  <View
                    key={item.rank}
                    style={[
                      styles.leaderboardRow,
                      item.isSelf && { backgroundColor: '#0B6FAD', borderColor: '#0B6FAD' },
                    ]}
                  >
                    <Text style={[styles.leaderboardRank, { color: colors.primary }, item.isSelf && { color: '#FFFFFF' }]}>#{item.rank}</Text>
                    <Text style={[styles.leaderboardName, { color: colors.foreground }, item.isSelf && { color: '#FFFFFF' }]}>{item.name}</Text>
                    <Text style={[styles.leaderboardPoints, { color: colors.mutedForeground }, item.isSelf && { color: '#E0F2FE' }]}>{item.points} pts</Text>
                  </View>
                ))
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 24,
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
  pageTitle: { fontSize: 26, fontFamily: "Fredoka_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold", marginBottom: 12, paddingHorizontal: 20 },
  carouselContent: { paddingLeft: 20, paddingRight: 4 },

  emptyState: {
    alignItems: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
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
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24, // pill
    minHeight: 48,
  },
  emptyBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },

  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginTop: 8,
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  statIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statCardValue: {
    fontSize: 20,
    fontFamily: "Fredoka_700Bold",
  },
  statCardLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  activityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  activitySubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  activityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  activityBadgeText: {
    fontSize: 13,
    fontFamily: "Fredoka_700Bold",
  },

  activityCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    overflow: "hidden",
  },
  activityChart: {
    flexDirection: "row",
    justifyContent: "space-between",
    height: 160,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    position: "relative",
  },
  activityBarContainer: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    position: "relative",
  },
  activityBarWrapper: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    position: "relative",
  },
  activityBar: {
    width: "70%",
    borderRadius: 6,
    minHeight: 6,
    position: "relative",
  },
  activityDay: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  activityDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: "absolute",
    bottom: -2,
  },

  tooltipCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
  },
  tooltipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  tooltipDay: {
    fontSize: 15,
    fontFamily: "Fredoka_700Bold",
  },
  tooltipStats: {
    flexDirection: "row",
    gap: 16,
  },
  tooltipStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tooltipStatText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  coursesShortcut: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 20,
    gap: 12,
  },
  coursesShortcutText: {
    flex: 1,
  },
  coursesShortcutTitle: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    marginBottom: 2,
  },
  coursesShortcutSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  // Segmented control selector styling
  segmentedContainer: {
    flexDirection: "row",
    borderRadius: 24,
    borderWidth: 1.5,
    marginHorizontal: 20,
    padding: 3,
    marginBottom: 20,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 38,
    borderRadius: 20,
  },
  segmentLabel: {
    fontSize: 13,
  },

  // Per-course progress rows: white cards
  courseProgressRowCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    gap: 12,
  },
  courseProgressThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
  courseProgressTitle: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    marginBottom: 8,
  },
  courseProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  courseProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "transparent",
    position: "relative",
    overflow: "hidden",
  },
  courseProgressFill: {
    height: "100%",
    backgroundColor: "#0B6FAD",
    borderRadius: 3,
  },
  courseProgressPct: {
    fontSize: 12,
    fontFamily: "Fredoka_700Bold",
    color: "#0B6FAD",
  },

  // Leaderboard Section styling
  leaderboardSection: {
    marginHorizontal: 20,
    gap: 12,
  },
  leaderboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  leaderboardTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
    },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  leaderboardRank: {
    fontSize: 14,
    fontFamily: "Fredoka_700Bold",
    width: 36,
  },
  leaderboardName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  leaderboardPoints: {
    fontSize: 13,
    fontFamily: "Fredoka_600SemiBold",
  },
  emptyActivityText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 20,
  },
  overallCard: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    gap: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  overallLeft: {
    flex: 1,
    gap: 4,
  },
  overallLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  overallTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
  },
  overallDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  overallRight: {
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  circleContainer: {
    position: "relative",
    width: 80,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  circleTextWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  circleText: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  badgesScroll: {
    paddingLeft: 20,
    paddingRight: 20,
    gap: 12,
    paddingVertical: 4,
  },
  badgeCard: {
    width: 120,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  badgeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTitle: {
    fontSize: 12,
    fontFamily: "Fredoka_600SemiBold",
    textAlign: "center",
  },
  badgeDesc: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    opacity: 0.8,
  },
});
