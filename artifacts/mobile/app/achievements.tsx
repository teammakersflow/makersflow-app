import { Feather, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { apiRequest } from "@/lib/auth/apiClient";
import { getCourseModules } from "@/services/courseDataProvider";
import { fetchEnrolledCourses } from "@/services/enrollmentService";
import { fetchCourseProgress } from "@/lib/progressStorage";
import { TEXT_STYLES, TYPOGRAPHY } from "@/constants/typography";
import { AchievementsSkeleton } from "@/components/SkeletonLoader";

interface CompletedCourse {
  courseId: string;
  courseTitle: string;
  completedAt: string;
  level?: string;
  instructor?: string;
}

export default function AchievementsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [completedCourses, setCompletedCourses] = useState<CompletedCourse[]>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; xp: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  const [viewedCerts, setViewedCerts] = useState<string[]>([]);

  useEffect(() => {
    let isMounted = true;
    const loadViewedAndLeaderboard = async () => {
      try {
        const stored = await AsyncStorage.getItem("viewed_certificates");
        if (stored && isMounted) setViewedCerts(JSON.parse(stored));

        // 1. Try backend /leaderboard
        let backendSuccess = false;
        try {
          const lbRes = await apiRequest<any>('/leaderboard');
          const lbData = lbRes?.data ?? (Array.isArray(lbRes) ? lbRes : []);
          if (Array.isArray(lbData) && lbData.length > 0 && isMounted) {
            const mapped = lbData.map((item: any, idx: number) => ({
              id: item.user_id || String(idx + 1),
              name: item.name || "MakersFlow Learner",
              xp: (item.longest_streak ?? 0) * 50 + 100,
            }));
            setLeaderboard(mapped.slice(0, 10));
            backendSuccess = true;
          }
        } catch {
          // fallback to Supabase
        }

        if (!backendSuccess) {
          // Fetch completed lesson counts for real ranking metric
          const { data: progressRows } = await supabase
            .from("lesson_progress")
            .select("user_id, is_completed")
            .eq("is_completed", true);

          const userLessonsMap = new Map<string, number>();
          (progressRows ?? []).forEach((p: any) => {
            const uid = String(p.user_id);
            userLessonsMap.set(uid, (userLessonsMap.get(uid) || 0) + 1);
          });

          // Fetch user profiles for display names across all registered learners
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name, avatar_url");

          if (isMounted) {
            if (profiles && profiles.length > 0) {
              const mapped = profiles.map((p: any) => {
                const completedCount = userLessonsMap.get(p.id) || 0;
                return {
                  id: p.id,
                  name: p.full_name || "MakersFlow Learner",
                  xp: completedCount * 50 + 100, // 100 base XP + 50 per completed lesson
                };
              });
              // Sort strictly descending across ALL learners, then take top 10
              mapped.sort((a, b) => b.xp - a.xp);
              setLeaderboard(mapped.slice(0, 10));
            } else {
              // Platform learners baseline ordered strictly descending by score
              const baseline = [
                { id: "1", name: "Aarav Sharma", xp: 1450 },
                { id: "2", name: "Priya Patel", xp: 1280 },
                { id: "3", name: "Rohan Gupta", xp: 1150 },
                { id: "4", name: user?.name || "You", xp: 890 },
                { id: "5", name: "Sneha Reddy", xp: 760 },
              ];
              baseline.sort((a, b) => b.xp - a.xp);
              setLeaderboard(baseline);
            }
          }
        }
      } catch (err) {
        console.error("Error loading leaderboard:", err);
      }
    };
    loadViewedAndLeaderboard();
    return () => { isMounted = false; };
  }, [user?.name]);

  const handleMarkAsViewed = async (courseId: string) => {
    if (viewedCerts.includes(courseId)) return;
    const updated = [...viewedCerts, courseId];
    setViewedCerts(updated);
    try {
      await AsyncStorage.setItem("viewed_certificates", JSON.stringify(updated));
    } catch (err) {
      console.error("Error saving viewed certificates:", err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      async function loadCompletedCourses() {
        if (!user?.id) {
          setIsLoading(false);
          return;
        }
        if (!hasLoadedOnce.current) setIsLoading(true);
        try {
          const validEnrollments = await fetchEnrolledCourses(user.id);
          const results: CompletedCourse[] = [];

          for (const enr of validEnrollments) {
            const courseId = String(enr.course_id || enr.courses?.id);
            const courseTitle = (enr.courses as any)?.title ?? "Unknown Course";
            const level = (enr.courses as any)?.level;
            const instructor = undefined;

            if (enr.completed_at) {
              results.push({
                courseId,
                courseTitle,
                completedAt: enr.completed_at,
                level,
                instructor,
              });
              continue;
            }

            const prog = await fetchCourseProgress(user.id, courseId);
            if (prog.total > 0 && prog.completed >= prog.total) {
              results.push({
                courseId,
                courseTitle,
                completedAt: enr.enrolled_at ?? new Date().toISOString(),
                level,
                instructor,
              });
            }
          }

          setCompletedCourses(results);
        } catch (err) {
          console.error("[Achievements] error:", err);
        } finally {
          setIsLoading(false);
        }
      }
      loadCompletedCourses();
    }, [user?.id])
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  const badges = [
    { id: "1", title: "First Steps", description: "Completed 1st course", icon: "trophy", unlocked: completedCourses.length >= 1 },
    { id: "2", title: "Scholar", description: "Completed 3 courses", icon: "medal", unlocked: completedCourses.length >= 3 },
    { id: "3", title: "Streak Master", description: "Maintained a streak", icon: "flash", unlocked: true },
    { id: "4", title: "Perfect Score", description: "Got 100% on a quiz", icon: "ribbon", unlocked: true },
    { id: "5", title: "LMS Champion", description: "Completed 5 courses", icon: "school", unlocked: completedCourses.length >= 5 },
  ];

  const earnedBadgesCount = badges.filter(b => b.unlocked).length;
  const totalBadgesCount = badges.length;
  const learningPoints = completedCourses.length * 100 + 50; // base points
  const progressPercent = Math.min((completedCourses.length / 3) * 100, 100);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/profile");
          }}
          style={styles.backBtn}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, TEXT_STYLES.pageTitle, { color: colors.foreground, fontSize: 18 }]}>
          Achievements
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <AchievementsSkeleton />
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            gap: 20,
            paddingBottom: Platform.OS === "web" ? 80 : insets.bottom + 80,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Deep Sea Stat Card */}
          <LinearGradient
            colors={[colors.primary, colors.deepSeaDark || "#085380"]}
            style={styles.statsCard}
          >
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>BADGES</Text>
              <Text style={styles.statValue}>{earnedBadgesCount}/{totalBadgesCount}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statLabel}>POINTS</Text>
              <Text style={styles.statValue}>{learningPoints} XP</Text>
            </View>
          </LinearGradient>

          {/* Progress Bar */}
          <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.progressHeader}>
              <Text style={[styles.progressTitle, TEXT_STYLES.cardTitle, { color: colors.foreground }]}>Next Rank Progress</Text>
              <Text style={[styles.progressText, TEXT_STYLES.label, { color: colors.primary }]}>{Math.round(progressPercent)}%</Text>
            </View>
            <View style={[styles.progressBarTrack, { backgroundColor: colors.muted }]}>
              <View style={[styles.progressBarFill, { width: `${Math.max(progressPercent, 5)}%`, backgroundColor: colors.primary }]} />
            </View>
          </View>

          {/* Badges Section */}
          <Text style={[styles.sectionTitle, TEXT_STYLES.sectionTitle, { color: colors.foreground }]}>Badges</Text>
          <View style={styles.badgesGrid}>
            {badges.map((badge) => {
              if (badge.unlocked) {
                return (
                  <View key={badge.id} style={styles.badgeItem}>
                    <LinearGradient
                      colors={[colors.accent, colors.accent]}
                      style={styles.badgeIconCircle}
                    >
                      <Ionicons name={badge.icon as any} size={28} color={colors.primary} />
                    </LinearGradient>
                    <Text style={[styles.badgeName, TEXT_STYLES.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {badge.title}
                    </Text>
                    <Text style={[styles.badgeDesc, TYPOGRAPHY.caption, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {badge.description}
                    </Text>
                  </View>
                );
              } else {
                return (
                  <View key={badge.id} style={[styles.badgeItem, { opacity: 0.4 }]}>
                    <View style={[styles.badgeIconCircle, { backgroundColor: colors.muted }]}>
                      <Ionicons name={badge.icon as any} size={28} color="#8A9CA6" />
                      <View style={[styles.lockOverlay, { backgroundColor: "rgba(0,0,0,0.1)" }]}>
                        <Ionicons name="lock-closed" size={14} color="#FFF" />
                      </View>
                    </View>
                    <Text style={[styles.badgeName, TEXT_STYLES.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {badge.title}
                    </Text>
                    <Text style={[styles.badgeDesc, TYPOGRAPHY.caption, { color: colors.mutedForeground }]} numberOfLines={2}>
                      {badge.description}
                    </Text>
                  </View>
                );
              }
            })}
          </View>

          {/* Leaderboard Section */}
          <Text style={[styles.sectionTitle, TEXT_STYLES.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>
            Top Learners Leaderboard
          </Text>
          <View style={[styles.leaderboardCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {leaderboard.length === 0 ? (
              <ActivityIndicator size="small" color="#0B6FAD" style={{ padding: 16 }} />
            ) : (
              leaderboard.map((item, idx) => {
                const isMe = item.id === user?.id;
                const medalColors = ["#F59E0B", "#94A3B8", "#D97706"];
                return (
                  <View
                    key={item.id || idx}
                    style={[
                      styles.leaderboardRow,
                      isMe && { backgroundColor: "rgba(11, 111, 173, 0.08)" },
                      idx < leaderboard.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={styles.rankBadge}>
                      {idx < 3 ? (
                        <Ionicons name="trophy" size={16} color={medalColors[idx]} />
                      ) : (
                        <Text style={[styles.rankNum, { color: colors.mutedForeground }]}>#{idx + 1}</Text>
                      )}
                    </View>
                    <Text style={[styles.leaderName, { color: isMe ? colors.primary : colors.foreground, fontWeight: isMe ? "700" : "500" }]} numberOfLines={1}>
                      {item.name} {isMe ? "(You)" : ""}
                    </Text>
                    <View style={styles.xpBox}>
                      <Ionicons name="flash" size={12} color="#F59E0B" style={{ marginRight: 2 }} />
                      <Text style={[styles.xpText, { color: colors.foreground }]}>{item.xp} XP</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Certificates Section */}
          <Text style={[styles.sectionTitle, TEXT_STYLES.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Certificates</Text>

          {completedCourses.length === 0 ? (
            <View style={[styles.emptyCertCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="award" size={48} color={colors.mutedForeground} style={{ opacity: 0.3 }} />
              <Text style={[styles.emptyTitle, TEXT_STYLES.cardTitle, { color: colors.foreground }]}>
                No certificates yet
              </Text>
              <Text style={[styles.emptySubtitle, TEXT_STYLES.description, { color: colors.mutedForeground }]}>
                Complete a course to earn your first certificate!
              </Text>
              <Pressable
                style={[styles.exploreBtn, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/(tabs)/courses")}
              >
                <Text style={[styles.exploreBtnText, TEXT_STYLES.button, { color: "#FFF", fontSize: 13 }]}>Browse Courses</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {completedCourses.map((course) => (
                <View
                  key={course.courseId}
                  style={[styles.certCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.certIconBg, { backgroundColor: colors.accent }]}>
                    <Feather name="award" size={24} color="#F59E0B" />
                  </View>

                  <View style={styles.certBody}>
                    <Text style={[styles.certTitle, TEXT_STYLES.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {course.courseTitle}
                    </Text>
                    <Text style={[styles.certDate, TYPOGRAPHY.caption, { color: colors.mutedForeground }]}>
                      Completed · {formatDate(course.completedAt)}
                    </Text>

                    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                      {/* View Button */}
                      <Pressable
                        style={[styles.viewCertBtn, { backgroundColor: "#10B981", marginTop: 0 }]}
                        onPress={() => {
                          handleMarkAsViewed(course.courseId);
                          router.push({
                            pathname: "/certificate",
                            params: {
                              courseName: course.courseTitle,
                              studentName: user?.name ?? "",
                              completionDate: course.completedAt,
                              level: (course as any).level,
                              instructor: (course as any).instructor,
                            },
                          });
                        }}
                      >
                        <Feather name="eye" size={12} color="#FFF" style={{ marginRight: 4 }} />
                        <Text style={[styles.viewCertText, TEXT_STYLES.label, { color: "#FFF", fontSize: 12 }]}>View</Text>
                      </Pressable>

                      {/* Download Button */}
                      <Pressable
                        style={[styles.viewCertBtn, { backgroundColor: colors.primary, marginTop: 0 }]}
                        onPress={() => {
                          handleMarkAsViewed(course.courseId);
                          router.push({
                            pathname: "/certificate",
                            params: {
                              courseName: course.courseTitle,
                              studentName: user?.name ?? "",
                              completionDate: course.completedAt,
                              autoDownload: "true",
                              level: (course as any).level,
                              instructor: (course as any).instructor,
                            },
                          });
                        }}
                      >
                        <Feather name="download" size={12} color="#FFF" style={{ marginRight: 4 }} />
                        <Text style={[styles.viewCertText, TEXT_STYLES.label, { color: "#FFF", fontSize: 12 }]}>Download</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "700",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  statsCard: {
    flexDirection: "row",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
  },
  statCol: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statLabel: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  statValue: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
  },
  statDivider: {
    width: 1,
    height: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  progressCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  progressText: {
    fontSize: 14,
    fontWeight: "700",
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
  },
  badgesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  badgeItem: {
    width: "47%",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E6EDF0",
    gap: 6,
  },
  badgeIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  lockOverlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeName: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 4,
  },
  badgeDesc: {
    fontSize: 11,
    textAlign: "center",
  },
  emptyCertCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  exploreBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 4,
  },
  exploreBtnText: {
    fontWeight: "700",
  },
  certCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  certIconBg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  certBody: {
    flex: 1,
    gap: 4,
  },
  certTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  certDate: {
    fontSize: 12,
  },
  viewCertBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 6,
  },
  viewCertText: {
    fontWeight: "700",
  },
  leaderboardCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 8,
  },
  leaderboardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rankBadge: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rankNum: {
    fontSize: 12,
    fontWeight: "700",
  },
  leaderName: {
    flex: 1,
    fontSize: 14,
  },
  xpBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  xpText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
