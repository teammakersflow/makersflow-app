import { Ionicons } from "@expo/vector-icons";
import { useTabSwipe } from "@/hooks/useTabSwipe";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { useAuth } from "@/context/AuthContextSupabase";
import { useProgress } from "@/context/ProgressContext";
import { useColors } from "@/hooks/useColors";
import { supabase } from "@/lib/supabase";
import { getCourseModules } from "@/services/courseDataProvider";
import { completeCourse } from "@/services/enrollmentService";
import { ProductCard } from "@/components/ProductCard";
import { CertificateSkeleton, WishlistSkeleton } from "@/components/SkeletonLoader";
import { Product } from "@/data/mockData";
import { useFavorites } from "@/context/FavoritesContext";
import { getAvatarSource } from "@/constants/avatars";

interface MenuItem {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
}

interface CompletedCourse {
  courseId: string;
  courseTitle: string;
  completedAt: string;
  level?: string;
  instructor?: string;
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { courseProgress } = useProgress();
  const { wishlistProductIds } = useFavorites();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [wishlistProducts, setWishlistProducts] = useState<Product[]>([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  const loadWishlistProducts = useCallback(async () => {
    if (wishlistProductIds.length === 0) {
      setWishlistProducts([]);
      return;
    }
    setWishlistLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, title, description, price, original_price, category, subcategory, thumbnail_url, in_stock')
        .in('id', wishlistProductIds.map(Number));
      if (!error && data) {
        const kitFallbacks = [
          require('@/assets/images/products/product_kit_1.webp'),
          require('@/assets/images/products/product_kit_2.webp'),
          require('@/assets/images/products/product_kit_3.webp'),
        ];
        const mapped: Product[] = data.map((row: any, idx: number) => ({
          id: String(row.id),
          title: row.title || "Untitled Product",
          category: row.category || 'physical',
          subcategory: row.subcategory || "Physical Kits",
          price: Number(row.price) || 0,
          originalPrice: Number(row.original_price) || Number(row.price) || 0,
          thumbnail: row.thumbnail_url ? { uri: row.thumbnail_url } : kitFallbacks[idx % 3],
          description: row.description || "No description available.",
          rating: 0,
          reviews: 0,
          inStock: row.in_stock === undefined ? true : Boolean(row.in_stock),
          features: [],
        }));
        setWishlistProducts(mapped);
      }
    } catch (err) {
      console.error("[Profile] Error loading wishlist products:", err);
    } finally {
      setWishlistLoading(false);
    }
  }, [wishlistProductIds]);

  useEffect(() => {
    loadWishlistProducts();
  }, [loadWishlistProducts]);

  const [completedCourses, setCompletedCourses] = useState<CompletedCourse[]>([]);
  const [viewedCerts, setViewedCerts] = useState<string[]>([]);

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
  const [certsLoading, setCertsLoading] = useState(true);
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [validCourseIds, setValidCourseIds] = useState<string[]>([]);
  const [isValidLoaded, setIsValidLoaded] = useState(false);

  const enrolledCourses = React.useMemo(() => {
    const allCourses = Array.from(courseProgress.values());
    if (!isValidLoaded) {
      return allCourses;
    }
    return allCourses.filter((c) => validCourseIds.includes(String(c.courseId)));
  }, [courseProgress, validCourseIds, isValidLoaded]);

  const avgProgress =
    enrolledCourses.length > 0
      ? Math.round(enrolledCourses.reduce((s, c) => s + c.progress, 0) / enrolledCourses.length)
      : 0;

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"password" | "confirm">("password");
  const [deleteError, setDeleteError] = useState("");
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      async function loadUnreadNotifCount() {
        if (!user?.id) return;
        try {
          const lastSeen = await AsyncStorage.getItem('announcements_last_seen');
          const [personal, broadcast] = await Promise.all([
            supabase
              .from('notifications')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('is_read', false),
            supabase
              .from('announcements')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'published')
              .gt('created_at', lastSeen ?? '1970-01-01'),
          ]);
          setUnreadNotifCount((personal.count ?? 0) + (broadcast.count ?? 0));
        } catch {
          setUnreadNotifCount(0);
        }
      }
      async function loadCompletedCourses() {
        if (!user?.id) {
          setCertsLoading(false);
          return;
        }
        setCertsLoading(true);
        try {
          const { data: enrollData, error: countError } = await supabase
            .from("enrollments")
            .select("course_id, payment_status, courses(id, is_free)")
            .eq("user_id", user.id);

          if (!countError && enrollData) {
            const valid = enrollData.filter(
              (enr: any) =>
                enr.courses &&
                (!enr.payment_status ||
                  ['completed', 'free', 'paid', 'active', 'success'].includes(enr.payment_status) ||
                  enr.courses.is_free === true)
            );
            setEnrolledCount(valid.length);
            setValidCourseIds(valid.map((enr) => String(enr.course_id)));
            setIsValidLoaded(true);
          }

          const { data: enrollments } = await supabase
            .from("enrollments")
            .select("course_id, completed_at, enrolled_at, payment_status, courses(title, is_free, level, instructor_id)")
            .eq("user_id", user.id);

          if (!enrollments) { setCertsLoading(false); return; }

          const validEnrollments = enrollments.filter(
            (enr: any) =>
              enr.courses &&
              (!enr.payment_status ||
                ['completed', 'free', 'paid', 'active', 'success'].includes(enr.payment_status) ||
                enr.courses.is_free === true)
          );

          const { data: progressData } = await supabase
            .from("lesson_progress")
            .select("course_id, lesson_id, is_completed")
            .eq("user_id", user.id);

          const progressList = progressData ?? [];
          const results: CompletedCourse[] = [];

          for (const enr of validEnrollments) {
            const courseId = String(enr.course_id);
            const courseTitle = (enr.courses as any)?.title ?? "Unknown Course";
            const level = (enr.courses as any)?.level;
            const instructor = undefined;

            if (enr.completed_at) {
              results.push({ courseId, courseTitle, completedAt: enr.completed_at, level, instructor });
              continue;
            }

            const modules = await getCourseModules(courseId);
            const allLessonIds = modules.flatMap((m: any) =>
              (m.lessons ?? []).map((l: any) => String(l.id))
            );
            if (allLessonIds.length === 0) continue;

            const completedIds = progressList
              .filter((p) => p.is_completed && String(p.course_id) === courseId)
              .map((p) => String(p.lesson_id));

            const allDone = allLessonIds.every((id: string) => completedIds.includes(id));
            if (allDone) {
              // Auto-persist completed_at to DB so future queries find it on the enrollment row
              completeCourse(user.id, courseId).catch(() => {});
              results.push({
                courseId,
                courseTitle,
                completedAt: enr.enrolled_at ?? '',
                level,
                instructor,
              });
            }
          }
          setCompletedCourses(results);
        } catch (err) {
          console.error("[Profile] loadCompletedCourses error:", err);
        } finally {
          setCertsLoading(false);
        }
      }
      async function loadViewedCerts() {
        try {
          const stored = await AsyncStorage.getItem("viewed_certificates");
          if (stored) {
            setViewedCerts(JSON.parse(stored));
          }
        } catch (err) {
          console.error("Error loading viewed certificates:", err);
        }
      }
      loadCompletedCourses();
      loadViewedCerts();
      loadWishlistProducts();
      loadUnreadNotifCount();
    }, [user?.id, loadWishlistProducts])
  );

  function handleLogout() {
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Are you sure you want to sign out?");
      if (confirmed) {
        logout().catch(() => {
          alert("Failed to sign out. Please try again.");
        });
      }
    } else {
      Alert.alert(
        "Sign Out",
        "Are you sure you want to sign out?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: async () => {
              try {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await logout();
                // Stay on the current screen — app remains browsable just like before login
                router.replace("/(tabs)");
              } catch (error) {
                console.error("Logout error:", error);
              }
            },
          },
        ],
        { cancelable: false }
      );
    }
  }

  const handleDeleteRequest = () => {
    setDeletePassword("");
    setDeleteError("");
    setDeleteStep("password");
    setDeleteModalVisible(true);
  };

  const handleVerifyPassword = async () => {
    if (!deletePassword) {
      setDeleteError("Please enter your password");
      return;
    }
    setIsDeleting(true);
    setDeleteError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password: deletePassword,
      });
      if (error) throw error;
      setDeleteStep("confirm");
    } catch (err: any) {
      setDeleteError(err.message || "Incorrect password");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError("");
    try {
      if (user?.avatar && user.avatar.includes("supabase.co") && user.avatar.includes("avatars")) {
        const urlParts = user.avatar.split("/");
        const filename = urlParts[urlParts.length - 1];
        await supabase.storage.from("avatars").remove([filename]);
      }

      const { error: rpcError } = await supabase.rpc("delete_account");
      if (rpcError) throw rpcError;

      setDeleteModalVisible(false);
      await logout();
      router.replace("/(tabs)");
    } catch (err: any) {
      console.error("Delete account error:", err);
      setDeleteError(err.message || "Failed to delete account. Please contact support.");
      setIsDeleting(false);
    }
  };

  const learningMenuItems: MenuItem[] = [
    { icon: "book", label: "My Courses", onPress: () => router.push("/(tabs)/courses") },
    { icon: "stats-chart", label: "My Progress", onPress: () => router.push("/(tabs)/progress") },
    { icon: "heart", label: "Favorites & Watch Later", onPress: () => router.push("/favorites") },
    { icon: "cart", label: "Store", onPress: () => router.push("/(tabs)/store") },
    { icon: "document-text", label: "My Orders", onPress: () => router.push("/store/orders") },
    { icon: "card", label: "My Transactions", onPress: () => router.push("/transactions") },
  ];

  const otherSections: { title: string; items: MenuItem[] }[] = [
    {
      title: "Account",
      items: [
        { icon: "create", label: "Edit Profile", onPress: () => router.push("/profile/edit") },
        { icon: "settings", label: "Settings", onPress: () => router.push("/settings") },
        { icon: "shield-checkmark", label: "Privacy Policy", onPress: () => router.push("/settings/privacy-policy") },
        { icon: "document", label: "Terms of Service", onPress: () => router.push("/settings/terms-of-service") },
      ],
    },
    {
      title: "Support",
      items: [
        { icon: "help-circle", label: "Help & Support", onPress: () => router.push("/settings/help") },
        { icon: "log-out", label: "Sign Out", onPress: handleLogout, danger: true },
        { icon: "trash", label: "Delete Account", onPress: handleDeleteRequest, danger: true },
      ],
    },
  ];

  const initials = user?.name
    ?.split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "S";

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const { panHandlers, SwipeIndicator } = useTabSwipe("/(tabs)/profile");

  // ── Guest / signed-out state ─────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, flex: 1 }]} {...panHandlers}>
        <SwipeIndicator />
        {/* Header */}
        <View style={{ paddingTop: topPad + 16, paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Profile</Text>
        </View>

        {/* Guest Banner */}
        <View style={{ marginHorizontal: 20, borderRadius: 20, backgroundColor: '#0B6FAD', padding: 28, alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <Ionicons name="person" size={36} color="#fff" />
          </View>
          <Text style={{ fontFamily: 'Fredoka_700Bold', fontSize: 22, color: '#fff', textAlign: 'center' }}>Welcome to MakersFlow</Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 20 }}>
            Sign in to access your profile, track courses, and manage your learning journey.
          </Text>
          <Pressable
            style={{ marginTop: 4, backgroundColor: '#fff', borderRadius: 28, paddingVertical: 13, paddingHorizontal: 36, alignItems: 'center', width: '100%' }}
            onPress={() => router.push('/(auth)/login')}
          >
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#0B6FAD' }}>Sign In</Text>
          </Pressable>
          <Pressable
            style={{ borderRadius: 28, paddingVertical: 13, paddingHorizontal: 36, alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)' }}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#fff' }}>Create Account</Text>
          </Pressable>
        </View>

        {/* Teaser menu items (non-interactive) */}
        <View style={{ marginHorizontal: 20, gap: 10 }}>
          {[
            { icon: 'book-outline', label: 'My Courses' },
            { icon: 'stats-chart-outline', label: 'My Progress' },
            { icon: 'heart-outline', label: 'Favorites & Watch Later' },
            { icon: 'cart-outline', label: 'Store' },
          ].map((item) => (
            <Pressable
              key={item.label}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 16, gap: 14, opacity: 0.55 }}
              onPress={() => router.push('/(auth)/login')}
            >
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={item.icon as any} size={17} color="#0B6FAD" />
              </View>
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.foreground, flex: 1 }}>{item.label}</Text>
              <Ionicons name="lock-closed-outline" size={15} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const unviewedCount = completedCourses.filter((c) => !viewedCerts.includes(c.courseId)).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }} {...panHandlers}>
    <SwipeIndicator />
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingRight: 20, marginBottom: 16 }}>
        <Text style={[styles.pageTitle, { color: colors.foreground, marginBottom: 0 }]}>Profile</Text>
        <Pressable
          style={styles.circleHeaderBtn}
          onPress={() => router.push("/notifications")}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.foreground} />
          {unreadNotifCount > 0 && (
            <View style={styles.redDotBadge} />
          )}
        </Pressable>
      </View>

      {/* User Banner */}
      <View style={[styles.profileCard, { backgroundColor: "#0B6FAD" }]}>
        <View style={styles.avatarContainer}>
          {getAvatarSource(user?.avatar) ? (
            <Image source={getAvatarSource(user?.avatar)!} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          )}
          <Pressable
            style={styles.avatarEditPen}
            onPress={() => router.push("/profile/edit")}
          >
            <Ionicons name="pencil" size={12} color="#0B6FAD" />
          </Pressable>
        </View>
        <Text style={styles.name}>{user?.name ?? "Student"}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{user?.grade ?? "Student"}</Text>
          </View>
          {user?.school ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{user.school}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          style={[styles.editProfileGhostBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
          onPress={() => router.push("/profile/edit")}
        >
          <Text style={[styles.editProfileGhostBtnText, { color: colors.primary }]}>Edit Profile</Text>
        </Pressable>
      </View>

      {/* Stats Strip */}
      <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.stat}>
          {certsLoading ? (
            <ActivityIndicator size="small" color="#0B6FAD" />
          ) : (
            <Text style={styles.statNum}>{enrolledCount}</Text>
          )}
          <Text style={styles.statLabel}>Enrolled</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: "#D6E9F2" }]} />
        <View style={styles.stat}>
          {certsLoading ? (
            <ActivityIndicator size="small" color="#0B6FAD" />
          ) : avgProgress === 0 ? (
            <>
              <Text style={styles.statNum}>-</Text>
              <Text style={styles.statLabel}>Start Now</Text>
            </>
          ) : (
            <>
              <Text style={styles.statNum}>{avgProgress}%</Text>
              <Text style={styles.statLabel}>Avg Progress</Text>
            </>
          )}
        </View>
        <View style={[styles.statDivider, { backgroundColor: "#D6E9F2" }]} />
        <View style={styles.stat}>
          {certsLoading ? (
            <ActivityIndicator size="small" color="#0B6FAD" />
          ) : (
            <Text style={styles.statNum}>{completedCourses.length}</Text>
          )}
          <Text style={styles.statLabel}>Certificates</Text>
        </View>
      </View>

      {/* Learning Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Learning</Text>
        <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {learningMenuItems.map((item, idx) => (
            <React.Fragment key={item.label}>
              <Pressable
                style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.75 : 1 }]}
                onPress={item.onPress}
              >
                <View style={[styles.menuIconBox, { backgroundColor: "rgba(11, 111, 173, 0.08)" }]}>
                  <Ionicons name={item.icon as any} size={16} color="#0B6FAD" />
                </View>
                <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={{ opacity: 0.45 }} />
              </Pressable>
              {idx < learningMenuItems.length - 1 && (
                <View style={[styles.menuDivider, { backgroundColor: colors.border, opacity: 0.2 }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Achievements & Certificates */}
      <View style={styles.section}>
        <View style={styles.achievementsHeader}>
          <View style={styles.achievementsTitleRow}>
            <Ionicons name="ribbon" size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { marginBottom: 0, color: colors.foreground }]}>
              Achievements & Certificates
            </Text>
          </View>
          {unviewedCount > 0 && (
            <View style={[styles.certCountBadge, { backgroundColor: "#10B981" }]}>
              <Text style={styles.certCountText}>{unviewedCount}</Text>
            </View>
          )}
        </View>

        {certsLoading ? (
          <View style={[styles.certsCard, { backgroundColor: colors.card, borderColor: colors.border, padding: 16 }]}>
            <CertificateSkeleton />
            <CertificateSkeleton />
          </View>
        ) : completedCourses.length === 0 ? (
          <View style={[styles.certsCard, styles.emptyCertsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="medal" size={36} color={colors.mutedForeground} style={{ opacity: 0.3 }} />
            <Text style={[styles.emptyCertsText, { color: colors.foreground }]}>
              No certificates yet
            </Text>
            <Text style={[styles.emptyCertsSub, { color: colors.mutedForeground }]}>
              Complete a course to earn your certificate
            </Text>
            <Pressable
              style={[styles.browseCourseBtn, { backgroundColor: "#0B6FAD" }]}
              onPress={() => router.push("/(tabs)/courses")}
            >
              <Text style={styles.browseCourseBtnText}>Browse Courses</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.certsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {completedCourses.map((course, idx) => (
              <React.Fragment key={course.courseId}>
                <View style={styles.certRow}>
                  <View style={styles.medalBox}>
                    <Ionicons name="medal" size={20} color="#F59E0B" />
                  </View>

                  <View style={styles.certInfo}>
                    <Text style={[styles.certCourseTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {course.courseTitle}
                    </Text>
                    <Text style={[styles.certDate, { color: colors.mutedForeground }]}>
                      Completed · {formatDate(course.completedAt)}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {/* View Button */}
                    <Pressable
                      style={[styles.downloadBtn, { backgroundColor: "#10B981" }]}
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
                      <Ionicons name="eye" size={14} color="#FFF" />
                    </Pressable>

                    {/* Download Button */}
                    <Pressable
                      style={styles.downloadBtn}
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
                      <Ionicons name="download" size={14} color="#FFF" />
                    </Pressable>
                  </View>
                </View>
                {idx < completedCourses.length - 1 && (
                  <View style={[styles.menuDivider, { backgroundColor: colors.border, marginLeft: 68, opacity: 0.2 }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}
      </View>

      {/* Wishlist Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Wishlist</Text>
        {wishlistLoading ? (
          <WishlistSkeleton />
        ) : wishlistProducts.length === 0 ? (
          <View style={[styles.certsCard, styles.emptyCertsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="heart" size={36} color={colors.mutedForeground} style={{ opacity: 0.3 }} />
            <Text style={[styles.emptyCertsText, { color: colors.foreground }]}>
              Your wishlist is empty
            </Text>
            <Text style={[styles.emptyCertsSub, { color: colors.mutedForeground }]}>
              Explore our store and save products you like
            </Text>
            <Pressable
              style={[styles.browseCourseBtn, { backgroundColor: "#0B6FAD" }]}
              onPress={() => router.push("/(tabs)/store")}
            >
              <Text style={styles.browseCourseBtnText}>Visit Store</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 4 }}
          >
            {wishlistProducts.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </ScrollView>
        )}
      </View>

      {/* Other Sections */}
      {otherSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
          <View style={[styles.menuCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {section.items.map((item, idx) => (
              <React.Fragment key={item.label}>
                <Pressable
                  style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={item.onPress}
                >
                  <View style={[styles.menuIconBox, { backgroundColor: item.danger ? "rgba(220, 38, 38, 0.08)" : "rgba(11, 111, 173, 0.08)" }]}>
                    <Ionicons name={item.icon as any} size={16} color={item.danger ? "#DC2626" : "#0B6FAD"} />
                  </View>
                  <Text style={[styles.menuLabel, { color: item.danger ? "#DC2626" : colors.foreground }]}>
                    {item.label}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} style={{ opacity: 0.45 }} />
                </Pressable>
                {idx < section.items.length - 1 && (
                  <View style={[styles.menuDivider, { backgroundColor: colors.border, opacity: 0.2 }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        </View>
      ))}

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        MAKERSFLOW v1.0.0 · Member since {user?.joinedDate}
      </Text>

      {/* Account Deletion Modal */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !isDeleting && setDeleteModalVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border }]}>
            {deleteStep === "password" ? (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>Verify Identity</Text>
                  <Pressable onPress={() => setDeleteModalVisible(false)} disabled={isDeleting}>
                    <Ionicons name="close" size={24} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
                  Please re-enter your password to continue with account deletion.
                </Text>
                
                <View style={[
                  styles.modalInput,
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    borderColor: colors.border,
                    backgroundColor: colors.card,
                    paddingHorizontal: 16,
                    paddingVertical: 0,
                    height: 52,
                  }
                ]}>
                  <TextInput
                    style={[{ color: colors.foreground, flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" }]}
                    placeholder="Password"
                    placeholderTextColor={colors.mutedForeground}
                    secureTextEntry={!showDeletePassword}
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    autoCapitalize="none"
                    editable={!isDeleting}
                  />
                  <Pressable onPress={() => setShowDeletePassword(!showDeletePassword)} style={{ paddingLeft: 10 }}>
                    <Ionicons name={showDeletePassword ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                
                {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
                
                <Pressable
                  style={[styles.modalBtn, { backgroundColor: "#0B6FAD", opacity: isDeleting ? 0.7 : 1 }]}
                  onPress={handleVerifyPassword}
                  disabled={isDeleting}
                >
                  {isDeleting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalBtnText}>Verify Password</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: "#DC2626" }]}>Permanently Delete Account?</Text>
                  <Pressable onPress={() => setDeleteModalVisible(false)} disabled={isDeleting}>
                    <Ionicons name="close" size={24} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <Text style={[styles.modalSubtitle, { color: colors.foreground }]}>
                  This action is <Text style={{ fontWeight: "700" }}>irreversible</Text>. All your data, including progress, courses, and settings will be permanently removed from our servers.
                </Text>
                
                {deleteError ? <Text style={styles.errorText}>{deleteError}</Text> : null}
                
                <View style={styles.modalBtnRow}>
                  <Pressable
                    style={[styles.modalBtnHalf, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
                    onPress={() => setDeleteModalVisible(false)}
                    disabled={isDeleting}
                  >
                    <Text style={[styles.modalBtnHalfText, { color: colors.foreground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalBtnHalf, { backgroundColor: "#DC2626", opacity: isDeleting ? 0.7 : 1 }]}
                    onPress={handleConfirmDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? <ActivityIndicator color="#FFF" /> : <Text style={[styles.modalBtnHalfText, { color: "#FFF" }]}>Yes, Delete</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 26, fontFamily: "Fredoka_700Bold", paddingHorizontal: 20, marginBottom: 16 },
  profileCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  avatarContainer: {
    position: "relative",
    marginBottom: 8,
  },
  avatarEditPen: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  initials: { fontSize: 28, fontFamily: "Fredoka_700Bold", color: "#FFF" },
  name: { fontSize: 20, fontFamily: "Fredoka_700Bold", color: "#FFF", marginBottom: 2 },
  email: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginBottom: 8 },
  badges: { flexDirection: "row", gap: 8 },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  statsRow: {
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    paddingVertical: 16,
    marginBottom: 24,
  },
  stat: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 20, fontFamily: "Fredoka_700Bold", color: "#0B6FAD" },
  statLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B7280", marginTop: 2 },
  statDivider: { width: 1 },
  section: { paddingHorizontal: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Fredoka_700Bold",
    color: "#0F2A3D",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  menuCard: { borderRadius: 20, borderWidth: 1, overflow: "hidden", paddingVertical: 6 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  menuDivider: { height: 0.5, marginLeft: 68, opacity: 0.4 },
  version: { textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular", paddingBottom: 8 },

  achievementsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  achievementsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  certCountBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  certCountText: {
    fontSize: 12,
    fontFamily: "Fredoka_700Bold",
    color: "#FFF",
  },
  certsCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    paddingVertical: 6,
  },
  emptyCertsCard: {
    padding: 28,
    alignItems: "center",
    gap: 8,
  },
  emptyCertsText: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
    marginTop: 4,
  },
  emptyCertsSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  browseCourseBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20, // pill
  },
  browseCourseBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  certRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  medalBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  certInfo: { flex: 1, gap: 3 },
  certCourseTitle: { fontSize: 15, fontFamily: "Fredoka_600SemiBold", lineHeight: 19 },
  certDate: { fontSize: 11, fontFamily: "Inter_400Regular", opacity: 0.5 },
  downloadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0B6FAD",
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontFamily: "Fredoka_700Bold" },
  modalSubtitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22, marginBottom: 20 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  errorText: { color: "#DC2626", fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 16 },
  modalBtn: {
    paddingVertical: 16,
    borderRadius: 24, // pill
    alignItems: "center",
  },
  modalBtnText: { color: "#FFF", fontSize: 16, fontFamily: "Fredoka_600SemiBold" },
  modalBtnRow: { flexDirection: "row", gap: 12 },
  modalBtnHalf: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 20, // pill
    alignItems: "center",
  },
  modalBtnHalfText: { fontSize: 16, fontFamily: "Fredoka_600SemiBold" },
  editProfileGhostBtn: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: "#0B6FAD",
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  editProfileGhostBtnText: {
    color: "#0B6FAD",
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
  },
  circleHeaderBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(15, 42, 61, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  redDotBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
  },
});
