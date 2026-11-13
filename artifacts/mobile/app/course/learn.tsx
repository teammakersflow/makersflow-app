import { hasActiveAccess, isFreeCourse } from "@/lib/courseAccess";
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
import {
  markLessonComplete,
  upsertLessonProgress,
  fetchCourseLessonsProgressStrict,
  getPendingCompletionLessonIds,
} from "@/lib/progressStorage";
import { coursePercentage, isCourseCompleteFromLessons, onProgressChanged } from "@/lib/courseCompletion";
import { classifyApiError, loadErrorMessage, type ApiErrorKind } from "@/lib/apiErrorKind";
import { apiRequest } from "@/lib/auth/apiClient";
import { getEnrollment, isExpired, completeCourse } from "@/services/enrollmentService";
import { ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchMyReview, upsertReview } from "@/services/reviewService";
import { issueCertificate } from "@/services/certificateService";
import {
  ALREADY_COMPLETE,
  createCompletionRetryScheduler,
  createLessonCompletionGuard,
  lessonCompletionKey,
  type CompletionTicket,
} from "@/lib/lessonCompletionGuard";
import { parseRetryAfterMs } from "@/lib/auth/retryPolicy";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Module-level so memoised callbacks can use it safely. */
/**
 * The completion could not be sent and is kept on this device. The message
 * says why: offline/timeout, server busy (HTTP 429), or a server problem.
 */
function notifyCompletionQueued(kind: ApiErrorKind) {
  const message =
    kind === 'rate_limited'
      ? "Server is busy. Your completion is saved on this device and will sync automatically."
      : kind === 'network' || kind === 'timeout'
        ? "Saved on this device. It will sync when you're back online."
        : "Couldn't reach the server. Your completion is saved on this device and will sync automatically.";
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert('', message);
  }
}

/** What one completion request produced (shared by everyone waiting on it). */
interface CompletionOutcome {
  result: 'synced' | 'queued';
  failure?: unknown;
}

/**
 * One completion request per lesson at a time, shared by the Mark Lesson
 * Complete button and automatic completion at 90% watched. Module-level so a
 * request still in flight is joined even if the screen is reopened.
 */
const lessonCompletionGuard = createLessonCompletionGuard();

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
  // C-5: client-side gate for deep links into courses this account cannot access.
  // The backend remains authoritative (it must refuse signed video URLs).
  const [accessDenied, setAccessDenied] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "content">("overview");
  const [activeModuleId, setActiveModuleId] = useState<string | undefined>(lessonId ? String(lessonId) : undefined);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [startOverLessonId, setStartOverLessonId] = useState<string | undefined>(undefined);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [resumeFromTime, setResumeFromTime] = useState(0);
  const [downloadedPath, setDownloadedPathState] = useState<string | null>(null);
  const [downloadedMap, setDownloadedMap] = useState<Record<string, string | null>>({});
  const [downloadingLessonId, setDownloadingLessonId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  // Lesson whose completion request (button or automatic) is in flight: the
  // button is disabled and shows "Saving..." until it settles.
  const [completingLessonId, setCompletingLessonId] = useState<string | null>(null);
  // Manual completions saved in the outbox but not yet confirmed by the
  // backend. Shown as "waiting to sync"; never counted toward course completion.
  const [pendingCompletionIds, setPendingCompletionIds] = useState<string[]>([]);
  // The last progress request failed: keep what is shown and offer a retry.
  const [progressLoadError, setProgressLoadError] = useState(false);
  const [progressErrorKind, setProgressErrorKind] = useState<ApiErrorKind | undefined>(undefined);

  /**
   * Reloads backend lesson progress. On failure keeps the current progress,
   * flags the error and returns null (never replaces it with "no progress").
   */
  const reloadProgress = useCallback(async (opts?: { force?: boolean }): Promise<any[] | null> => {
    if (!user?.id || !courseId) return null;
    const pendingIds = await getPendingCompletionLessonIds(user.id, courseId);
    try {
      // Shared request (lib/courseRequests.ts); after a write it is already
      // invalidated, `force` is only for the Retry button.
      const progressData = await fetchCourseLessonsProgressStrict(user.id, courseId, opts);
      setLessonsProgress(progressData);
      setProgressLoadError(false);
      const confirmed = new Set(
        progressData.filter((p) => p.is_completed).map((p) => String(p.lesson_id)),
      );
      setPendingCompletionIds(pendingIds.filter((id) => !confirmed.has(id)));
      return progressData;
    } catch (e) {
      console.warn('[LearnScreen] progress reload failed:', e);
      setProgressLoadError(true);
      setProgressErrorKind(classifyApiError(e));
      setPendingCompletionIds((prev) => Array.from(new Set([...prev, ...pendingIds])));
      return null;
    }
  }, [user?.id, courseId]);

  // While a completion is waiting to sync, reload progress when the outbox
  // flushes (reconnect / foreground), so the lesson flips to confirmed.
  // Ignored otherwise, so playback updates do not trigger extra requests.
  const hasPendingRef = useRef(false);
  hasPendingRef.current = pendingCompletionIds.length > 0;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onProgressChanged(() => {
      if (!hasPendingRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { reloadProgress(); }, 500);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [reloadProgress]);

  // Signed video URL fetched from NestJS GET /lessons/:id/video.
  // Kept in runtime state only — never persisted; expires after 300 s.
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [isSignedUrlLoading, setIsSignedUrlLoading] = useState(false);
  // M-22: why the signed URL is missing (drives the error/retry UI) + retry trigger.
  const [signedUrlError, setSignedUrlError] = useState<null | "network" | "busy" | "forbidden" | "unavailable">(null);
  const [signedUrlAttempt, setSignedUrlAttempt] = useState(0);

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

          if (flatLessons.length > 0) {
            const requestedLesson = lessonId
              ? flatLessons.find((l: any) => String(l.id) === String(lessonId))
              : null;

            const requestedModule = moduleId
              ? modulesData.find((m: any) => String(m.id) === String(moduleId))
              : null;

            const moduleFirstLessonId = requestedModule?.lessons?.[0]?.id;
            const requestedIdIsLesson = moduleId
              ? flatLessons.some((l: any) => String(l.id) === String(moduleId))
              : false;

            const initialLessonId = requestedLesson?.id
              ?? (requestedIdIsLesson
                ? String(moduleId)
                : moduleFirstLessonId
                  ? String(moduleFirstLessonId)
                  : flatLessons[0].id);

            if (
              initialLessonId &&
              (!activeModuleId || !flatLessons.some((l: any) => String(l.id) === String(activeModuleId)))
            ) {
              setActiveModuleId(String(initialLessonId));
            }
          }

          if (user?.id) {
            // A failed request must not look like "no progress" (0%, every
            // lesson but the first locked): flag it and offer a retry.
            await reloadProgress();

            const enrollData = await getEnrollment(user.id, courseId);
            setEnrollment(enrollData);
            if (enrollData && isExpired(enrollData)) {
              setIsEnrollmentExpired(true);
            } else if (!hasActiveAccess(enrollData, mappedCourse)) {
              setAccessDenied(true);
            }
          } else if (!isFreeCourse(mappedCourse)) {
            setAccessDenied(true);
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

  // Always use the authenticated backend endpoint for protected video URLs.
  const activeLessonIdRef = useRef(activeModuleId);
  activeLessonIdRef.current = activeModuleId;

  const fetchSignedVideoUrl = useCallback(async (lessonId: string): Promise<string | null> => {
    const res = await apiRequest<{
      success?: boolean;
      message?: string;
      data?: { signedUrl: string; expiresIn: number };
      signedUrl?: string;
      expiresIn?: number;
    }>(`/lessons/${lessonId}/video`);

    return res?.data?.signedUrl ?? res?.signedUrl ?? null;
  }, []);

  // Used by the player when its current signed URL expires or playback fails.
  const refreshSignedVideoUrl = useCallback(async (lessonId: string): Promise<string | null> => {
    if (!lessonId || activeLessonIdRef.current !== lessonId) return null;

    try {
      const url = await fetchSignedVideoUrl(lessonId);

      // Never let a response for an old lesson affect the current player.
      if (activeLessonIdRef.current !== lessonId) return null;

      if (!url) {
        console.warn('[LearnScreen] Refresh returned no signed URL for lesson', lessonId);
      }

      return url;
    } catch (err: any) {
      console.warn('[LearnScreen] Signed video URL refresh failed:', err?.message ?? err);
      // HTTP 429 is passed on so the player can say "server is busy" and stop
      // retrying; other failures keep the existing "could not refresh" path.
      if ((err?.status ?? err?.statusCode) === 429 && activeLessonIdRef.current === lessonId) throw err;
      return null;
    }
  }, [fetchSignedVideoUrl]);

  // Fetch the initial signed URL whenever the active lesson changes.
  useEffect(() => {
    if (!activeModuleId || isLoading) return;

    const selectedLesson = lessons.find(
      (lesson: any) => String(lesson.id) === String(activeModuleId)
    ) ?? lessons[0];

    if (!selectedLesson?.videoUrl) {
      setSignedVideoUrl(null);
      setIsSignedUrlLoading(false);
      return;
    }

    const localPath = downloadedMap[activeModuleId];
    if (localPath) {
      setSignedVideoUrl(null);
      setIsSignedUrlLoading(false);
      return;
    }

    let cancelled = false;
    setSignedVideoUrl(null);
    setSignedUrlError(null);
    setIsSignedUrlLoading(true);

    fetchSignedVideoUrl(activeModuleId)
      .then((url) => {
        if (!cancelled) {
          if (!url) {
            console.warn('[LearnScreen] No signed URL for lesson', activeModuleId);
            setSignedUrlError("unavailable");
          }
          setSignedVideoUrl(url);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.warn('[LearnScreen] Signed video URL fetch failed:', err?.message ?? err);
          const status = err?.status ?? err?.statusCode ?? err?.response?.status;
          // 429: the server asked us to wait. Say so (not "check your
          // connection"); "Try again" during the cooldown is not sent again
          // (lib/auth/retryPolicy.ts gate).
          setSignedUrlError(
            status === 401 || status === 403 ? "forbidden" : status === 429 ? "busy" : "network",
          );
          setSignedVideoUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSignedUrlLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeModuleId, isLoading, downloadedMap, fetchSignedVideoUrl, lessons, signedUrlAttempt]);

  // H-8: give the player a way to obtain a fresh signed URL when the current one
  // expires (≈300 s) or playback fails, instead of retrying the expired URL.
  const refreshActiveSignedUrl = useCallback(async (): Promise<string | null> => {
    const id = activeLessonIdRef.current;
    if (!id) return null;
    // The player swaps in the returned URL itself and keeps its position. Do NOT
    // also put it in state: a prop change would reload the source and seek to
    // the initial time again.
    return refreshSignedVideoUrl(id);
  }, [refreshSignedVideoUrl]);

  // Current status is live: every CURRENT lesson completed (backend rule).
  // enrollment.completed_at is only the first-completion date; it stays set
  // when an admin adds lessons, while the course is In Progress again.
  const isCourseCompleted =
    isCourseCompleteFromLessons(lessonsProgress, lessons.map((l: any) => l.id));
  const completedModules = lessonsProgress.filter((p) => p.is_completed).length;
  const effectiveTotalLessons = totalLessons || lessons.length;
  const remainingModules = isCourseCompleted ? 0 : (effectiveTotalLessons - completedModules);
  // Never 100% for an unfinished course (e.g. 199/200 would round up).
  const progressPercentage = isCourseCompleted
    ? 100
    : Math.min(99, coursePercentage(completedModules, effectiveTotalLessons));

  const activeModule = lessons.find((m) => m.id === activeModuleId) ?? lessons[0];
  const activeLessonProgress = lessonsProgress.find((p) => String(p.lesson_id) === activeModule?.id);
  // M-18: explicit choice. "Start over" must not briefly resume the old position.
  const initialTime = showResumeModal || startOverLessonId === activeModuleId ? 0 : (activeLessonProgress?.current_time_secs ?? 0);
  const isSaved = activeModule ? isInWatchLater(activeModule.id) : false;
  const isMarkingComplete = !!activeModule && completingLessonId === String(activeModule.id);

  // Stable callbacks — prevent VideoPlayerEnhanced from recreating its
  // polling interval on every render (Bug 3 & 7)
  const handleProgressUpdate = useCallback(async (currentTime: number, duration: number) => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    const watchPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), currentTime, watchPercentage);
  }, [user?.id, courseId, activeModule?.id]);

  // Latest progress for the "already completed" check: the callbacks below are
  // memoised and must not read a stale render's state.
  const lessonsProgressRef = useRef(lessonsProgress);
  lessonsProgressRef.current = lessonsProgress;
  const pendingCompletionIdsRef = useRef(pendingCompletionIds);
  pendingCompletionIdsRef.current = pendingCompletionIds;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  // Review M3: a closed screen never navigates or shows modals.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Review M2: one independent automatic re-send per lesson after HTTP 429.
  // Cleared on unmount; the completion stays in the outbox, which the app
  // flushes on foreground / reconnect / sign-in (and after Retry-After).
  const completionRetries = useRef(createCompletionRetryScheduler()).current;
  const runLessonCompletionRef = useRef<(lessonId: string) => Promise<void>>(async () => {});
  useEffect(() => () => completionRetries.cancelAll(), [completionRetries]);
  useEffect(() => { completionRetries.cancelAll(); }, [user?.id, completionRetries]);

  /** Server-confirmed completion: show the lesson as completed right away. */
  const showLessonCompleted = useCallback((lessonId: string) => {
    setPendingCompletionIds((prev) => prev.filter((id) => id !== String(lessonId)));
    setLessonsProgress((prev) =>
      prev.some((p) => String(p.lesson_id) === String(lessonId))
        ? prev.map((p) => (String(p.lesson_id) === String(lessonId) ? { ...p, is_completed: true } : p))
        : [...prev, { lesson_id: Number(lessonId), is_completed: true, watch_percentage: 100 }],
    );
  }, []);

  /**
   * Follow-up of one completion request. Runs once per request (only for the
   * caller that claimed the ticket). The data steps (context refresh, course
   * completion, certificate issue) also run when the screen was closed; the
   * certificate screen and the modal are only shown by a mounted screen.
   */
  const handleCompletionOutcome = useCallback(async (lessonId: string, userId: string, outcome: CompletionOutcome) => {
    const key = lessonCompletionKey(userId, courseId!, lessonId);
    if (outcome.result === 'queued') {
      // Not confirmed: show it as waiting to sync, never as a finished course.
      setPendingCompletionIds((prev) => Array.from(new Set([...prev, String(lessonId)])));
      const kind = classifyApiError(outcome.failure);
      if (mountedRef.current) notifyCompletionQueued(kind);
      if (kind === 'rate_limited' && mountedRef.current) {
        completionRetries.schedule(
          key,
          parseRetryAfterMs((outcome.failure as any)?.retryAfter ?? null, Date.now()),
          () => {
            if (mountedRef.current && userIdRef.current === userId && pendingCompletionIdsRef.current.includes(String(lessonId))) {
              void runLessonCompletionRef.current(String(lessonId));
            }
          },
        );
      }
      return;
    }
    completionRetries.succeeded(key);
    showLessonCompleted(lessonId);
    await completeModule(String(Number(courseId)), String(Number(lessonId)));
    // null = the reload failed: progress is unknown, so skip the course-completion check.
    const updatedProgress = (await reloadProgress()) ?? [];
    if (mountedRef.current) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const completedCount = updatedProgress.filter((p) => p.is_completed).length;
    if (totalLessons > 0 && completedCount >= totalLessons) {
      let completedEnrollment = enrollment;
      if (!completedEnrollment?.completed_at) {
        try {
          await completeCourse(userId, Number(courseId));
          completedEnrollment = await getEnrollment(userId, Number(courseId));
          setEnrollment(completedEnrollment);
        } catch (e) {
          console.error('[CompleteCourse] error:', e);
        }
      }
      try {
        const issuedCertificate = await issueCertificate(Number(courseId));
        if (!issuedCertificate) { throw new Error('Certificate issuance returned no certificate.'); }

        const certKey = `@cert_shown:${userId}:${courseId}`;
        const alreadyShown = await AsyncStorage.getItem(certKey);
        // A closed screen (or another account) never navigates.
        if (!alreadyShown && mountedRef.current && userIdRef.current === userId) {
          await AsyncStorage.setItem(certKey, 'true');
          router.push({
            pathname: '/certificate',
            params: {
              courseName: course?.title ?? '',
              studentName: user?.name ?? '',
              completionDate: completedEnrollment?.completed_at ?? enrollment?.completed_at ?? issuedCertificate?.issued_at ?? '',
              courseId: String(courseId ?? ''),
              certNumber: issuedCertificate?.certificate_number ?? '',
              level: (course as any)?.level,
              instructor: (course as any)?.instructor,
            },
          });
          return;
        }
      } catch (certificateError) {
        console.error('[Certificate] issuance/display failed:', certificateError);
      }
    }
    if (mountedRef.current) setShowCompleteModal(true);
  }, [courseId, totalLessons, enrollment, course?.title, user?.name, reloadProgress, completeModule, completionRetries, showLessonCompleted]);

  /**
   * Completes one lesson. Shared by the Mark Lesson Complete button and the
   * player's automatic completion at 90% watched (lib/playbackTracker.ts):
   * - one request per lesson at a time: repeated taps, or a tap during the
   *   automatic completion, join the request in flight (lib/lessonCompletionGuard.ts);
   * - nothing is sent for a lesson the backend already reports as completed;
   * - the write is never retried by the HTTP layer (lib/auth/retryPolicy.ts).
   *   A failure (offline, HTTP 429, 5xx) is kept in the outbox and shown as
   *   "waiting to sync", never as completed; after a 429 it is re-sent once
   *   the server's Retry-After has passed.
   */
  const runLessonCompletion = useCallback(async (lessonId: string): Promise<void> => {
    if (!user?.id || !courseId || !lessonId) return;
    const userId = user.id;
    const isConfirmedComplete = () =>
      !!lessonsProgressRef.current.find((p) => String(p.lesson_id) === String(lessonId))?.is_completed;
    if (isConfirmedComplete()) return;
    setCompletingLessonId(lessonId);
    try {
      const ticket = await lessonCompletionGuard.run<CompletionOutcome>(
        lessonCompletionKey(userId, courseId, lessonId),
        isConfirmedComplete,
        async () => {
          let failure: unknown;
          const result = await markLessonComplete(userId, Number(courseId), Number(lessonId), {
            onFailure: (e) => { failure = e; },
          });
          return { result, failure };
        },
      );
      if (ticket === ALREADY_COMPLETE) return;
      if (ticket.value.result === 'synced' && mountedRef.current) showLessonCompleted(lessonId);
      if (ticket.claim()) await handleCompletionOutcome(lessonId, userId, ticket.value);
    } catch (e) {
      console.error('[completeLesson] error:', e);
      if (mountedRef.current) showToast('Failed to mark lesson complete. Please try again.');
    } finally {
      if (mountedRef.current) setCompletingLessonId((cur) => (cur === lessonId ? null : cur));
    }
  }, [user?.id, courseId, handleCompletionOutcome, showLessonCompleted]);
  runLessonCompletionRef.current = runLessonCompletion;

  // Review M3: reopening a lesson whose completion is still being sent (or
  // finished while no screen was open) shows that state instead of an
  // incomplete lesson, and never sends a second write for it.
  useEffect(() => {
    if (!user?.id || !courseId || !activeModuleId) return;
    const userId = user.id;
    const lessonId = String(activeModuleId);
    const key = lessonCompletionKey(userId, courseId, lessonId);
    let alive = true;
    const settle = async (ticket: CompletionTicket<CompletionOutcome>) => {
      if (!alive) return;
      if (ticket.value.result === 'synced') showLessonCompleted(lessonId);
      if (ticket.claim()) await handleCompletionOutcome(lessonId, userId, ticket.value);
    };
    const running = lessonCompletionGuard.inFlight<CompletionOutcome>(key);
    if (running) {
      setCompletingLessonId(lessonId);
      running
        .then(settle, () => {})
        .finally(() => { if (alive) setCompletingLessonId((cur) => (cur === lessonId ? null : cur)); });
    } else {
      const done = lessonCompletionGuard.unclaimed<CompletionOutcome>(key);
      if (done) void settle(done);
    }
    return () => { alive = false; };
  }, [user?.id, courseId, activeModuleId, handleCompletionOutcome, showLessonCompleted]);

  // Automatic completion: the player reports it once, at 90% watched.
  const handleVideoComplete = useCallback(() => {
    if (activeModule?.id) void runLessonCompletion(String(activeModule.id));
  }, [activeModule?.id, runLessonCompletion]);

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
      const signedUrl = await fetchSignedVideoUrl(String(target.id));

      if (!signedUrl) {
        throw new Error('Could not obtain a secure video download URL. Please try again.');
      }

      const savedPath = await downloadLessonVideo(target.id, signedUrl, (pct) => {
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
    if (!activeModule?.id || !course) return;
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
    setStartOverLessonId(undefined);
    setShowResumeModal(false); // initialTime becomes the saved position; the player seeks (M-18)
  };

  const handleStartOver = async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    setStartOverLessonId(activeModuleId);
    setShowResumeModal(false);
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), 0, 0);
    await reloadProgress(); // keeps current progress if the reload fails
  };

  const handleReplayLesson = async () => {
    if (!user?.id || !courseId || !activeModule?.id) return;
    setShowCompleteModal(false);
    await upsertLessonProgress(user.id, Number(courseId), Number(activeModule.id), 0, 0);
    await reloadProgress(); // keeps current progress if the reload fails
  };

  const handleNextLesson = () => {
    setShowCompleteModal(false);
    if (!activeModule) return;
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

  // Manual completion (Mark Lesson Complete). Same guarded path as the
  // automatic one: rapid taps send one request.
  const handleMarkComplete = () => {
    if (!activeModule?.id) return;
    void runLessonCompletion(String(activeModule.id));
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
    // Completed on this device, waiting to sync (not confirmed by the backend).
    const isPendingSync = !isCompleted && pendingCompletionIds.includes(String(module.id));
    const isCurrent = activeModuleId === module.id;

    const previousModule = lessons[index - 1];
    const prevProgress = previousModule ? lessonsProgress.find((p) => String(p.lesson_id) === previousModule.id) : null;
    // A completion waiting to sync still unlocks the next lesson on this
    // device, so an offline learner can continue; it never completes the course.
    const canAccess =
      index === 0 ||
      !previousModule ||
      prevProgress?.is_completed ||
      pendingCompletionIds.includes(String(previousModule.id));
    const isLocked = !canAccess;

    return { isCompleted, isPendingSync, isCurrent, isLocked };
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
        {accessDenied && !isEnrollmentExpired ? (
          <View style={[styles.expiryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="lock" size={32} color="#0B6FAD" />
            <Text style={[styles.expiryText, { color: colors.foreground }]}>
              {user?.id && isFreeCourse(course)
                ? "Enroll in this free course to start learning."
                : "This course is not available on this account."}
            </Text>
            {user?.id && isFreeCourse(course) ? (
              <Pressable
                style={[styles.supportBtn, { backgroundColor: "#0B6FAD" }]}
                onPress={() => router.replace(`/course/${courseId}`)}
              >
                <Text style={styles.supportBtnText}>Enroll for Free</Text>
              </Pressable>
            ) : null}
          </View>
        ) : isEnrollmentExpired ? (
          <View style={[styles.expiryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="alert-triangle" size={32} color="#DC2626" />
            <Text style={[styles.expiryText, { color: colors.foreground }]}>
              Your access expired on {enrollment?.expires_at ? new Date(enrollment.expires_at).toLocaleDateString() : ""}
            </Text>
            {isFreeCourse(course) ? (
              // Free course: the backend renews an expired free enrollment.
              <Pressable
                style={[styles.supportBtn, { backgroundColor: "#0B6FAD" }]}
                onPress={() => router.replace(`/course/${courseId}`)}
              >
                <Text style={styles.supportBtnText}>Re-enroll for Free</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.supportBtn, { backgroundColor: "#0B6FAD" }]}
                onPress={() => {
                  Linking.openURL('mailto:support@edodwaja.com?subject=Course%20access%20help');
                }}
              >
                <Text style={styles.supportBtnText}>Contact Support</Text>
              </Pressable>
            )}
          </View>
        ) : (
          (() => {
            // Protected video playback — never exposes raw video_url for enrolled content.
            // 1. Offline: serve the downloaded local file.
            const localPath = downloadedMap[activeModule?.id] ?? downloadedPath;
            if (localPath) {
              return (
                <VideoPlayerEnhanced
                  key={`local-${activeModule?.id}`}
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
                  key={`remote-${activeModule?.id}`}
                  videoUrl={signedVideoUrl}
                  initialTime={initialTime}
                  onProgressUpdate={handleProgressUpdate}
                  onComplete={handleVideoComplete}
                  onRefreshVideoUrl={refreshActiveSignedUrl}
                />
              );
            }

            // M-22: explain why there is no video and offer a retry, instead of a blank area.
            if (activeModule?.videoUrl && signedUrlError) {
              return (
                <View style={[styles.expiryBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name={signedUrlError === "network" ? "wifi-off" : "alert-circle"} size={28} color="#0B6FAD" />
                  <Text style={[styles.expiryText, { color: colors.foreground }]}>
                    {signedUrlError === "network"
                      ? "Couldn't load this video. Check your connection and try again."
                      : signedUrlError === "busy"
                        ? "Server is busy. Please wait a moment, then try again."
                      : signedUrlError === "forbidden"
                        ? "This video is not available on this account."
                        : "This video is temporarily unavailable."}
                  </Text>
                  {signedUrlError !== "forbidden" && (
                    <Pressable
                      style={[styles.supportBtn, { backgroundColor: "#0B6FAD" }]}
                      onPress={() => setSignedUrlAttempt((n) => n + 1)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.supportBtnText}>Try again</Text>
                    </Pressable>
                  )}
                </View>
              );
            }

            // No video URL is available for this lesson.
            return null;          })()
        )}
      </View>

      {!isEnrollmentExpired && !accessDenied && activeModule && (activeModule.description?.trim() || !activeModule.videoUrl) && (
        <View style={{ backgroundColor: colors.card, marginHorizontal: 16, marginTop: 12, marginBottom: 12, padding: 16, borderRadius: 12, gap: 10 }}>
          {activeModule?.description?.trim() ? (
            <>
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16 }}>
                Lesson content
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22 }}>
                {activeModule.description.trim()}
              </Text>
            </>
          ) : (
            <>
              <Feather name="file-text" size={28} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
                Content not available
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>
                No content available for this lesson yet. Please check back later.
              </Text>
            </>
          )}
        </View>
      )}
      {progressLoadError && (
        <Pressable
          onPress={() => { reloadProgress({ force: true }); }}
          accessibilityRole="button"
          style={[styles.actionButtonContainer, { backgroundColor: colors.card, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }]}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={colors.mutedForeground} />
          <Text style={{ flex: 1, color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {loadErrorMessage(progressErrorKind, lessonsProgress.length > 0)}
          </Text>
          <Text style={{ color: "#0B6FAD", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>Retry</Text>
        </Pressable>
      )}
      {/* Mark Complete Button - Secondary Aqua / Pill h48 */}
      {(() => {
        const isAlreadyComplete = !!(lessonsProgress.find(
          (p) => String(p.lesson_id) === String(activeModule?.id)
        )?.is_completed);
        const isWaitingToSync =
          !isAlreadyComplete && !!activeModule && pendingCompletionIds.includes(String(activeModule.id));
        if (isWaitingToSync) {
          return (
            <View style={[styles.actionButtonContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              {/* Not confirmed yet: tap to try sending it again (same guarded
                  request; during a 429 cooldown nothing is sent). */}
              <Pressable
                style={[styles.markCompleteBtn, { backgroundColor: colors.muted }]}
                onPress={handleMarkComplete}
                disabled={isMarkingComplete}
                accessibilityRole="button"
                accessibilityState={{ disabled: isMarkingComplete, busy: isMarkingComplete }}
              >
                {isMarkingComplete ? (
                  <RNActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Ionicons name="cloud-upload-outline" size={16} color={colors.mutedForeground} />
                )}
                <Text style={[styles.markCompleteBtnText, { color: colors.mutedForeground }]}>
                  {isMarkingComplete ? 'Saving...' : 'Completed · waiting to sync · Tap to retry'}
                </Text>
              </Pressable>
            </View>
          );
        }
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
              accessibilityRole="button"
              accessibilityState={{ disabled: isMarkingComplete, busy: isMarkingComplete }}
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
              const { isCompleted, isPendingSync, isCurrent, isLocked } = getModuleState(mod, idx);
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
                    name={isCompleted ? "checkmark-circle" : isPendingSync ? "cloud-upload-outline" : isCurrent ? "play-circle" : isLocked ? "lock-closed" : "ellipse-outline"}
                    size={20}
                    color={
                      isCompleted ? "#17E5D3" : isPendingSync ? "#9CA3AF" : isCurrent ? "#0B6FAD" : isLocked ? "#9CA3AF" : "#D6E9F2"
                    }
                    accessibilityLabel={isPendingSync ? "Completed, waiting to sync" : undefined}
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
        lessonTitle={activeModule?.title ?? 'Lesson'}
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
