import { Feather, MaterialIcons, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, Stack } from "expo-router";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ToastAndroid,
  Alert,
  ActivityIndicator as RNActivityIndicator,
  Share,
  Linking,
  TextInput,
} from "react-native";
import * as FileSystem from 'expo-file-system/legacy';
import { getDownloadedPath, setDownloadedPath, removeDownloadedPath, downloadLessonVideo } from '@/lib/downloadStorage';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING } from "@/constants/spacing";
import { VideoPlayerEnhanced } from "@/components/VideoPlayerEnhanced";
import { ResumeModal } from "@/components/ResumeModal";
import { LessonCompleteModal } from "@/components/LessonCompleteModal";
import { LearningTabs } from "@/components/LearningTabs";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useFavorites } from "@/context/FavoritesContext";
import { useProgress } from "@/context/ProgressContext";
import { getCourseById, getCourseModules } from "@/services/courseDataProvider";
import { markLessonComplete, upsertLessonProgress, fetchCourseLessonsProgress } from "@/lib/progressStorage";
import { apiRequest } from "@/lib/auth/apiClient";
import { getEnrollment, isExpired, completeCourse } from "@/services/enrollmentService";
import { onSessionExpired } from "@/lib/sessionEvents";
import { ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchMyReview, upsertReview } from "@/services/reviewService";
import { issueCertificate } from "@/services/certificateService";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LearnScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { courseId, moduleId, lessonId } = useLocalSearchParams<{ courseId: string; moduleId: string; lessonId?: string }>();
  const { user } = useAuth();
  const { isInWatchLater, toggleWatchLater, addDownloadedLesson, removeDownloadedLesson } = useFavorites();
  const { completeModule } = useProgress();

  const handleShare = async () => {
    try {
      await Share.share({
        title: course?.title,
        message: `Check out "${course?.title || "this course"}" on MakersFlow!\n\nOpen in app: makersflow://course/${courseId}\n\nDownload MakersFlow: https://play.google.com/store/apps/details?id=com.makersflow.app`,
      });
    } catch (error) {
      console.error("Error sharing course:", error);
    }
  };

  const [course, setCourse] = useState<any>(null);
  const [lessons, setLessons] = useState<any[]>([]); // flat lessons
  const [lessonsProgress, setLessonsProgress] = useState<any[]>([]);
  const [totalLessons, setTotalLessons] = useState(0); // authoritative count from DB
  const [isLoading, setIsLoading] = useState(true);
  const [enrollment, setEnrollment] = useState<any>(null);
  const [isEnrollmentExpired, setIsEnrollmentExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "content">("overview");
  const [activeModuleId, setActiveModuleId] = useState<string | undefined>(lessonId || moduleId);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [resumeFromTime, setResumeFromTime] = useState(0);
  const [downloadedPath, setDownloadedPathState] = useState<string | null>(null);
  const [downloadedMap, setDownloadedMap] = useState<Record<string, string | null>>({});
  const [downloadingLessonId, setDownloadingLessonId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  // Signed video URL fetched from NestJS GET /lessons/:id/video.
  // Kept in runtime state only — never persisted; expires after 300 s.
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [isSignedUrlLoading, setIsSignedUrlLoading] = useState(false);

  const [myReview, setMyReview] = useState<any>(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);

  useEffect(() => {
    if (!activeModuleId) return;
    getDownloadedPath(activeModuleId).then((path) => {
      setDownloadedPathState(path);
      if (path) {
        setDownloadedMap((prev) => ({ ...prev, [activeModuleId]: path }));
      }
    });
  }, [activeModuleId]);

  const [lessonResources, setLessonResources] = useState<
    { id: string; title: string; url: string; type: string | null; size_bytes?: number | null }[]
  >([]);
  const [lessonNotes, setLessonNotes] = useState<string[]>([]);
  
  useEffect(() => {
    if (!activeModuleId || isNaN(Number(activeModuleId))) {
      setLessonResources([]);
      setLessonNotes([]);
      return;
    }
    (async () => {
      // 1. Fetch lesson resources via NestJS
      try {
        const res = await apiRequest<any>(`/lesson-resources/lesson/${activeModuleId}`);
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        if (Array.isArray(list)) {
          setLessonResources(list.map((r: any) => ({
            id: String(r.id),
            title: r.title,
            url: r.url,
            type: r.type ?? null,
            size_bytes: r.size_bytes ? Number(r.size_bytes) : null,
          })));
        } else {
          setLessonResources([]);
        }
      } catch {
        setLessonResources([]);
      }

      // 2. Fetch lesson notes via NestJS
      try {
        const res = await apiRequest<any>(`/lesson-notes/lesson/${activeModuleId}`);
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        if (Array.isArray(list)) {
          setLessonNotes(list.map((n: any) => n.content));
        } else {
          setLessonNotes([]);
        }
      } catch {
        setLessonNotes([]);
      }
    })();
  }, [activeModuleId]);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      Alert.alert(
        "Session expired",
        "Your session has expired, so your progress can't be saved. Please log in again to continue.",
        [
          { text: "Keep Watching", style: "cancel" },
          { text: "Log In", onPress: () => router.replace("/(auth)/login") },
        ],
      );
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadData() {
      if (!courseId) return;
      setIsLoading(true);
      try {
        const courseData = await getCourseById(courseId);
        if (courseData) {
          const mappedCourse = {
            id: String(courseData.id),
            title: courseData.title,
            category: courseData.category || "General",
            level: courseData.level ? (courseData.level.charAt(0).toUpperCase() + courseData.level.slice(1)) : "Beginner",
            price: courseData.price || 0,
            isFree: courseData.is_free,
            thumbnail: courseData.thumbnail_url ? { uri: courseData.thumbnail_url } : require('@/assets/images/courses/course_robotics.webp'),
            instructor: "MakersFlow Instructor",
            rating: 4.8,
            reviews: 120,
            description: courseData.description || "",
            tags: [courseData.category || "Robotics"],
          };
          setCourse(mappedCourse);

          const modulesData = await getCourseModules(courseId);
          const flatLessons = modulesData.flatMap((m: any) =>
            m.lessons.map((l: any) => ({
              id: l.id,
              title: l.title,
              videoUrl: l.video_url || "",
              duration: l.duration_minutes ? `${l.duration_minutes} mins` : "0 mins",
              description: l.content || "",
              notes: l.notes ? [l.notes] : [],
              resources: [],
            }))
          );
          setLessons(flatLessons);
          setTotalLessons(flatLessons.length);

          // Populate downloaded map for all lessons
          const map: Record<string, string | null> = {};
          await Promise.all(
            flatLessons.map(async (l: any) => {
              const p = await getDownloadedPath(l.id);
              if (p) map[l.id] = p;
            })
          );
          setDownloadedMap((prev) => ({ ...prev, ...map }));

          if (!activeModuleId && flatLessons.length > 0) {
            setActiveModuleId(lessonId || moduleId || flatLessons[0].id);
          }

          if (user?.id) {
            const progressData = await fetchCourseLessonsProgress(user.id, courseId);
            setLessonsProgress(progressData);

            const enrollData = await getEnrollment(user.id, courseId);
            setEnrollment(enrollData);
            if (enrollData && isExpired(enrollData)) {
              setIsEnrollmentExpired(true);
            }
          }
        }
      } catch (error) {
        console.error("[LearnScreen] load error", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [courseId, user?.id]);

  // Show resume modal when switching to a lesson that has saved progress.
  // Guard: only run after the full data load is done (isLoading=false) so
  // we never read stale lessonsProgress from a previous lesson (Bug 6).
  useEffect(() => {
    if (!activeModuleId || isLoading) return;
    const activeProg = lessonsProgress.find((p) => String(p.lesson_id) === activeModuleId);
    const savedTime = activeProg?.current_time_secs;
    if (savedTime && savedTime > 30) {
      setResumeFromTime(savedTime);
      setShowResumeModal(true);
    } else {
      setShowResumeModal(false);
    }
  }, [activeModuleId, isLoading]);

  // Fetch a short-lived signed URL from NestJS whenever the active lesson changes.
  // activeModuleId is the lesson ID (confirmed: flatLessons maps l.id → id).
  // The backend (GET /lessons/:id/video) enforces enrollment — we never bypass
  // this check client-side, and we never fall back to the raw video_url.
  useEffect(() => {
    if (!activeModuleId || isLoading) return;

    // Offline playback: downloaded file is already local; no signed URL needed.
    const localPath = downloadedMap[activeModuleId];
    if (localPath) {
      setSignedVideoUrl(null);
      setIsSignedUrlLoading(false);
      return;
    }

    let cancelled = false;
    setSignedVideoUrl(null);
    setIsSignedUrlLoading(true);

    apiRequest<{ signedUrl: string; expiresIn: number }>(
      `/lessons/${activeModuleId}/video`,
    )
      .then((res) => {
        if (!cancelled) {
          const url = res?.signedUrl ?? null;
          if (!url) {
            console.warn('[LearnScreen] No signedUrl in response for lesson', activeModuleId);
          }
          setSignedVideoUrl(url);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          // 401 → apiRequest auto-refreshes; reaches here only if session is gone
          // 403 → not enrolled → do NOT fall back to raw video_url
          // 404 → lesson has no video
          console.warn('[LearnScreen] Signed video URL fetch failed:', err?.message ?? err);
          setSignedVideoUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSignedUrlLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeModuleId, isLoading, downloadedMap]);

  const isCourseCompleted = !!enrollment?.completed_at;
  const completedModules = lessonsProgress.filter((p) => p.is_completed).length;
  const effectiveTotalLessons = totalLessons || lessons.length;
  const remainingModules = isCourseCompleted ? 0 : (effectiveTotalLessons - completedModules);
  const progressPercentage = isCourseCompleted
    ? 100
    : (effectiveTotalLessons > 0 ? Math.min(100, Math.round((completedModules / effectiveTotalLessons) * 100)) : 0);

  const activeModule = lessons.find((m) => m.id === activeModuleId) ?? lessons[0];
  const activeLessonProgress = lessonsProgress.find((p) => String(p.lesson_id) === activeModule?.id);
  const initialTime = showResumeModal ? 0 : (activeLessonProgress?.current_time_secs ?? 0);
  const isSaved = activeModule ? isInWatchLater(activeModule.id) : false;

  // Stable callbacks — prevent VideoPlayerEnhanced from recreating its
  // polling interval on every render (Bug 3 & 7)
  const handleProgressUpdate = useCallback(async (currentTime: number, duration: number) => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    const watchPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), currentTime, watchPercentage);
    try {
      const progressData = await fetchCourseLessonsProgress(user.id, Number(courseId));
      setLessonsProgress(progressData);
    } catch (e) {
      console.error(e);
    }
  }, [user?.id, courseId, activeModule?.id]);

  const handleVideoComplete = useCallback(async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    await markLessonComplete(user.id, Number(courseId), Number(activeModule.id));
    await completeModule(String(Number(courseId)), String(Number(activeModule.id)));
    let updatedProgress: any[] = [];
    try {
      updatedProgress = await fetchCourseLessonsProgress(user.id, Number(courseId));
      setLessonsProgress(updatedProgress);
    } catch (e) {
      console.error(e);
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const completedCount = updatedProgress.filter((p) => p.is_completed).length;
    if (totalLessons > 0 && completedCount >= totalLessons) {
      if (!enrollment?.completed_at) {
        try {
          await completeCourse(user.id, Number(courseId));
          const enrollData = await getEnrollment(user.id, Number(courseId));
          setEnrollment(enrollData);
        } catch (e) {
          console.error('[CompleteCourse] error:', e);
        }
      }
      // Self-issue certificate on NestJS backend
      issueCertificate(Number(courseId)).catch(() => {});

      const certKey = `@cert_shown:${user.id}:${courseId}`;
      const alreadyShown = await AsyncStorage.getItem(certKey);
      if (!alreadyShown) {
        await AsyncStorage.setItem(certKey, 'true');
        router.push({
          pathname: '/certificate',
          params: {
            courseName: course?.title ?? '',
            studentName: user.name ?? '',
            completionDate: new Date().toISOString(),
            level: (course as any)?.level,
            instructor: (course as any)?.instructor,
          },
        });
        return;
      }
    }

    setShowCompleteModal(true);
  }, [user?.id, courseId, activeModule?.id, totalLessons, enrollment?.completed_at, course?.title, lessons]);

  useEffect(() => {
    if (!user?.id || !courseId || isLoading) return;
    fetchMyReview(user.id, courseId).then((r) => {
      if (r) {
        setMyReview(r);
        setReviewRating(r.rating);
        setReviewText(r.comment || '');
      }
    }).catch(() => {});
  }, [user?.id, courseId, isLoading]);

  const handleSubmitReview = async () => {
    if (!user?.id || !courseId || reviewRating === 0) {
      showToast('Please select a rating first');
      return;
    }
    setIsSubmittingReview(true);
    try {
      await upsertReview(user.id, courseId, reviewRating, reviewText);
      showToast('Review submitted! Thank you.');
      setShowReviewForm(false);
      setMyReview({ rating: reviewRating, comment: reviewText });
    } catch (e) {
      showToast('Failed to submit review. Please try again.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color="#0B6FAD" />
        <Text style={{ marginTop: 12, fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Loading...</Text>
      </View>
    );
  }

  if (!course) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground, padding: 24, fontFamily: "Inter_400Regular" }}>Course not found.</Text>
      </View>
    );
  }



  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert('', message);
    }
  };

  const handleDownloadLesson = async (targetModule?: any) => {
    const target = targetModule || activeModule;
    if (!target?.videoUrl || !target?.id) {
      showToast('No video available to download');
      return;
    }

    const currentLocalPath = downloadedMap[target.id] || (target.id === activeModule?.id ? downloadedPath : null);

    if (currentLocalPath) {
      Alert.alert(
        "Remove Download",
        `Remove "${target.title}" from offline storage?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              await removeDownloadedPath(target.id);
              setDownloadedMap((prev) => ({ ...prev, [target.id]: null }));
              if (target.id === activeModule?.id) {
                setDownloadedPathState(null);
              }
              showToast('Download removed');
            },
          },
        ]
      );
      return;
    }

    setIsDownloading(true);
    setDownloadingLessonId(target.id);
    setDownloadProgress(0);

    try {
      const savedPath = await downloadLessonVideo(target.id, target.videoUrl, (pct) => {
        setDownloadProgress(pct);
      });

      setDownloadedMap((prev) => ({ ...prev, [target.id]: savedPath }));
      if (user?.id) {
        addDownloadedLesson({
          courseId,
          moduleId: target.id,
          lessonId: target.id,
          courseTitle: course.title,
          lessonTitle: target.title,
          courseThumbnail: course.thumbnail,
        }).catch(() => {});
      }
      if (target.id === activeModule?.id) {
        setDownloadedPathState(savedPath);
      }
      showToast('✅ Downloaded for offline use');
    } catch (err: any) {
      console.error('[Download] Error downloading lesson:', err);
      Alert.alert('Download Failed', err?.message || 'Could not download video. Please check your storage or connection.');
    } finally {
      setIsDownloading(false);
      setDownloadingLessonId(null);
      setDownloadProgress(null);
    }
  };

  const handleWatchLaterToggle = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasAdded = !isSaved;
    toggleWatchLater({
      courseId,
      moduleId: activeModule.id,
      lessonId: activeModule.id,
      courseTitle: course.title,
      lessonTitle: activeModule.title,
      courseThumbnail: course.thumbnail,
    });
    showToast(wasAdded ? 'Added to Watch Later' : 'Removed from Watch Later');
  };



  const handleResumeVideo = () => {
    setShowResumeModal(false);
  };

  const handleStartOver = async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    setShowResumeModal(false);
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), 0, 0);
    const progressData = await fetchCourseLessonsProgress(user.id, Number(courseId));
    setLessonsProgress(progressData);
  };

  const handleReplayLesson = async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    setShowCompleteModal(false);
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), 0, 0);
    const progressData = await fetchCourseLessonsProgress(user.id, Number(courseId));
    setLessonsProgress(progressData);
  };

  const handleNextLesson = () => {
    setShowCompleteModal(false);
    const currentIndex = lessons.findIndex((m) => m.id === activeModule.id);
    const nextModule = lessons[currentIndex + 1];
    if (nextModule) {
      setActiveModuleId(nextModule.id);
    }
  };

  const getNextModule = () => {
    if (!activeModule) return null;
    const currentIndex = lessons.findIndex((m) => m.id === activeModule.id);
    return lessons[currentIndex + 1];
  };

  const getPreviousModule = () => {
    if (!activeModule) return null;
    const currentIndex = lessons.findIndex((m) => m.id === activeModule.id);
    return lessons[currentIndex - 1];
  };

  const handleMarkComplete = async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    if (isMarkingComplete) return;
    setIsMarkingComplete(true);
    try {
      await markLessonComplete(user.id, courseId, activeModule.id);
      await completeModule(courseId, activeModule.id);
      let updatedProgress: any[] = [];
      try {
        updatedProgress = await fetchCourseLessonsProgress(user.id, courseId);
        setLessonsProgress(updatedProgress);
      } catch (e) {
        console.error(e);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const completedCount = updatedProgress.filter((p) => p.is_completed).length;
      if (totalLessons > 0 && completedCount >= totalLessons) {
        if (!enrollment?.completed_at) {
          try {
            await completeCourse(user.id, courseId);
            const enrollData = await getEnrollment(user.id, courseId);
            setEnrollment(enrollData);
          } catch (e) {
            console.error('[CompleteCourse] error:', e);
          }
        }
        const certKey = `@cert_shown:${user.id}:${courseId}`;
        const alreadyShown = await AsyncStorage.getItem(certKey);
        if (!alreadyShown) {
          await AsyncStorage.setItem(certKey, 'true');
          router.push({
            pathname: '/certificate',
            params: {
              courseName: course?.title ?? '',
              studentName: user.name ?? '',
              completionDate: new Date().toISOString(),
              level: (course as any)?.level,
              instructor: (course as any)?.instructor,
            },
          });
          return;
        }
      }

      setShowCompleteModal(true);
    } catch (e) {
      console.error('[markComplete] error:', e);
      showToast('Failed to mark lesson complete. Please try again.');
    } finally {
      setIsMarkingComplete(false);
    }
  };

  const handlePreviousLesson = async () => {
    await Haptics.selectionAsync();
    if (!activeModule) return;
    const currentIndex = lessons.findIndex((m) => m.id === activeModule.id);
    const prevModule = lessons[currentIndex - 1];
    if (prevModule) {
      setActiveModuleId(prevModule.id);
    }
  };

  const handleNextLessonNav = async () => {
    await Haptics.selectionAsync();
    if (!activeModule) return;
    const currentIndex = lessons.findIndex((m) => m.id === activeModule.id);
    const nextModule = lessons[currentIndex + 1];
    if (nextModule) {
      setActiveModuleId(nextModule.id);
    }
  };

  const handleModuleSelect = async (moduleId: string) => {
    await Haptics.selectionAsync();
    setActiveModuleId(moduleId);
    setActiveTab("overview");
  };

  const getModuleState = (module: any, index: number) => {
    const modProgress = lessonsProgress.find((p) => String(p.lesson_id) === module.id);
    const isCompleted = modProgress?.is_completed || false;
    const isCurrent = activeModuleId === module.id;
    
    const previousModule = lessons[index - 1];
    const prevProgress = previousModule ? lessonsProgress.find((p) => String(p.lesson_id) === previousModule.id) : null;
    const canAccess = index === 0 || !previousModule || prevProgress?.is_completed;
    const isLocked = !canAccess;
    
    return { isCompleted, isCurrent, isLocked };
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(tabs)/courses");
          }
        }} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#0B6FAD" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          Learning
        </Text>
        <Pressable onPress={handleWatchLaterToggle} style={styles.watchLaterBtn}>
          <Ionicons
            name={isSaved ? "bookmark" : "bookmark-outline"}
            size={20}
            color={isSaved ? "#0B6FAD" : colors.mutedForeground}
          />
        </Pressable>
        <Pressable onPress={() => handleDownloadLesson()} style={styles.downloadBtn} disabled={isDownloading}>
          {isDownloading ? (
            <View style={{ alignItems: 'center' }}>
              <RNActivityIndicator size="small" color="#0B6FAD" />
              {downloadProgress !== null && (
                <Text style={{ fontSize: 9, color: "#0B6FAD", fontFamily: "Inter_400Regular" }}>
                  {Math.round(downloadProgress)}%
                </Text>
              )}
            </View>
          ) : (
            <Ionicons name="download" size={20} color={downloadedPath ? '#17E5D3' : colors.mutedForeground} />
          )}
        </Pressable>
        <Pressable onPress={handleShare} style={styles.shareBtn}>
          <Ionicons name="share-social" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Course Header - Compact */}
      <View style={[styles.courseHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Text style={[styles.courseTitle, { color: colors.foreground }]} numberOfLines={2}>
          {course.title}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statItemInline}>
            <Ionicons name="checkmark-circle" size={13} color="#17E5D3" />
            <Text style={[styles.statTextInline, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {completedModules} Completed
            </Text>
          </View>
          {remainingModules > 0 && (
            <>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItemInline}>
                <Ionicons name="ellipse-outline" size={13} color={colors.mutedForeground} />
                <Text style={[styles.statTextInline, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {remainingModules} Remaining
                </Text>
              </View>
            </>
          )}
        </View>
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBarTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${progressPercentage}%` as any, backgroundColor: "#0B6FAD" },
              ]}
            />
          </View>
          <Text style={[styles.progressBarText, { color: colors.mutedForeground }]}>
            {Math.round(progressPercentage)}%
          </Text>
        </View>
      </View>

      {/* Video Player */}
      <View style={styles.videoWrapper}>
        {isEnrollmentExpired ? (
          <View style={[styles.expiryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="alert-triangle" size={32} color="#DC2626" />
            <Text style={[styles.expiryText, { color: colors.foreground }]}>
              Your access expired on {enrollment?.expires_at ? new Date(enrollment.expires_at).toLocaleDateString() : ""}
            </Text>
            <Pressable
              style={[styles.supportBtn, { backgroundColor: "#0B6FAD" }]}
              onPress={() => {
                Linking.openURL('mailto:support@edodwaja.com?subject=Course Access Renewal');
              }}
            >
              <Text style={styles.supportBtnText}>Contact Support</Text>
            </Pressable>
          </View>
        ) : (
          (() => {
            // Protected video playback — never exposes raw video_url for enrolled content.
            // 1. Offline: serve the downloaded local file.
            const localPath = downloadedMap[activeModule?.id] ?? downloadedPath;
            if (localPath) {
              return (
                <VideoPlayerEnhanced
                  videoUrl={localPath}
                  initialTime={initialTime}
                  onProgressUpdate={handleProgressUpdate}
                  onComplete={handleVideoComplete}
                />
              );
            }

            // 2. Signed URL still loading from NestJS.
            if (isSignedUrlLoading) {
              return (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', minHeight: 200 }}>
                  <ActivityIndicator size="large" color="#0B6FAD" />
                  <Text style={{ color: '#fff', marginTop: 8, fontFamily: 'Inter_400Regular', fontSize: 13 }}>
                    Loading video…
                  </Text>
                </View>
              );
            }

            // 3. Signed URL available — play it.
            if (signedVideoUrl) {
              return (
                <VideoPlayerEnhanced
                  videoUrl={signedVideoUrl}
                  initialTime={initialTime}
                  onProgressUpdate={handleProgressUpdate}
                  onComplete={handleVideoComplete}
                />
              );
            }

            // 4. Signed URL unavailable (403 not enrolled, 404 no video, network error).
            //    Do NOT fall back to activeModule.videoUrl — that would bypass enrollment.
            return (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000', minHeight: 200, paddingHorizontal: 24, gap: 12 }}>
                <Feather name="lock" size={36} color="#DC2626" />
                <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' }}>
                  Video unavailable
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center' }}>
                  Please ensure you are enrolled in this course and try again.
                </Text>
              </View>
            );
          })()
        )}
      </View>

      {/* Mark Complete Button - Secondary Aqua / Pill h48 */}
      {(() => {
        const isAlreadyComplete = !!(lessonsProgress.find(
          (p) => String(p.lesson_id) === String(activeModule?.id)
        )?.is_completed);
        return isAlreadyComplete ? (
          <View style={[styles.actionButtonContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={[styles.markCompleteBtn, { backgroundColor: '#DCF7F4' }]}>
              <Ionicons name="checkmark-circle" size={16} color="#0B6FAD" />
              <Text style={[styles.markCompleteBtnText, { color: '#0B6FAD' }]}>Lesson Completed</Text>
            </View>
          </View>
        ) : (
          <View style={[styles.actionButtonContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Pressable
              style={[styles.markCompleteBtn, { backgroundColor: '#17E5D3' }]}
              onPress={handleMarkComplete}
              disabled={isMarkingComplete}
            >
              {isMarkingComplete ? (
                <RNActivityIndicator size="small" color="#063B4F" />
              ) : (
                <Ionicons name="checkmark" size={16} color="#063B4F" />
              )}
              <Text style={[styles.markCompleteBtnText, { color: '#063B4F' }]}>
                {isMarkingComplete ? 'Saving...' : 'Mark Lesson Complete'}
              </Text>
            </Pressable>
          </View>
        );
      })()}

      {/* Tabs */}
      <View style={[styles.tabs, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {[
          ["overview", "Overview"],
          ["content", "Lessons"],
        ].map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, activeTab === key && { borderBottomColor: "#0B6FAD" }]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(key as any);
            }}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: activeTab === key ? "#0B6FAD" : colors.mutedForeground,
                  fontFamily: activeTab === key ? "Fredoka_700Bold" : "Fredoka_600SemiBold",
                },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "overview" ? (
          <>
            <LearningTabs
              module={{
                ...activeModule,
                resources: lessonResources.map((r) => ({
                  id: r.id,
                  title: r.title,
                  type: r.type ?? "link",
                  size: r.size_bytes ? formatBytes(r.size_bytes) : "",
                  url: r.url,
                })),
                notes: lessonNotes,
              } as any}
            />
            {/* Review Section */}
            <View style={{ margin: 16, padding: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 16, fontFamily: 'Fredoka_700Bold', color: colors.foreground, marginBottom: 8 }}>
                {myReview ? 'Your Review' : 'Rate this Course'}
              </Text>
              {/* Star rating row */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(star => (
                  <Pressable key={star} onPress={() => { setReviewRating(star); setShowReviewForm(true); }}>
                    <Ionicons
                      name={star <= reviewRating ? 'star' : 'star-outline'}
                      size={28}
                      color={star <= reviewRating ? '#F59E0B' : colors.border}
                    />
                  </Pressable>
                ))}
              </View>
              {showReviewForm && (
                <>
                  <TextInput
                    value={reviewText}
                    onChangeText={setReviewText}
                    placeholder="Share your experience (optional)"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    numberOfLines={3}
                    style={{
                      borderWidth: 1, borderColor: colors.border, borderRadius: 12,
                      padding: 12, color: colors.foreground, fontFamily: 'Inter_400Regular',
                      fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: 12
                    }}
                  />
                  <Pressable
                    onPress={handleSubmitReview}
                    disabled={isSubmittingReview}
                    style={{ backgroundColor: '#0B6FAD', borderRadius: 24, height: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    {isSubmittingReview
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={{ color: '#fff', fontFamily: 'Fredoka_700Bold', fontSize: 15 }}>Submit Review</Text>
                    }
                  </Pressable>
                </>
              )}
              {myReview && !showReviewForm && (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                  {myReview.comment || 'No comment added.'}
                </Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.moduleList}>
            {lessons.map((mod, idx) => {
              const { isCompleted, isCurrent, isLocked } = getModuleState(mod, idx);
              const modProgress = lessonsProgress.find((p) => String(p.lesson_id) === String(mod.id));
              const watchedPercentage = modProgress?.watch_percentage || 0;

              return (
                <Pressable
                  key={mod.id}
                  style={[
                    styles.modItem,
                    {
                      backgroundColor: isCurrent ? "#DCF7F4" : colors.card,
                      borderColor: isCompleted ? "#17E5D3" : "#D6E9F2",
                      borderWidth: isCompleted ? 1.5 : 1,
                      borderLeftWidth: isCurrent ? 5 : isCompleted ? 1.5 : 1,
                      borderLeftColor: isCurrent ? "#0B6FAD" : isCompleted ? "#17E5D3" : "#D6E9F2",
                      opacity: isLocked ? 0.5 : 1,
                    },
                  ]}
                  onPress={() => !isLocked && handleModuleSelect(mod.id)}
                  disabled={isLocked}
                >
                  <View
                    style={[
                      styles.modNum,
                      {
                        backgroundColor: isCompleted ? "#DCF7F4" : isCurrent ? "#DCF7F4" : colors.muted,
                      },
                    ]}
                  >
                    {isCompleted ? (
                      <Ionicons name="checkmark" size={14} color="#17E5D3" />
                    ) : isLocked ? (
                      <Ionicons name="lock-closed" size={14} color="#9CA3AF" />
                    ) : isCurrent ? (
                      <View style={[styles.currentDot, { backgroundColor: "#0B6FAD" }]} />
                    ) : (
                      <Text style={[styles.modNumText, { color: colors.mutedForeground }]}>{idx + 1}</Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.modTitle,
                        {
                          color: isCurrent ? "#0B6FAD" : isCompleted ? "#17E5D3" : colors.foreground,
                          fontFamily: isCurrent || isCompleted ? "Fredoka_700Bold" : "Fredoka_600SemiBold",
                        },
                      ]}
                    >
                      {mod.title}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                      <Text style={[styles.modDuration, { color: colors.mutedForeground }]}>{mod.duration}</Text>
                      {watchedPercentage > 0 && watchedPercentage < 100 && (
                        <Text style={{ fontSize: 12, color: "#0B6FAD", fontFamily: "Inter_600SemiBold", marginLeft: 6 }}>
                          · {Math.round(watchedPercentage)}% watched
                        </Text>
                      )}
                      {Boolean(downloadedMap[mod.id]) && (
                        <Text style={{ fontSize: 11, color: "#17E5D3", fontFamily: "Inter_600SemiBold", marginLeft: 8 }}>
                          ✓ Saved Offline
                        </Text>
                      )}
                    </View>
                    {watchedPercentage > 0 && watchedPercentage < 100 && (
                      <View style={{ height: 3, borderRadius: 1.5, width: "80%", backgroundColor: colors.border, marginTop: 6 }}>
                        <View style={{ height: 3, borderRadius: 1.5, width: `${watchedPercentage}%` as any, backgroundColor: "#0B6FAD" }} />
                      </View>
                    )}
                  </View>

                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      handleDownloadLesson(mod);
                    }}
                    style={{ padding: 6, marginRight: 4 }}
                  >
                    {downloadingLessonId === mod.id ? (
                      <RNActivityIndicator size="small" color="#0B6FAD" />
                    ) : (
                      <Ionicons
                        name={downloadedMap[mod.id] ? "arrow-down-circle" : "arrow-down-circle-outline"}
                        size={20}
                        color={downloadedMap[mod.id] ? "#17E5D3" : colors.mutedForeground}
                      />
                    )}
                  </Pressable>

                  <Ionicons
                    name={isCompleted ? "checkmark-circle" : isCurrent ? "play-circle" : isLocked ? "lock-closed" : "ellipse-outline"}
                    size={20}
                    color={
                      isCompleted ? "#17E5D3" : isCurrent ? "#0B6FAD" : isLocked ? "#9CA3AF" : "#D6E9F2"
                    }
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Navigation Buttons - Pill shapes */}
        <View style={[styles.navButtons, { borderTopColor: colors.border }]}>
          <Pressable
            style={[
              styles.navBtn,
              { backgroundColor: "#E8F4F9", borderRadius: 20, height: 40, opacity: getPreviousModule() ? 1 : 0.5 },
            ]}
            onPress={handlePreviousLesson}
            disabled={!getPreviousModule()}
          >
            <Ionicons name="chevron-back" size={18} color={colors.foreground} />
            <Text style={[styles.navBtnText, { color: colors.foreground }]}>Previous</Text>
          </Pressable>

          <Pressable
            style={[
              styles.navBtn,
              { backgroundColor: "#0B6FAD", borderRadius: 20, height: 40, opacity: getNextModule() ? 1 : 0.5 },
            ]}
            onPress={handleNextLessonNav}
            disabled={!getNextModule()}
          >
            <Text style={[styles.navBtnText, { color: "#FFF" }]}>Next Lesson</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFF" />
          </Pressable>
        </View>
      </ScrollView>

      {/* Resume Modal */}
      <ResumeModal
        visible={showResumeModal}
        resumeTime={resumeFromTime}
        onResume={handleResumeVideo}
        onStartOver={handleStartOver}
        onClose={() => setShowResumeModal(false)}
      />

      {/* Lesson Complete Modal */}
      <LessonCompleteModal
        visible={showCompleteModal}
        lessonTitle={activeModule.title}
        hasNextLesson={!!getNextModule()}
        onReplay={handleReplayLesson}
        onNextLesson={handleNextLesson}
        onClose={() => setShowCompleteModal(false)}
      />
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
    gap: 8,
  },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11, 111, 173, 0.08)" },
  watchLaterBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11, 111, 173, 0.08)" },
  downloadBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11, 111, 173, 0.08)" },
  shareBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11, 111, 173, 0.08)" },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Fredoka_700Bold", textAlign: "center" },
  
  courseHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 6,
  },
  courseTitle: {
    fontSize: 14,
    fontFamily: "Fredoka_600SemiBold",
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statItemInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statTextInline: {
    fontSize: 12,
  },
  statDivider: {
    width: 1,
    height: 12,
  },
  progressBarContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressBarTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressBarFill: {
    height: 4,
    borderRadius: 2,
  },
  progressBarText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    minWidth: 32,
  },
  expiryBanner: {
    flex: 1,
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    borderWidth: 1,
    borderRadius: 12,
    gap: 12,
  },
  expiryText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  supportBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  supportBtnText: {
    color: "#FFF",
    fontFamily: "Fredoka_700Bold",
    fontSize: 14,
  },
  videoWrapper: {
    width: "100%",
    maxHeight: 220,
  },
  actionButtonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  markCompleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 24,
    gap: 8,
  },
  markCompleteBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_700Bold",
  },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 14 },
  
  moduleList: { padding: 16, gap: 10 },
  modItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  modNum: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modNumText: { fontSize: 13, fontFamily: "Fredoka_700Bold" },
  currentDot: { width: 8, height: 8, borderRadius: 4 },
  modTitle: { fontSize: 14, fontFamily: "Fredoka_600SemiBold", lineHeight: 18 },
  modDuration: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  navButtons: {
    flexDirection: "row",
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
  },
  navBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 40,
    borderRadius: 20,
    gap: 6,
  },
  navBtnText: {
    fontSize: 14,
    fontFamily: "Fredoka_700Bold",
  },
});