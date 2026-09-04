import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Dimensions,
  FlatList,
  ImageBackground,
  RefreshControl,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2;
const SNAP_INTERVAL = CARD_WIDTH + 16;
import { CourseCard } from "@/components/CourseCard";
import { SectionHeader } from "@/components/SectionHeader";
import { WatchlistCard } from "@/components/WatchlistCard";
import { ProductCard } from "@/components/ProductCard";
import { HomeSkeleton } from "@/components/SkeletonLoader";
import { useAuth } from "@/context/AuthContext";
import { Product } from "@/data/mockData";
import { useColors } from "@/hooks/useColors";
import { useProgress } from "@/context/ProgressContext";
import { homeRepository, EMPTY_HOME_DATA } from "@/repositories/homeRepository";
import { useNetwork } from "@/context/NetworkContext";
import { useTabSwipe } from "@/hooks/useTabSwipe";

const CATEGORY_DETAILS = [
  { name: "Robotics", icon: "construct", desc: "Build & program smart autonomous robots", btnText: "Start Now", btnColor: "#0B6FAD", textColor: "#FFF" },
  { name: "IoT", icon: "wifi", desc: "Connect devices to the cloud effortlessly", btnText: "Explore", btnColor: "#17E5D3", textColor: "#063B4F" },
  { name: "Coding", icon: "code-slash", desc: "Learn logic, syntax, and app development", btnText: "Start Coding", btnColor: "#0B6FAD", textColor: "#FFF" },
  { name: "Embedded Systems", icon: "settings", desc: "Interface microcontrollers with sensors", btnText: "Create Now", btnColor: "#17E5D3", textColor: "#063B4F" },
];

function CategoryGrid({ onCategoryPress }: { onCategoryPress: (category: string) => void }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Browse by Category"
        onSeeAll={() => onCategoryPress("all")}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryCardsScroll}
      >
        {CATEGORY_DETAILS.map((cat) => (
          <Pressable
            key={cat.name}
            style={[styles.catActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onCategoryPress(cat.name)}
          >
            <View style={[styles.catIconCircle, { backgroundColor: colors.accent }]}>
              <Ionicons name={cat.icon as any} size={28} color={colors.accentForeground} />
            </View>
            <Text style={[styles.catCardName, { color: colors.foreground }]}>{cat.name}</Text>
            <Text style={[styles.catCardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{cat.desc}</Text>
            <View style={[styles.catCardBtn, { backgroundColor: cat.btnColor }]}>
              <Text style={[styles.catCardBtnText, { color: cat.textColor }]}>{cat.btnText}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function FeatureActionCards() {
  const colors = useColors();
  const actions = [
    {
      title: "Start a New Project",
      sub: "Create hands-on electronics kits",
      icon: "rocket",
      iconBg: "#0B6FAD",
      iconColor: "#FFF",
      btnBg: "#0B6FAD",
      btnIconColor: "#FFF",
      target: "/(tabs)/store",
    },
    {
      title: "My Progress",
      sub: "Track your learning progress",
      icon: "trophy",
      iconBg: "#17E5D3",
      iconColor: "#063B4F",
      btnBg: "#17E5D3",
      btnIconColor: "#063B4F",
      target: "/(tabs)/progress",
    },
    {
      title: "Continue Learning",
      sub: "Pick up your course where you left off",
      icon: "book",
      iconBg: "#0B6FAD",
      iconColor: "#FFF",
      btnBg: "#0B6FAD",
      btnIconColor: "#FFF",
      target: "/(tabs)/courses",
    },
  ];

  return (
    <View style={styles.featureCardsSection}>
      {actions.map((act, idx) => (
        <Pressable
          key={idx}
          style={[styles.featureActionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(act.target as any)}
        >
          <View style={[styles.featureCardIconWrapper, { backgroundColor: act.iconBg }]}>
            <Ionicons name={act.icon as any} size={22} color={act.iconColor} />
          </View>
          <View style={styles.featureCardContent}>
            <Text style={[styles.featureCardTitle, { color: colors.foreground }]}>{act.title}</Text>
            <Text style={[styles.featureCardSub, { color: colors.mutedForeground }]} numberOfLines={1}>{act.sub}</Text>
          </View>
          <View style={[styles.featureCardArrowBtn, { backgroundColor: act.btnBg }]}>
            <Ionicons name="chevron-forward" size={14} color={act.btnIconColor} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function HeroResumeCard({ item }: { item: any }) {
  const colors = useColors();
  if (!item) return null;

  const pct = item.videoProgress?.watchedPercentage ?? item.courseProgress ?? 0;
  const roundedPct = Math.min(100, Math.max(0, Math.round(pct)));

  return (
    <View style={[styles.heroResumeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heroResumeHeaderRow}>
        <View style={[styles.heroResumeBadge, { backgroundColor: colors.accent }]}>
          <Ionicons name="play-circle" size={14} color={colors.accentForeground} />
          <Text style={[styles.heroResumeBadgeText, { color: colors.accentForeground }]}>CONTINUE LEARNING</Text>
        </View>
        <Text style={[styles.heroResumePctText, { color: colors.mutedForeground }]}>{roundedPct}% completed</Text>
      </View>

      <View style={styles.heroResumeBodyRow}>
        <View style={styles.heroResumeImageContainer}>
          <Image
            source={
              item.courseThumbnail
                ? typeof item.courseThumbnail === "string"
                  ? { uri: item.courseThumbnail }
                  : item.courseThumbnail
                : require("@/assets/images/courses/course_robotics.webp")
            }
            style={styles.heroResumeImage}
          />
          <View style={styles.heroResumePlayCircle}>
            <Ionicons name="play" size={14} color={colors.primaryForeground} />
          </View>
        </View>

        <View style={styles.heroResumeTextContent}>
          <Text style={[styles.heroResumeCourseTitle, { color: colors.foreground }]} numberOfLines={1}>
            {item.courseTitle}
          </Text>
          <Text style={[styles.heroResumeLessonTitle, { color: colors.primary }]} numberOfLines={1}>
            Lesson: {item.moduleTitle}
          </Text>
          
          <View style={[styles.heroResumeProgressTrack, { backgroundColor: colors.muted }]}>
            <View style={[styles.heroResumeProgressFill, { width: `${roundedPct}%` as any, backgroundColor: colors.primary }]} />
          </View>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.heroResumeActionBtn,
          { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 }
        ]}
        onPress={async () => {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push({
            pathname: "/course/learn",
            params: { courseId: item.courseId, moduleId: item.moduleId },
          });
        }}
      >
        <Ionicons name="play" size={16} color={colors.primaryForeground} />
        <Text style={[styles.heroResumeActionBtnText, { color: colors.primaryForeground }]}>Resume Lesson</Text>
      </Pressable>
    </View>
  );
}

interface GuestWelcomeCardProps {
  colors: any;
  onSignIn: () => void;
  onBrowseCourses: () => void;
}

function GuestWelcomeCard({ colors, onSignIn, onBrowseCourses }: GuestWelcomeCardProps) {
  return (
    <View style={[styles.guestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.guestIconContainer, { backgroundColor: colors.accent }]}>
        <Ionicons name="sparkles" size={32} color={colors.accentForeground} />
      </View>
      <Text style={[styles.guestTitle, { color: colors.foreground }]}>Welcome to MakersFlow</Text>
      <Text style={[styles.guestSubtitleText, { color: colors.mutedForeground }]}>
        Sign in to track your progress, earn certificates, and continue where you left off.
      </Text>
      <View style={styles.guestActions}>
        <Pressable
          style={[styles.guestPrimaryBtn, { backgroundColor: "#0B6FAD" }]}
          onPress={onSignIn}
        >
          <Text style={styles.guestPrimaryBtnText}>Sign In</Text>
        </Pressable>
        <Pressable
          style={[styles.guestSecondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={onBrowseCourses}
        >
          <Text style={[styles.guestSecondaryBtnText, { color: colors.foreground }]}>Browse Courses</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { panHandlers, SwipeIndicator } = useTabSwipe("/(tabs)");
  const { user, isOffline } = useAuth();
  const { isConnected, addReconnectListener } = useNetwork();
  const { watchlist } = useProgress();
  const sortedWatchlist = useMemo(() => {
    return [...watchlist].sort(
      (a, b) => new Date(b.lastWatchedAt || 0).getTime() - new Date(a.lastWatchedAt || 0).getTime()
    );
  }, [watchlist]);
  const currentTime = useMemo(() => new Date(), []);
  const scrollViewRef = useRef<ScrollView>(null);
  const [popularCoursesY, setPopularCoursesY] = useState(0);

  const [courses, setCourses] = useState<any[]>([]);
  const [enrolledCourses, setEnrolledCourses] = useState<any[]>([]);
  const [popularCourses, setPopularCourses] = useState<any[]>([]);
  const [popularKits, setPopularKits] = useState<Product[]>([]);
  const [learningStreak, setLearningStreak] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const bannerFlatListRef = useRef<any>(null);
  const { refreshProgress } = useProgress();
  const [refreshing, setRefreshing] = useState(false);
  const [longestStreak, setLongestStreak] = useState(0);
  const [totalLessonsCompleted, setTotalLessonsCompleted] = useState(0);
  const [totalHoursLearned, setTotalHoursLearned] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);

  // Debounce ref — prevents rapid reconnect events from triggering repeated refreshes
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Single repository call — screen does not know data origin ─────────────
  const loadData = useCallback(async (isRefreshing = false) => {
    if (!isRefreshing) setIsLoading(true);
    try {
      await refreshProgress().catch(() => {});

      const result = await homeRepository.get(
        user?.id,
        isOffline,
        isRefreshing,
        (bgData) => {
          setEnrolledCourses(bgData.progress.enrolledCourses);
          setLearningStreak(bgData.progress.learningStreak);
          setLongestStreak(bgData.progress.longestStreak);
          setTotalLessonsCompleted(bgData.progress.totalLessonsCompleted);
          setTotalHoursLearned(bgData.progress.totalHoursLearned);
          setUnreadNotifCount(bgData.unreadNotifCount);
        }
      );
      const data = result.data;

      setPromotions(data.promotions);
      setCourses(data.courses);
      setPopularCourses(data.popularCourses);
      setPopularKits(data.popularKits as Product[]);
      setEnrolledCourses(data.progress.enrolledCourses);
      setLearningStreak(data.progress.learningStreak);
      setLongestStreak(data.progress.longestStreak);
      setTotalLessonsCompleted(data.progress.totalLessonsCompleted);
      setTotalHoursLearned(data.progress.totalHoursLearned);
      setUnreadNotifCount(data.unreadNotifCount);
    } catch (err) {
      console.error('[Home] loadData error:', err);
    } finally {
      setIsLoading(false);
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
        hasLoadedOnce.current = true;   // mark loaded so we never show the skeleton again
        loadData(false); // first load — show skeleton
      }
      // No background refresh on focus — data stays cached in memory
      // User can pull-to-refresh manually if they want fresh data
    }, [loadData])
  );

  // ── FIX: reload once the signed-in user resolves ──────────────────────────
  // On a cold start this screen often mounts before Supabase has restored the
  // session, so the first loadData() ran with user?.id === undefined.
  // homeRepository.get() then took its logged-out path and returned
  // EMPTY_PROGRESS — 0 courses, 0 completed, 0% — and because hasLoadedOnce was
  // already true nothing ever re-fetched. The stats sat at zero until a manual
  // pull-to-refresh. Watch for the id arriving and load the private data then.
  const loadedForUserRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid) {
      loadedForUserRef.current = null;
      return;
    }
    if (loadedForUserRef.current === uid) return;
    loadedForUserRef.current = uid;
    // Force a refresh so we bypass any logged-out cache entry written earlier.
    loadData(true);
  }, [user?.id, loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  useEffect(() => {
    setActiveBannerIndex(0);
    if (promotions.length > 0) {
      bannerFlatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [promotions.length]);

  useEffect(() => {
    if (promotions.length <= 1) return;

    const timer = setInterval(() => {
      const safeCurrent = Math.min(activeBannerIndex, promotions.length - 1);
      const nextIndex = (safeCurrent + 1) % promotions.length;
      setActiveBannerIndex(nextIndex);
      bannerFlatListRef.current?.scrollToIndex({
        index: nextIndex,
        animated: true,
      });
    }, 4000);

    return () => clearInterval(timer);
  }, [activeBannerIndex, promotions.length]);

  const handleBannerScroll = (event: any) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = Math.round(event.nativeEvent.contentOffset.x / slideSize);
    if (index !== activeBannerIndex) {
      setActiveBannerIndex(index);
    }
  };

  const completedCount = enrolledCourses.filter((p) => p.completedAt !== null).length;
  const avgProgress =
    enrolledCourses.length > 0
      ? Math.round(
          enrolledCourses.reduce((sum, p) => sum + p.progress, 0) / enrolledCourses.length
        )
      : 0;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading) {
    return <HomeSkeleton />;
  }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 17) return "Good afternoon";
    if (hour >= 17 && hour < 21) return "Good evening";
    return "Good night";
  };

  const getGreetingColor = () => {
    const hour = new Date().getHours();
    if (hour >= 21 || hour < 5) return "#FF6B00"; // night
    return "#0B6FAD"; // morning/afternoon/evening
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]} {...panHandlers}>
      <SwipeIndicator />
      {/* Fixed Header */}
      <View style={[styles.fixedHeader, { backgroundColor: colors.background, paddingTop: topPad + 16, borderBottomColor: colors.border }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: getGreetingColor() }]}>{getGreeting()}</Text>
            <Text style={[styles.userName, { color: colors.foreground }]}>{user?.name ?? "Student"}</Text>
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 }}>
              {currentTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </Text>
          </View>
          <View style={styles.headerButtons}>
            <Pressable
              style={styles.circleHeaderBtn}
              onPress={() => router.push("/(tabs)/news")}
            >
              <Ionicons name="document-text-outline" size={20} color={colors.foreground} />
            </Pressable>
            <Pressable
              style={styles.circleHeaderBtn}
              onPress={() => router.push("/(tabs)/store")}
            >
              <Ionicons name="cart-outline" size={20} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0B6FAD']} />
        }
      >

      {/* Guest Welcome Card or User Stats */}
      {!user ? (
        <GuestWelcomeCard
          colors={colors}
          onSignIn={() => router.push("/(auth)/login")}
          onBrowseCourses={() => {
            scrollViewRef.current?.scrollTo({ y: popularCoursesY, animated: true });
          }}
        />
      ) : (
        <>
          {/* Stats Card: solid Deep Sea #0B6FAD rounded-2xl with 3 columns */}
          <View style={[styles.statsBanner, { backgroundColor: "#0B6FAD" }]}>
            <View style={styles.statItem}>
              <Ionicons name="book" size={20} color="#FFF" style={{ marginBottom: 4 }} />
              <Text style={styles.statNumber}>{enrolledCourses.length}</Text>
              <Text style={styles.statLabel}>Courses Enrolled</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="checkmark-circle" size={20} color="#FFF" style={{ marginBottom: 4 }} />
              <Text style={styles.statNumber}>{completedCount}</Text>
              <Text style={styles.statLabel}>Courses Completed</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Ionicons name="trending-up" size={20} color="#FFF" style={{ marginBottom: 4 }} />
              <Text style={styles.statNumber}>{avgProgress}%</Text>
              <Text style={styles.statLabel}>Average Progress</Text>
            </View>
          </View>

          {/* Learning Streak Card & mini bar chart */}
          <StreakCarousel
            learningStreak={learningStreak}
            longestStreak={longestStreak}
            totalLessonsCompleted={totalLessonsCompleted}
            totalHoursLearned={totalHoursLearned}
            colors={colors}
          />

          {/* Hero Resume Card for Most Recent Active Course */}
          {user && sortedWatchlist.length > 0 && (
            <HeroResumeCard item={sortedWatchlist[0]} />
          )}

          {/* FEATURE ACTION CARDS below streak card */}
          <FeatureActionCards />
        </>
      )}

      {/* Banner Carousel */}
      {promotions.length > 0 && (
        <View style={styles.promoSection}>
          <FlatList
            ref={bannerFlatListRef}
            data={promotions}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleBannerScroll}
            keyExtractor={(item) => String(item.id)}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH - 40,
              offset: (SCREEN_WIDTH - 40) * index,
              index,
            })}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  const target = item.link ?? item.action_url;
                  if (target) router.push(target);
                }}
                style={styles.promoCardWrapper}
              >
                <ImageBackground
                  source={{ uri: item.image_url }}
                  style={styles.promoCard}
                  imageStyle={{ borderRadius: 16 }}
                >
                  <View style={styles.promoOverlay}>
                    <Text style={styles.promoTitle}>{item.title}</Text>
                    {item.subtitle && <Text style={styles.promoSubtitle}>{item.subtitle}</Text>}
                    <View style={styles.promoBadge}>
                      <Text style={styles.promoBadgeText}>Learn More</Text>
                      <Ionicons name="arrow-forward" size={14} color="#FFF" />
                    </View>
                  </View>
                </ImageBackground>
              </Pressable>
            )}
          />
          <View style={styles.dotsContainer}>
            {promotions.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.dot,
                  {
                    backgroundColor: idx === activeBannerIndex ? "#0B6FAD" : colors.border,
                    width: idx === activeBannerIndex ? 16 : 8,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      )}

      {/* Other In-Progress Courses */}
      {user && sortedWatchlist.length > 1 && (
        <View style={styles.section}>
          <SectionHeader 
            title="In-Progress Courses" 
            subtitle={`${sortedWatchlist.length - 1} other course${sortedWatchlist.length - 1 > 1 ? 's' : ''} in progress`}
            onSeeAll={() => router.push("/(tabs)/courses")} 
          />
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
          >
            {sortedWatchlist.slice(1).map((item: any) => (
              <WatchlistCard key={`${item.courseId}-${item.moduleId}`} item={item} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Popular Courses Section */}
      {popularCourses.length > 0 && (
        <View 
          style={styles.section}
          onLayout={(e) => setPopularCoursesY(e.nativeEvent.layout.y)}
        >
          <SectionHeader 
            title="Popular Courses" 
            onSeeAll={() => router.push({ pathname: "/(tabs)/store", params: { category: "Courses" } })} 
          />
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
          >
            {popularCourses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Custom PDF action button category cards */}
      <CategoryGrid
        onCategoryPress={(cat) => {
          if (cat === "all") {
            router.push({
              pathname: "/(tabs)/search",
              params: { query: "" }
            });
          } else {
            router.push({
              pathname: "/(tabs)/search",
              params: { category: cat }
            });
          }
        }}
      />

      {/* Popular Kits Section */}
      {popularKits.length > 0 && (
        <View style={styles.section}>
          <SectionHeader 
            title="Popular Kits" 
            onSeeAll={() => router.push({ pathname: "/(tabs)/store", params: { category: "Physical Kits" } })} 
          />
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}
            snapToInterval={SNAP_INTERVAL}
            decelerationRate="fast"
          >
            {popularKits.map((product) => (
              <ProductCard key={product.id} product={product} variant="flat" />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Ecosystem of MakersFlow */}
      <View style={styles.section}>
        <View style={styles.sectionTitleContainer}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Ecosystem of MakersFlow</Text>
        </View>
        <View style={[styles.ecosystemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.ecosystemHeader}>
            <Ionicons name="apps" size={28} color="#0B6FAD" />
            <Text style={[styles.ecosystemTitle, { color: colors.foreground }]}>Our Partners & Brands</Text>
          </View>
          <Text style={[styles.ecosystemDescription, { color: colors.mutedForeground }]}>
            Discover the brands and partners that make up the MakersFlow ecosystem
          </Text>
          <View style={styles.brandsContainer}>
            <View style={[styles.brandPlaceholder, { backgroundColor: colors.muted, borderColor: colors.border, overflow: 'hidden' }]}>
              <Image
                source={require('@/assets/images/partners/Flow Logo Gradient- v2.webp')}
                style={{ width: '100%', height: '100%', resizeMode: 'cover' }}
              />
            </View>
            <View style={[styles.brandPlaceholder, { backgroundColor: colors.muted, borderColor: colors.border, overflow: 'hidden' }]}>
              <Image
                source={require('@/assets/images/partners/foundation_logo.png')}
                style={{ width: '100%', height: '100%', resizeMode: 'cover' }}
              />
            </View>
          </View>
        </View>
      </View>
      </ScrollView>
    </View>
  );
}

interface StreakCarouselProps {
  learningStreak: number;
  longestStreak: number;
  totalLessonsCompleted: number;
  totalHoursLearned: number;
  colors: any;
}

function StreakCarousel({
  learningStreak,
  longestStreak,
  totalLessonsCompleted,
  totalHoursLearned,
  colors,
}: StreakCarouselProps) {
  const [activeStreakIndex, setActiveStreakIndex] = useState(0);

  const streakData = [
    {
      id: "current_streak",
      title: "Learning Streak",
      value: `${learningStreak} days`,
      icon: "flash",
      bgColor: colors.accent,
      iconBg: "#FF6B00",
      label: "Active Days",
    },
    {
      id: "longest_streak",
      title: "Longest Streak",
      value: `${longestStreak} days`,
      icon: "trophy",
      bgColor: colors.accent,
      iconBg: "#17E5D3",
      label: "Personal Best",
    },
    {
      id: "lessons_completed",
      title: "Lessons Completed",
      value: `${totalLessonsCompleted} lessons`,
      icon: "book",
      bgColor: colors.accent,
      iconBg: "#17E5D3",
      label: "Lessons Done",
    },
    {
      id: "hours_learned",
      title: "Learning Time",
      value: `${totalHoursLearned} hrs`,
      icon: "time",
      bgColor: colors.accent,
      iconBg: "#17E5D3",
      label: "Hours Learned",
    }
  ];

  return (
    <View style={styles.carouselSection}>
      <FlatList
        data={streakData}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const slideSize = e.nativeEvent.layoutMeasurement.width;
          const index = Math.round(e.nativeEvent.contentOffset.x / slideSize);
          setActiveStreakIndex(index);
        }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.streakCardWrapper}>
            <View style={[styles.streakCard, { backgroundColor: item.bgColor, borderColor: "#D6E9F2" }]}>
              <View style={[styles.streakIconContainer, { backgroundColor: item.iconBg }]}>
                <Ionicons name={item.icon as any} size={28} color={item.id === "current_streak" ? "#FFF" : "#0B6FAD"} />
              </View>
              <View style={styles.streakContent}>
                <View style={styles.streakTitleRow}>
                  <Text style={styles.streakTitle}>{item.title}</Text>
                  {item.id === "current_streak" && (
                    <View style={styles.keepItUpBadge}>
                      <Text style={styles.keepItUpText}>Keep it up!</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.streakValue, { color: colors.foreground }]}>{item.value}</Text>
                <Text style={[styles.streakLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
              </View>
              
              {/* Mini bar chart visual on the right in Aqua */}
              <View style={styles.miniBarChart}>
                <View style={[styles.miniBar, { height: 12 }]} />
                <View style={[styles.miniBar, { height: 18 }]} />
                <View style={[styles.miniBar, { height: 15 }]} />
                <View style={[styles.miniBar, { height: 22 }]} />
                <View style={[styles.miniBar, { height: 28, backgroundColor: "#0B6FAD" }]} />
              </View>
            </View>
          </View>
        )}
      />
      <View style={styles.streakDotsContainer}>
        {streakData.map((_, idx) => (
          <View
            key={idx}
            style={[
              styles.streakDot,
              {
                backgroundColor: idx === activeStreakIndex ? "#0B6FAD" : colors.border,
                width: idx === activeStreakIndex ? 16 : 8,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fixedHeader: {
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  scrollView: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  greeting: { fontSize: 14, fontFamily: "Fredoka_500Medium" },
  userName: { fontSize: 22, fontFamily: "Fredoka_700Bold" },
  headerButtons: {
    flexDirection: "row",
    gap: 8,
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
  whiteSquareBtn: {
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
  notifBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: "#FFF", fontSize: 10, fontFamily: "Fredoka_700Bold" },
  statsBanner: {
    marginHorizontal: 20,
    borderRadius: 16,
    flexDirection: "row",
    paddingVertical: 20,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statItem: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  statNumber: { fontSize: 26, fontFamily: "Fredoka_700Bold", color: "#FFF", marginBottom: 2 },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.9)", marginTop: 4, textAlign: "center" },
  statDivider: { width: 1, backgroundColor: "rgba(255,255,255,0.2)" },
  
  promoSection: {
    marginBottom: 28,
  },
  promoCardWrapper: {
    width: SCREEN_WIDTH - 40,
    marginHorizontal: 20,
    height: 160,
  },
  promoCard: {
    flex: 1,
    height: 160,
    justifyContent: "flex-end",
  },
  promoOverlay: {
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 16,
    flex: 1,
    justifyContent: "flex-end",
    gap: 4,
  },
  promoTitle: {
    color: "#FFF",
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
  },
  promoSubtitle: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  promoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  promoBadgeText: {
    color: "#FFF",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  section: { marginBottom: 32 },
  sectionTitleContainer: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: "Fredoka_700Bold",
  },
  carouselContent: { paddingLeft: 20, paddingRight: 20 },
  
  categoryCardsScroll: {
    paddingLeft: 20,
    paddingRight: 20,
    gap: 16,
  },
  catActionCard: {
    width: 170,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  catIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  catCardName: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    marginBottom: 6,
    textAlign: "center",
  },
  catCardDesc: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 12,
    height: 32,
    lineHeight: 16,
  },
  catCardBtn: {
    width: "100%",
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  catCardBtnText: {
    fontSize: 12,
    fontFamily: "Fredoka_600SemiBold",
  },

  ecosystemCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
  },
  ecosystemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  ecosystemTitle: {
    fontSize: 18,
    fontFamily: "Fredoka_700Bold",
  },
  ecosystemDescription: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginBottom: 24,
  },
  brandsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  brandPlaceholder: {
    width: 100,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  carouselSection: {
    marginBottom: 24,
    alignItems: "center",
  },
  streakCardWrapper: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 20,
  },
  streakCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 20,
  },
  streakIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  streakContent: {
    flex: 1,
    gap: 4,
  },
  streakTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  streakTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#0B6FAD",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  keepItUpBadge: {
    backgroundColor: "#17E5D3",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  keepItUpText: {
    fontSize: 9,
    fontFamily: "Fredoka_700Bold",
    color: "#063B4F",
  },
  streakValue: {
    fontSize: 24,
    fontFamily: "Fredoka_700Bold",
  },
  streakLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  miniBarChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 32,
  },
  miniBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: "#17E5D3",
  },
  streakDotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  streakDot: {
    height: 8,
    borderRadius: 4,
  },
  
  guestCard: {
    marginHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  guestIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  guestTitle: {
    fontSize: 20,
    fontFamily: "Fredoka_700Bold",
    marginBottom: 8,
  },
  guestSubtitleText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  guestActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  guestPrimaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  guestPrimaryBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    color: "#FFF",
  },
  guestSecondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  guestSecondaryBtnText: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
  },

  // FEATURE ACTION CARDS STYLES (PDF item #8)
  featureCardsSection: {
    marginHorizontal: SPACING.xl,
    gap: SPACING.md,
    marginBottom: 28,
  },
  featureActionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  featureCardIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  featureCardContent: {
    flex: 1,
  },
  featureCardTitle: {
    fontSize: 15,
    fontFamily: "Fredoka_600SemiBold",
    marginBottom: 2,
  },
  featureCardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  featureCardArrowBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  // HERO RESUME CARD STYLES
  heroResumeCard: {
    marginHorizontal: SPACING.xl,
    marginTop: 16,
    marginBottom: 24,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  heroResumeHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heroResumeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroResumeBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  heroResumePctText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  heroResumeBodyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  heroResumeImageContainer: {
    position: "relative",
    width: 60,
    height: 60,
    borderRadius: 12,
    overflow: "hidden",
    marginRight: 14,
  },
  heroResumeImage: {
    width: "100%",
    height: "100%",
  },
  heroResumePlayCircle: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroResumeTextContent: {
    flex: 1,
  },
  heroResumeCourseTitle: {
    fontSize: 15,
    fontFamily: "Fredoka_700Bold",
    marginBottom: 2,
  },
  heroResumeLessonTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  heroResumeProgressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    width: "100%",
  },
  heroResumeProgressFill: {
    height: "100%",
    borderRadius: 3,
  },
  heroResumeActionBtn: {
    height: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroResumeActionBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontFamily: "Fredoka_700Bold",
  },
});
