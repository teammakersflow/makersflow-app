import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ToastAndroid,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { Badge } from "@/components/Badge";
import { StarRating } from "@/components/StarRating";
import { DetailSkeleton } from "@/components/SkeletonLoader";
import { ImageGallery } from "@/components/ImageGallery";
import { cacheManager } from "@/services/cacheManager";
import { QUIZZES } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useRequireAuth } from "@/context/AuthRequireContext";
import { getCourseById, getCourseModules } from "@/services/courseDataProvider";
import { enrollInCourse, isEnrolled as checkEnrollment, getEnrollment, isExpired } from "@/services/enrollmentService";
import { fetchCourseLessonsProgress } from "@/lib/progressStorage";
import { fetchCourseReviews, fetchMyReview, upsertReview } from "@/services/reviewService";
import { parseThumbnailUrls } from "@/lib/thumbnailUtils";
import { homeRepository } from "@/repositories/homeRepository";
import { coursesRepository } from "@/repositories/coursesRepository";
import { productService } from "@/services/productService";
import { fetchCourseKit, CourseKitResponse } from "@/services/courseKitService";

export default function CourseDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ id: string }>();
  const rawId = Array.isArray(rawParams.id) ? rawParams.id[0] : rawParams.id;
  const id = rawId && rawId !== 'undefined' && rawId !== 'null' ? rawId : undefined;
  const { user } = useAuth();
  const { isFavoriteCourse, toggleFavoriteCourse } = useFavorites();
  const { addToCart, items: cartItems } = useCart();
  const { requireAuth } = useRequireAuth();

  const [course, setCourse] = useState<any>(null);
  const [courseKit, setCourseKit] = useState<CourseKitResponse | null>(null);
  const [modules, setModules] = useState<any[]>([]);
  const [lessonsProgress, setLessonsProgress] = useState<any[]>([]);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [enrollment, setEnrollment] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isFavorite = course ? isFavoriteCourse(course.id) : false;

  const [activeTab, setActiveTab] = useState<"overview" | "lessons" | "reviews">("overview");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const imageListRef = useRef<FlatList>(null);
  const SCREEN_WIDTH = Dimensions.get("window").width;

  const [myReview, setMyReview] = useState<{ rating: number; comment: string } | null>(null);
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [allReviews, setAllReviews] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [showAllReviews, setShowAllReviews] = useState(false);

  const handleShare = async () => {
    try {
      await Share.share({
        title: course?.title,
        message: `Check out "${course?.title || "this course"}" on MakersFlow!\n\nOpen in app: makersflow://course/${id}\n\nDownload MakersFlow: https://play.google.com/store/apps/details?id=com.makersflow.app`,
      });
    } catch (error) {
      console.error("Error sharing course:", error);
    }
  };

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert('', message);
    }
  };

  const [isOfflineCached, setIsOfflineCached] = useState(false);

  const loadCourseData = useCallback(async (isRefreshing = false, cancelledRef = { current: false }) => {
    if (!id) {
      setCourseKit(null);
      return;
    }

    // Kit data is optional; fetch it independently of course loading.
    void fetchCourseKit(id).then((result) => {
      if (!cancelledRef.current) setCourseKit(result);
    });
    if (!isRefreshing) {
      setIsLoading(true);
    }

    const cacheKey = `cached_course_detail_${id}`;
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    try {
      const courseData = await getCourseById(id);
      if (cancelledRef.current) return;
      if (courseData) {
        // Save to local cache
        await cacheManager.write(cacheKey, courseData);
        setIsOfflineCached(false);

        const fromThumb = parseThumbnailUrls(courseData.thumbnail_url);
        let fromImages: string[] = [];
        if (courseData.images) {
          let raw: any = courseData.images;
          if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
          if (Array.isArray(raw)) fromImages = raw.map(String).filter((u: string) => u.startsWith('http'));
        }
        const seen = new Set<string>();
        const images: string[] = [];
        [...fromThumb, ...fromImages].forEach((u) => { if (u && !seen.has(u)) { seen.add(u); images.push(u); } });

        const mappedCourse = {
          id: String(courseData.id),
          title: courseData.title,
          category: courseData.category || "General",
          level: courseData.level ? (courseData.level.charAt(0).toUpperCase() + courseData.level.slice(1)) : "Beginner",
          price: courseData.price || 0,
          isFree: courseData.is_free,
          images: images.length > 0 ? images : null,
          thumbnail: images.length > 0
            ? { uri: images[0] }
            : require('@/assets/images/courses/course_robotics.webp'),
          instructor: "MakersFlow Instructor",
          rating: 0,
          reviews: 0,
          description: courseData.description || "",
          tags: [courseData.category || "Robotics"],
        };
        setCourse(mappedCourse);
      }
    } catch (error) {
      console.warn("[CourseDetail] Live query failed, checking offline cache:", error);
      // Offline fallback: check local cache before giving up
      const cachedCourse = await cacheManager.read<any>(cacheKey, CACHE_TTL);
      if (cachedCourse && !cancelledRef.current) {
        setIsOfflineCached(true);
        const fromThumb = parseThumbnailUrls(cachedCourse.thumbnail_url);
        let fromImages: string[] = [];
        if (cachedCourse.images) {
          let raw: any = cachedCourse.images;
          if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
          if (Array.isArray(raw)) fromImages = raw.map(String).filter((u: string) => u.startsWith('http'));
        }
        const seen = new Set<string>();
        const images: string[] = [];
        [...fromThumb, ...fromImages].forEach((u) => { if (u && !seen.has(u)) { seen.add(u); images.push(u); } });

        const mappedCourse = {
          id: String(cachedCourse.id),
          title: cachedCourse.title,
          category: cachedCourse.category || "General",
          level: cachedCourse.level ? (cachedCourse.level.charAt(0).toUpperCase() + cachedCourse.level.slice(1)) : "Beginner",
          price: cachedCourse.price || 0,
          isFree: cachedCourse.is_free,
          images: images.length > 0 ? images : null,
          thumbnail: images.length > 0
            ? { uri: images[0] }
            : require('@/assets/images/courses/course_robotics.webp'),
          instructor: "MakersFlow Instructor",
          rating: 0,
          reviews: 0,
          description: cachedCourse.description || "",
          tags: [cachedCourse.category || "Robotics"],
        };
        setCourse(mappedCourse);
      }
    } finally {
      if (!cancelledRef.current) {
        setRefreshing(false);
      }
    }

    // Parallelize below-the-fold secondary queries in a single Promise.allSettled batch
    const modulesPromise = getCourseModules(id);
    const reviewsPromise = fetchCourseReviews(id);
    const enrollmentPromise = user?.id ? checkEnrollment(user.id, id) : Promise.resolve(false);
    const myReviewPromise = user?.id ? fetchMyReview(user.id, id) : Promise.resolve(null);

    Promise.allSettled([modulesPromise, reviewsPromise, enrollmentPromise, myReviewPromise]).then(
      async ([modulesRes, reviewsRes, enrollmentRes, myReviewRes]) => {
        if (cancelledRef.current) return;

        // 1. Modules
        if (modulesRes.status === 'fulfilled' && Array.isArray(modulesRes.value)) {
          const rawModules = modulesRes.value;
          const sanitizedModules = rawModules.map((m: any) => ({
            ...m,
            lessons: Array.isArray(m.lessons) ? m.lessons : [],
          }));
          const flatLessons = sanitizedModules.flatMap((m: any) =>
            m.lessons.map((l: any) => ({
              id: l.id,
              title: l.title,
              duration: l.duration_minutes ? `${l.duration_minutes} mins` : "0 mins",
              duration_minutes: l.duration_minutes,
            }))
          );
          setModules(flatLessons);
        }

        // 2. Course Reviews
        if (reviewsRes.status === 'fulfilled' && Array.isArray(reviewsRes.value)) {
          const reviews = reviewsRes.value;
          setAllReviews(reviews);
          if (reviews.length > 0) {
            const avg = reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length;
            setAvgRating(Math.round(avg * 10) / 10);
          } else {
            setAvgRating(null);
          }
        }

        // 3. User Review
        if (myReviewRes.status === 'fulfilled' && myReviewRes.value) {
          const mine = myReviewRes.value;
          setMyReview({ rating: mine.rating, comment: mine.comment ?? "" });
          setDraftRating(mine.rating);
          setDraftComment(mine.comment ?? "");
        }

        // 4. Enrollment & Progress (parallelized nested check)
        if (enrollmentRes.status === 'fulfilled' && user?.id) {
          const enrolledStatus = Boolean(enrollmentRes.value);
          setIsEnrolled(enrolledStatus);

          if (enrolledStatus) {
            const [progressRes, enrollDetailsRes] = await Promise.allSettled([
              fetchCourseLessonsProgress(user.id, id),
              getEnrollment(user.id, id)
            ]);
            if (cancelledRef.current) return;
            if (progressRes.status === 'fulfilled') setLessonsProgress(progressRes.value);
            if (enrollDetailsRes.status === 'fulfilled') setEnrollment(enrollDetailsRes.value);
          } else {
            setEnrollment(null);
          }
        }

        if (!cancelledRef.current) {
          setIsLoading(false);
        }
      }
    );
  }, [id, user?.id]);

  useEffect(() => {
    const cancelledRef = { current: false };
    loadCourseData(false, cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [loadCourseData]);

  useFocusEffect(
    useCallback(() => {
      loadCourseData(true);
    }, [loadCourseData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCourseData(true);
  };

  const quiz = useMemo(() => QUIZZES.find((q) => q.courseId === course?.id), [course?.id]);
  const isCourseCompleted = !!enrollment?.completed_at;
  const accessExpired = useMemo(() => isExpired(enrollment), [enrollment]);
  const completedModules = useMemo(() => lessonsProgress.filter((p) => p.is_completed).length, [lessonsProgress]);
  
  const progress = useMemo(() => {
    if (isCourseCompleted) return 100;
    if (modules.length === 0) return 0;
    return Math.min(100, Math.round((completedModules / modules.length) * 100));
  }, [isCourseCompleted, completedModules, modules.length]);

  const remainingModules = useMemo(() => {
    if (isCourseCompleted) return 0;
    return Math.max(0, modules.length - completedModules);
  }, [isCourseCompleted, modules.length, completedModules]);
  
  const lastModuleId = useMemo(() => {
    if (lessonsProgress.length === 0) return null;
    const sorted = [...lessonsProgress].sort((a, b) => new Date(b.last_watched_at || 0).getTime() - new Date(a.last_watched_at || 0).getTime());
    return sorted[0]?.lesson_id;
  }, [lessonsProgress]);

  const totalDurationMin = useMemo(
    () => modules.reduce((sum, m) => sum + (m.duration_minutes || 0), 0),
    [modules],
  );

  // ── FIX ────────────────────────────────────────────────────────────────────
  // Fall back to the values stored on the course row when the modules query
  // returns nothing, so the header keeps showing "28 Lessons / 239 mins"
  // instead of collapsing to "—" and "Self-paced".
  const fallbackLessonCount = Number((course as any)?.total_lessons ?? 0);
  const fallbackDurationMin = Number(
    (course as any)?.duration_minutes ?? (course as any)?.total_duration_minutes ?? 0,
  );

  const lessonCount = modules.length > 0 ? modules.length : fallbackLessonCount;
  const effectiveDurationMin = totalDurationMin > 0 ? totalDurationMin : fallbackDurationMin;
  const displayDuration =
    effectiveDurationMin > 0 ? `${effectiveDurationMin} mins` : "Self-paced";

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!course) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Pressable onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/courses");
        }} style={styles.backCircleWeb}>
          <Ionicons name="arrow-back" size={22} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.errorText, { color: colors.foreground }]}>Course not found.</Text>
      </View>
    );
  }

  const handleFavoriteToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    requireAuth(() => {
      const wasAdded = !isFavorite;
      toggleFavoriteCourse({
        id: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        category: course.category,
        price: course.price,
        isFree: course.isFree,
      });
      showToast(wasAdded ? 'Added to Favorites' : 'Removed from Favorites');
    });
  };

  const handleEnrollNow = async () => {
    if (!course) return;
    requireAuth(async () => {
      if (!user?.id) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsEnrolling(true);

      try {
        if (!course.isFree) {
          const { products } = await productService.getProducts({ limit: 100 });
          const linkedProduct = products.find((p) => Number(p.course_id) === Number(course.id));

          if (!linkedProduct) {
            // No linked product row — create a virtual product from the course itself
            // so the user can still proceed to checkout.
            const virtualProduct: any = {
              id: `course_${course.id}`,
              title: course.title,
              category: "digital",
              subcategory: "Courses",
              price: course.price,
              originalPrice: course.price,
              thumbnail: course.thumbnail,
              description: course.description,
              rating: 4.8,
              reviews: 0,
              inStock: true,
              features: [],
              is_course: true,
              course_id: String(course.id),
            };
            if (!cartItems.some((i) => i.product.id === virtualProduct.id)) {
              addToCart(virtualProduct);
            }
            router.push("/store/checkout");
            return;
          }

          const productForCart: any = {
            id: String(linkedProduct.id),
            title: linkedProduct.title || course.title,
            category: "digital",
            subcategory: linkedProduct.subcategory || "Courses",
            price: Number(linkedProduct.price) || course.price,
            originalPrice: Number(linkedProduct.originalPrice) || Number(linkedProduct.price) || course.price,
            thumbnail: linkedProduct.thumbnail || course.thumbnail,
            description: linkedProduct.description || course.description,
            rating: 4.8,
            reviews: 0,
            inStock: linkedProduct.inStock,
            features: linkedProduct.features || [],
            is_course: true,
            course_id: String(course.id),
          };

          if (!cartItems.some((i) => i.product.id === productForCart.id)) {
            addToCart(productForCart);
          }
          router.push("/store/checkout");
          return;
        }

        await enrollInCourse(user.id, course.id, course.isFree);
        await Promise.all([
          homeRepository.invalidateProgressCache().catch(() => {}),
          coursesRepository.invalidateEnrollmentsCache().catch(() => {}),
        ]);
        setIsEnrolled(true);

        const progressData = await fetchCourseLessonsProgress(user.id, course.id);
        setLessonsProgress(progressData);
        
        Alert.alert(
          "Enrollment Successful!",
          `You've successfully enrolled in "${course.title}". Ready to start learning?`,
          [
            {
              text: "View Course",
              style: "cancel",
              onPress: () => {
                setIsEnrolling(false);
              },
            },
            {
              text: "Start Learning",
              onPress: () => {
                setIsEnrolling(false);
                router.push({ 
                  pathname: "/course/learn", 
                  params: { courseId: course.id, moduleId: modules[0]?.id || "" } 
                });
              },
            },
          ]
        );
      } catch (error) {
        console.error('[CourseDetail] Enrollment error:', error);
        Alert.alert(
          "Enrollment Failed",
          "Something went wrong. Please try again.",
          [{ text: "OK" }]
        );
      } finally {
        setIsEnrolling(false);
      }
    });
  };

  const handleSubmitReview = async () => {
    if (!user?.id || !course || draftRating === 0) return;
    setReviewSubmitting(true);
    try {
      await upsertReview(user.id, course.id, draftRating, draftComment);
      setMyReview({ rating: draftRating, comment: draftComment });
      setReviewSubmitted(true);
      Alert.alert(
        "Review submitted",
        "Thanks! Your review is pending approval and will be visible to everyone once approved.",
      );
      const reviews = await fetchCourseReviews(course.id);
      setAllReviews(reviews);
      if (reviews.length > 0) {
        const avg = reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length;
        setAvgRating(Math.round(avg * 10) / 10);
      }
      setTimeout(() => setReviewSubmitted(false), 3000);
    } catch (err) {
      console.error("[CourseDetail] review submit error:", err);
      Alert.alert("Error", "Failed to submit review. Please try again.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const topOffset = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading) {
    return <DetailSkeleton />;
  }

  if (!id || !course) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center", padding: 24 }]}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
        <Text style={{ color: colors.foreground, fontSize: 18, fontFamily: "Fredoka_600SemiBold", marginBottom: 8 }}>Course Not Found</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 20 }}>
          The course you are looking for does not exist or has been removed.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{ paddingVertical: 12, paddingHorizontal: 24, backgroundColor: "#0B6FAD", borderRadius: 12 }}
        >
          <Text style={{ color: "#FFF", fontFamily: "Inter_600SemiBold" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 120 : insets.bottom + 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#0B6FAD']}
          />
        }
      >
        {/* Thumbnail Hero — swipeable gallery with thumbnails & fullscreen */}
        <View style={{ position: "relative" }}>
          <ImageGallery
            images={course.images && course.images.length > 0 ? course.images : [course.thumbnail]}
            height={280}
          >
            <Pressable
              style={[styles.backCircle, { top: topOffset + 8 }]}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(tabs)/courses");
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#0B6FAD" />
            </Pressable>
            
            {/* Overlaid Wishlist button */}
            <Pressable
              style={[styles.favoriteCircle, { top: topOffset + 8 }]}
              onPress={handleFavoriteToggle}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={20}
                color={isFavorite ? "#EF4444" : "#0B6FAD"}
              />
            </Pressable>

            {/* Overlaid Share button */}
            <Pressable
              style={[styles.shareCircle, { top: topOffset + 8 }]}
              onPress={handleShare}
            >
              <Ionicons name="share-social" size={20} color="#0B6FAD" />
            </Pressable>
          </ImageGallery>
          <View style={[styles.thumbnailBadge, { bottom: 16, left: 16 }]}>
            <Badge label={course.level} variant="primary" />
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {isOfflineCached && (
            <View style={{ backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Ionicons name="cloud-offline" size={16} color="#D97706" />
              <Text style={{ color: "#92400E", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                Offline Mode — Showing cached course details
              </Text>
            </View>
          )}
          <View style={[styles.categoryBadge, { backgroundColor: "#DCF7F4" }]}>
            <Text style={[styles.categoryText, { color: "#0B6FAD" }]}>{course.category}</Text>
          </View>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground, flex: 1 }]}>{course.title}</Text>
          </View>
          <Text style={[styles.instructor, { color: colors.mutedForeground }]}>By {course.instructor}</Text>

          {/* Stats strip */}
          <View style={styles.statsStrip}>
            {[
              { icon: "star", value: avgRating != null ? avgRating.toFixed(1) : "—", label: "Rating" },
              { icon: "book", value: lessonCount > 0 ? `${lessonCount}` : "—", label: "Lessons" },
              { icon: "time", value: displayDuration, label: "Duration" },
            ].map((s) => (
              <View key={s.label} style={[styles.statChip, { backgroundColor: "#DCF7F4" }]}>
                <Ionicons name={s.icon as any} size={18} color="#0B6FAD" />
                <Text style={[styles.statValue, { color: "#0B6FAD" }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Course kit */}
          {courseKit?.kit && (
            <View style={{
              marginTop: 16,
              marginBottom: 16,
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.background,
              gap: 12,
            }}>
              <View style={{
                alignSelf: "flex-start",
                backgroundColor: courseKit.kit_included ? "#DCFCE7" : "#FEF3C7",
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 20,
              }}>
                <Text style={{
                  color: courseKit.kit_included ? "#166534" : "#92400E",
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
                }}>
                  {courseKit.kit_included ? "Kit included with course" : "Kit sold separately"}
                </Text>
              </View>

              <Text style={{
                color: colors.foreground,
                fontSize: 18,
                fontFamily: "Inter_600SemiBold",
              }}>
                {courseKit.kit.name}
              </Text>

              {!!courseKit.kit.description && (
                <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
                  {courseKit.kit.description}
                </Text>
              )}

              {courseKit.kit.items.map((item) => (
                <View key={item.product_id} style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 6,
                }}>
                  {item.image ? (
                    <Image
                      source={{ uri: item.image }}
                      style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.muted }}
                      resizeMode="cover"
                      onError={() => {
                        setCourseKit((current) => current ? ({
                          ...current,
                          kit: current.kit ? {
                            ...current.kit,
                            items: current.kit.items.map((entry) =>
                              entry.product_id === item.product_id ? { ...entry, image: null } : entry
                            ),
                          } : null,
                        }) : null);
                      }}
                    />
                  ) : (
                    <View style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: colors.muted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      <Ionicons name="cube-outline" size={22} color={colors.mutedForeground} />
                    </View>
                  )}

                  <View style={{ flex: 1, gap: 3 }}>
                    <Text numberOfLines={2} style={{
                      color: colors.foreground,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}>
                      {item.title}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      {`Qty ${item.quantity}${!courseKit.kit_included && item.price != null ? ` · ₹${item.price} each` : ""}`}
                    </Text>
                    {!item.available && (
                      <Text style={{ color: "#DC2626", fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
                        Out of stock
                      </Text>
                    )}
                  </View>
                </View>
              ))}

              {!courseKit.kit.all_available && (
                <Text style={{ color: "#DC2626", fontSize: 13 }}>
                  Some kit items are currently out of stock.
                </Text>
              )}

              <Text style={{
                color: colors.mutedForeground,
                fontSize: 13,
                lineHeight: 19,
              }}>
                {courseKit.kit_included
                  ? "After you buy this course, confirm your shipping address to receive the kit at no extra cost."
                  : "This course is free, but the kit isn't included. You can buy the kit separately from the Store."}
              </Text>
            </View>
          )}

          {/* Tab bar */}
          <View style={styles.tabBar}>
            {(["overview", "lessons", "reviews"] as const).map((tab) => (
              <Pressable
                key={tab}
                style={[
                  styles.tabItem,
                  activeTab === tab && { borderBottomColor: "#0B6FAD", borderBottomWidth: 2 }
                ]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: activeTab === tab ? "#0B6FAD" : "#5A7A8C" },
                    activeTab === tab && { fontFamily: "Inter_600SemiBold" }
                  ]}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Tab contents */}
          {activeTab === "overview" && (
            <View style={{ gap: 12 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>About this course</Text>
              <Text style={[styles.description, { color: colors.mutedForeground }]}>{course.description}</Text>

              {/* Tags */}
              <View style={styles.tags}>
                {course.tags.map((tag: any) => (
                  <View key={tag} style={[styles.tag, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {activeTab === "lessons" && (
            <View style={{ gap: 12 }}>
              {/* Progress */}
              {isEnrolled && (
                <View style={[styles.progressCard, { backgroundColor: "#DCF7F4", borderColor: "#0B6FAD" }]}>
                  <View style={styles.progressHeader}>
                    <View>
                      <Text style={[styles.progressLabel, { color: "#0B6FAD" }]}>Your Progress</Text>
                      <Text style={[styles.progressPct, { color: "#0B6FAD" }]}>{progress}%</Text>
                    </View>
                    {isCourseCompleted && (
                      <View style={[styles.completeBadge, { backgroundColor: "#10B981" }]}>
                        <Ionicons name="ribbon" size={16} color="#FFF" />
                        <Text style={styles.completeBadgeText}>Completed</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[styles.progressFill, { width: `${progress}%` as any, backgroundColor: "#0B6FAD" }]}
                    />
                  </View>
                  <View style={styles.progressStats}>
                    <Text style={[styles.progressSub, { color: colors.foreground }]}>
                      {completedModules} of {modules.length} lessons completed
                    </Text>
                    {remainingModules > 0 && (
                      <Text style={[styles.progressRemaining, { color: colors.mutedForeground }]}>
                        {remainingModules} remaining
                      </Text>
                    )}
                  </View>
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Curriculum</Text>
              <Text style={[styles.curriculumSubtitle, { color: colors.mutedForeground }]}>
                {lessonCount} lessons · {displayDuration}
              </Text>
              {modules.map((mod, idx) => {
                const modProgress = lessonsProgress.find((p) => String(p.lesson_id) === String(mod.id));
                const isCompleted = modProgress?.is_completed === true;
                const watchedPercentage = modProgress?.watch_percentage || 0;

                return (
                  <Pressable
                    key={mod.id}
                    style={[
                      styles.moduleItem,
                      { 
                        backgroundColor: colors.card, 
                        borderColor: isCompleted ? "#17E5D3" : "#D6E9F2",
                        borderWidth: isCompleted ? 1.5 : 1
                      },
                    ]}
                    onPress={() => {
                      if (isEnrolled) {
                        router.push({ pathname: "/course/learn", params: { courseId: course.id, moduleId: mod.id } });
                      }
                    }}
                  >
                    <View
                      style={[
                        styles.moduleNum,
                        { backgroundColor: isCompleted ? "#DCF7F4" : "#E8F4F9" },
                      ]}
                    >
                      {isCompleted ? (
                        <Ionicons name="checkmark" size={14} color="#17E5D3" />
                      ) : (
                        <Text style={[styles.moduleNumText, { color: colors.mutedForeground }]}>{idx + 1}</Text>
                      )}
                    </View>
                    <View style={styles.moduleInfo}>
                      <Text style={[styles.moduleTitle, { color: isCompleted ? "#0B6FAD" : colors.foreground }]}>
                        {mod.title}
                      </Text>
                      <View style={styles.moduleMetaRow}>
                        <Ionicons name="time" size={11} color={colors.mutedForeground} />
                        <Text style={[styles.moduleDuration, { color: colors.mutedForeground }]}>{mod.duration}</Text>
                        {watchedPercentage > 0 && watchedPercentage < 100 && (
                          <Text style={[styles.watchedPercentage, { color: "#0B6FAD" }]}>
                            · {Math.round(watchedPercentage)}% watched
                          </Text>
                        )}
                      </View>
                      {watchedPercentage > 0 && watchedPercentage < 100 && (
                        <View style={[styles.lessonProgressTrack, { backgroundColor: colors.muted, marginTop: 6 }]}>
                          <View style={[styles.lessonProgressFill, { width: `${watchedPercentage}%` as any, backgroundColor: "#0B6FAD" }]} />
                        </View>
                      )}
                    </View>
                    {isEnrolled ? (
                      isCompleted ? (
                        <Ionicons name="checkmark-circle" size={22} color="#17E5D3" />
                      ) : (
                        <Ionicons name="play-circle" size={22} color="#0B6FAD" />
                      )
                    ) : (
                      <Ionicons name="lock-closed" size={20} color="#9CA3AF" />
                    )}
                  </Pressable>
                );
              })}

              {/* View Certificate */}
              {isEnrolled && isCourseCompleted && (
                <Pressable
                  style={[styles.certBtn, { backgroundColor: '#0B6FAD' }]}
                  onPress={() => router.push({
                    pathname: '/certificate',
                    params: {
                      courseName: course.title,
                      studentName: user?.name ?? '',
                      completionDate: new Date().toISOString(),
                      level: (course as any).level,
                      instructor: (course as any).instructor,
                    },
                  })}
                >
                  <Ionicons name="ribbon" size={18} color="#fff" />
                  <Text style={styles.certBtnText}>View Certificate</Text>
                </Pressable>
              )}

              {/* Quiz */}
              {quiz && isEnrolled && (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quiz</Text>
                  <Pressable
                    style={[styles.quizCard, { backgroundColor: "#0B6FAD" }]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: "/quiz/[id]", params: { id: quiz.id, title: quiz.title } });
                    }}
                  >
                    <View>
                      <Text style={styles.quizTitle}>{quiz.title}</Text>
                      <Text style={styles.quizSub}>{quiz.questions.length} questions · {quiz.timeLimit / 60} min</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#FFF" />
                  </Pressable>
                </>
              )}
            </View>
          )}

          {activeTab === "reviews" && (
            <View style={{ gap: 12 }}>
              {allReviews.length > 0 && (
                <View style={[styles.avgRatingRow, { backgroundColor: colors.muted, borderRadius: 14 }]}>
                  <StarRating rating={Math.round(avgRating ?? 0)} size={20} readonly />
                  <Text style={[styles.avgRatingText, { color: colors.foreground }]}>
                    {avgRating?.toFixed(1)}{" "}
                    <Text style={{ color: colors.mutedForeground, fontWeight: "400" }}>
                      ({allReviews.length} rating{allReviews.length !== 1 ? "s" : ""})
                    </Text>
                  </Text>
                </View>
              )}

              {/* Rate Course */}
              {isEnrolled && completedModules > 0 && (
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
                  <View style={[styles.rateCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {reviewSubmitted ? (
                      <View style={styles.thankYouRow}>
                        <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                        <Text style={[styles.thankYouText, { color: "#10B981" }]}>
                          Thanks for your review!
                        </Text>
                      </View>
                    ) : (
                      <>
                        <Text style={[styles.rateTitle, { color: colors.foreground }]}>
                          {myReview ? "Update your rating" : "Rate this course"}
                        </Text>
                        <StarRating
                          rating={draftRating}
                          onRatingChange={setDraftRating}
                          size={32}
                        />
                        {draftRating > 0 && (
                          <>
                            <TextInput
                              style={[
                                styles.commentInput,
                                {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                  color: colors.foreground,
                                },
                              ]}
                              placeholder="Share your thoughts (optional)..."
                              placeholderTextColor={colors.mutedForeground}
                              value={draftComment}
                              onChangeText={setDraftComment}
                              multiline
                              numberOfLines={3}
                              maxLength={500}
                            />
                            <Pressable
                              style={[
                                styles.submitBtn,
                                { backgroundColor: "#0B6FAD", opacity: reviewSubmitting ? 0.6 : 1 },
                              ]}
                              onPress={handleSubmitReview}
                              disabled={reviewSubmitting}
                            >
                              {reviewSubmitting ? (
                                <ActivityIndicator size="small" color="#FFF" />
                              ) : (
                                <Text style={styles.submitBtnText}>
                                  {myReview ? "Update Review" : "Submit Review"}
                                </Text>
                              )}
                            </Pressable>
                          </>
                        )}
                      </>
                    )}
                  </View>
                </KeyboardAvoidingView>
              )}

              {/* Review Item lists */}
              {allReviews.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reviews</Text>
                  {(showAllReviews ? allReviews : allReviews.slice(0, 3)).map((review: any) => (
                    <View
                      key={review.id}
                      style={[styles.reviewItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View style={styles.reviewHeader}>
                        <StarRating rating={review.rating} size={14} readonly />
                        <Text style={[styles.reviewMeta, { color: colors.mutedForeground }]}>
                          Student ·{" "}
                          {new Date(review.created_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </Text>
                      </View>
                      {!!review.comment && (
                        <Text style={[styles.reviewComment, { color: colors.foreground }]}>
                          "{review.comment}"
                        </Text>
                      )}
                    </View>
                  ))}
                  {allReviews.length > 3 && (
                    <Pressable
                      onPress={() => setShowAllReviews((prev) => !prev)}
                      style={styles.showAllBtn}
                    >
                      <Text style={[styles.showAllText, { color: "#0B6FAD" }]}>
                        {showAllReviews ? "Show less" : `Show all ${allReviews.length} reviews →`}
                      </Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* CTA Sticky Bottom */}
      <View
        style={[
          styles.cta,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Platform.OS === "web" ? 20 : insets.bottom + 8,
          },
        ]}
      >
        {isEnrolled && accessExpired ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", fontFamily: "Inter_400Regular" }}>
              Your 1-year access expired on{" "}
              {enrollment?.expires_at ? new Date(enrollment.expires_at).toLocaleDateString() : ""}
            </Text>
            <Pressable
              style={[styles.ctaBtn, { backgroundColor: "#0B6FAD" }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Alert.alert(
                  "Renew Access",
                  `Renew "${course.title}" for another year at ₹${course.price}?`,
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Renew Now", onPress: () => router.push("/(tabs)/store") },
                  ],
                );
              }}
            >
              <Ionicons name="refresh-circle" size={18} color="#FFF" />
              <Text style={styles.ctaBtnText}>Renew Access · ₹{course.price}</Text>
            </Pressable>
          </View>
        ) : isEnrolled ? (
          <Pressable
            style={[styles.ctaBtn, { backgroundColor: "#0B6FAD" }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              const targetModuleId = lastModuleId ? String(lastModuleId) : (modules[0]?.id || "");
              router.push({ pathname: "/course/learn", params: { courseId: course.id, moduleId: targetModuleId } });
            }}
          >
            <View style={styles.primaryButtonContent}>
              <Ionicons name="play" size={18} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.ctaBtnText}>
                {progress === 100 ? "Review Course" : progress > 0 ? `Continue Learning · ${progress}%` : "Start Learning"}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#FFF" style={{ marginLeft: "auto" }} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.ctaRow}>
            <View style={{ justifyContent: "center" }}>
              {course.isFree ? (
                <Text style={[styles.ctaPrice, { color: colors.success }]}>Free</Text>
              ) : (
                <Text style={[styles.ctaPrice, { color: "#0B6FAD" }]}>₹{course.price}</Text>
              )}
            </View>
            <Pressable
              style={{ flex: 1, height: 56 }}
              onPress={handleEnrollNow}
              disabled={isEnrolling}
            >
              <LinearGradient
                colors={["#0B6FAD", "#17E5D3"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.enrollGradientBtn}
              >
                <Ionicons name="rocket" size={20} color="#FFF" style={{ marginRight: 4 }} />
                <Text style={styles.enrollBtnText}>
                  {isEnrolling ? "Enrolling..." : (course.isFree ? "Enroll for Free" : "Buy Now")}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorText: { fontSize: 16, textAlign: "center", marginTop: 40 },
  thumbnailContainer: { position: "relative", height: 240 },
  thumbnail: { width: "100%", height: 240, resizeMode: "cover" },
  dotRow: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.3)" },
  backCircle: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  backCircleWeb: {
    marginLeft: 16,
    marginTop: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  shareCircle: {
    position: "absolute",
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  favoriteCircle: {
    position: "absolute",
    right: 64,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnailBadge: { position: "absolute" },
  content: { padding: 20, gap: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  categoryBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  categoryText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 22, fontFamily: "Fredoka_700Bold", lineHeight: 28 },
  instructor: { fontSize: 14, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 18, fontFamily: "Fredoka_700Bold", marginTop: 8 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  tags: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  tag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  tagText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressCard: { 
    borderRadius: 16, 
    padding: 18, 
    gap: 12,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  progressHeader: { 
    flexDirection: "row", 
    justifyContent: "space-between",
    alignItems: "center"
  },
  progressLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  progressPct: { fontSize: 24, fontFamily: "Fredoka_700Bold" },
  completeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  completeBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#FFF",
  },
  progressTrack: { height: 8, borderRadius: 4 },
  progressFill: { height: 8, borderRadius: 4 },
  progressStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressSub: { fontSize: 13, fontFamily: "Inter_500Medium" },
  progressRemaining: { fontSize: 12, fontFamily: "Inter_400Regular" },
  curriculumSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 12,
    marginTop: -8,
  },
  moduleItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  moduleNum: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  moduleNumText: { fontSize: 13, fontFamily: "Fredoka_700Bold" },
  moduleInfo: { flex: 1, gap: 4 },
  lessonProgressTrack: {
    height: 3,
    borderRadius: 1.5,
    width: "80%",
  },
  lessonProgressFill: {
    height: 3,
    borderRadius: 1.5,
  },
  moduleTitle: { fontSize: 14, fontFamily: "Fredoka_600SemiBold" },
  moduleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  moduleDuration: { fontSize: 12, fontFamily: "Inter_400Regular" },
  watchedPercentage: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  quizCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    marginBottom: 8,
  },
  quizTitle: { fontSize: 15, fontFamily: "Fredoka_700Bold", color: "#FFF" },
  quizSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 2 },
  cta: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: 1 },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  ctaPrice: { fontSize: 22, fontFamily: "Fredoka_700Bold" },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 24,
    height: 48,
  },
  ctaBtnText: { fontSize: 16, fontFamily: 'Fredoka_600SemiBold', color: '#FFF' },
  certBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, marginBottom: 8 },
  certBtnText: { fontSize: 15, fontFamily: 'Fredoka_600SemiBold', color: '#fff' },
  primaryButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 16,
  },
  enrollGradientBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    height: 56,
  },
  enrollBtnText: {
    fontSize: 16,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: SPACING.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
  },
  tabText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  statsStrip: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 14,
  },
  statChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  statValue: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  avgRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avgRatingText: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  rateCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
  },
  rateTitle: {
    fontSize: 16,
    fontFamily: "Fredoka_700Bold",
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  submitBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_700Bold",
    color: "#FFF",
  },
  thankYouRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  thankYouText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  reviewItem: {
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  reviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  reviewMeta: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  reviewComment: {
    fontSize: 13,
    lineHeight: 19,
    fontStyle: "italic",
  },
  showAllBtn: {
    paddingVertical: 8,
    alignItems: "center",
  },
  showAllText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
});
