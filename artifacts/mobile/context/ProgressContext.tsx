import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import {
  ModuleProgress,
  ProgressStorage,
  UserCourseProgress,
  VideoProgress,
  WatchlistItem,
  fetchRemoteProgress,
} from "@/lib/progressStorage";
import { markProgressChanged } from "@/lib/courseCompletion";
import { courseRequests } from "@/lib/courseRequests";
import { buildContinueLearning, ResumeCourseInput } from "@/lib/continueLearning";
import { createProgressRefreshCoordinator } from "@/lib/progressRefreshCoordinator";

const DEFAULT_COURSE_THUMBNAIL = require("@/assets/images/courses/course_robotics.webp");

/** Continue Learning cards from the per-course resume inputs (lib/continueLearning.ts). */
function buildWatchlist(progress: UserCourseProgress[]): WatchlistItem[] {
  const inputs = progress
    .map((p) => p.continueInput)
    .filter((c): c is ResumeCourseInput => !!c);
  return buildContinueLearning(inputs).map((e) => ({
    courseId: e.courseId,
    moduleId: e.lessonId,
    lessonId: e.lessonId,
    courseTitle: e.courseTitle,
    moduleTitle: e.lessonTitle,
    courseThumbnail: e.thumbnailUrl ? { uri: e.thumbnailUrl } : DEFAULT_COURSE_THUMBNAIL,
    lastWatchedAt: e.lastActivityAt,
    videoProgress: {
      videoUrl: "",
      currentTime: e.currentTimeSecs,
      duration: 0,
      watchedPercentage: e.watchPercentage,
      isCompleted: false,
      lastWatchedAt: e.lastActivityAt,
    },
    courseProgress: e.coursePercentage,
  }));
}

/**
 * Saved cards may hold a bundled-image id from another build; use the
 * current default artwork for anything that is not a remote URL.
 */
function normalizeWatchlist(items: WatchlistItem[]): WatchlistItem[] {
  const seen = new Set<string>();
  return items
    .filter((i) => i && i.courseId && !seen.has(i.courseId) && (seen.add(i.courseId), true))
    .map((i) => ({
      ...i,
      courseThumbnail:
        i.courseThumbnail && typeof i.courseThumbnail === "object" && i.courseThumbnail.uri
          ? i.courseThumbnail
          : DEFAULT_COURSE_THUMBNAIL,
    }));
}
import * as courseDataProvider from "@/services/courseDataProvider";
import { homeRepository } from "@/repositories/homeRepository";
import { coursesRepository } from "@/repositories/coursesRepository";

interface ProgressContextType {
  courseProgress: Map<string, UserCourseProgress>;
  watchlist: WatchlistItem[];
  isLoading: boolean;
  /** The last progress load failed; data shown is from saved copies (if any). */
  progressLoadFailed: boolean;
  getCourseProgress: (courseId: string) => UserCourseProgress | null;
  getModuleProgress: (courseId: string, moduleId: string) => ModuleProgress | null;
  updateVideoProgress: (
    courseId: string,
    moduleId: string,
    currentTime: number,
    duration: number,
    videoUrl: string
  ) => Promise<void>;
  completeModule: (courseId: string, moduleId: string) => Promise<void>;
  enrollCourse: (courseId: string) => Promise<void>;
  refreshWatchlist: () => Promise<void>;
  /** `force`: skip the short shared cache (pull-to-refresh / Retry only). */
  refreshProgress: (opts?: { force?: boolean }) => Promise<void>;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [courseProgress, setCourseProgress] = useState<Map<string, UserCourseProgress>>(
    new Map()
  );
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // The last progress load failed (offline / API error): what is shown comes
  // from saved data. Screens use it to show an error/retry state.
  const [progressLoadFailed, setProgressLoadFailed] = useState(false);
  const hydratedForUser = useRef<string | null>(null);
  // Only the newest loadAllProgress run may update state, so a slower, older
  // run (e.g. one that hit HTTP 429) can never overwrite a newer success.
  const loadGeneration = useRef(0);
  // Latest course map, for merging a single-course refresh (completeModule).
  // Also set synchronously wherever a map is applied, so a merge right after a
  // full load never starts from the previous render's (possibly empty) map.
  const courseProgressRef = useRef(courseProgress);
  courseProgressRef.current = courseProgress;
  // Review H1: a single-course refresh is merged only into a complete map;
  // before the first full load completes, the full load is used instead.
  const refreshCoordinator = useRef(createProgressRefreshCoordinator()).current;
  const currentUserIdRef = useRef<string | null>(null);

  // Load all progress on mount or user change
  useEffect(() => {
    // Another account (or sign-out): drop every shared course response and
    // ignore runs still in flight for the previous user.
    courseRequests.clear();
    loadGeneration.current += 1;
    refreshCoordinator.reset();
    currentUserIdRef.current = user?.id ?? null;
    if (user?.id) {
      loadAllProgress();
    } else {
      hydratedForUser.current = null;
      courseProgressRef.current = new Map();
      setCourseProgress(courseProgressRef.current);
      setWatchlist([]);
      setProgressLoadFailed(false);
      setIsLoading(false);
    }
  }, [user?.id]);

  /** Full load, tracked by the refresh coordinator (see completeModule). */
  function loadAllProgress(opts?: { force?: boolean }): Promise<void> {
    return refreshCoordinator.runFull(() => loadAllProgressRun(opts)).then(() => undefined);
  }

  /** Resolves true when a complete, current map from the backend was applied. */
  async function loadAllProgressRun(opts?: { force?: boolean }): Promise<boolean> {
    if (!user?.id) return false;
    const gen = ++loadGeneration.current;
    const isLatest = () => gen === loadGeneration.current;

    // After an app restart, show the saved Continue Learning cards right away
    // while the backend data loads.
    if (hydratedForUser.current !== user.id) {
      hydratedForUser.current = user.id;
      const saved = await ProgressStorage.loadWatchlist(user.id).catch(() => []);
      if (saved.length > 0 && isLatest()) setWatchlist(normalizeWatchlist(saved));
    }

    setIsLoading(true);
    try {
      // Course progress, /modules and /lessons are shared with the screens
      // (lib/courseRequests.ts): concurrent runs cost no extra requests.
      let allProgress = await fetchRemoteProgress(user.id, opts);
      if (!isLatest()) return false;

      // Save to local storage for offline use
      for (const p of allProgress) {
        await ProgressStorage.saveCourseProgress(p);
      }

      const progressMap = new Map<string, UserCourseProgress>();
      allProgress.forEach((p) => progressMap.set(p.courseId, p));
      courseProgressRef.current = progressMap;
      setCourseProgress(progressMap);

      // Continue Learning is rebuilt from scratch on every load (no stale or
      // duplicate entries; completed courses drop out) and saved for restarts.
      const rebuilt = buildWatchlist(allProgress);
      setWatchlist(rebuilt);
      await ProgressStorage.saveWatchlist(user.id, rebuilt);
      setProgressLoadFailed(false);
      return isLatest();
    } catch (error) {
      console.error("Failed to load progress:", error);
      if (!isLatest()) return false;
      setProgressLoadFailed(true);
      // Fallback to local storage on error (e.g. offline). Keep what is
      // already shown rather than replacing it with nothing.
      try {
        const localProgress = await ProgressStorage.loadAllCourseProgress(user.id);
        if (localProgress.length > 0) {
          const progressMap = new Map<string, UserCourseProgress>();
          localProgress.forEach((p) => progressMap.set(p.courseId, p));
          courseProgressRef.current = progressMap;
          setCourseProgress(progressMap);
        }
        const fromSaved = buildWatchlist(localProgress);
        const savedWatchlist = fromSaved.length > 0 ? fromSaved : await ProgressStorage.loadWatchlist(user.id);
        if (savedWatchlist.length > 0) setWatchlist(normalizeWatchlist(savedWatchlist));
      } catch (localError) {
        console.error("Failed to load local progress fallback:", localError);
      }
      return false;
    } finally {
      if (isLatest()) setIsLoading(false);
    }
  }

  function getCourseProgress(courseId: string): UserCourseProgress | null {
    return courseProgress.get(courseId) || null;
  }

  function getModuleProgress(courseId: string, moduleId: string): ModuleProgress | null {
    const progress = courseProgress.get(courseId);
    return progress?.modules[moduleId] || null;
  }

  async function invalidateRepositories() {
    // Tell mounted tab screens (Home, My Learning, Progress) to reload on focus.
    markProgressChanged();
    await Promise.all([
      homeRepository.invalidateProgressCache().catch(() => {}),
      coursesRepository.invalidateEnrollmentsCache().catch(() => {}),
    ]);
  }

  async function enrollCourse(courseId: string): Promise<void> {
    if (!user?.id) return;

    const existing = courseProgress.get(courseId);
    if (existing) return;

    const course = await courseDataProvider.getCourseById(courseId);
    if (!course) return;
    const modules = await courseDataProvider.getCourseModules(courseId);

    const newProgress: UserCourseProgress = {
      userId: user.id,
      courseId,
      progress: 0,
      enrolledAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      totalTimeSpent: 0,
      modules: {},
    };

    // Initialize all modules
    modules.forEach((module: any) => {
      newProgress.modules[module.id] = {
        moduleId: module.id,
        isCompleted: false,
        isStarted: false,
        videoProgress: {
          videoUrl: module.lessons[0]?.video_url || "",
          currentTime: 0,
          duration: 0,
          watchedPercentage: 0,
          isCompleted: false,
          lastWatchedAt: new Date().toISOString(),
        },
        lastAccessedAt: new Date().toISOString(),
        timeSpent: 0,
      };
    });

    await ProgressStorage.saveCourseProgress(newProgress);
    setCourseProgress(new Map(courseProgress.set(courseId, newProgress)));
    await invalidateRepositories();
  }

  async function updateVideoProgress(
    courseId: string,
    moduleId: string,
    currentTime: number,
    duration: number,
    videoUrl: string
  ): Promise<void> {
    if (!user?.id) return;
    await loadAllProgress();
    await invalidateRepositories();
  }

  /**
   * A lesson was completed (Mark Lesson Complete, or automatically at 90%
   * watched). Only that course changed, so only that course is reloaded: one
   * progress request (shared with the lesson screen's own reload,
   * lib/courseRequests.ts) instead of one per enrolled course.
   *
   * Review H1: the course is merged only into a COMPLETE map. While the first
   * full load is still running it is awaited (not discarded); if none has
   * succeeded yet, a full load runs instead (lib/progressRefreshCoordinator.ts).
   * Other screens reload on focus via markProgressChanged (invalidateRepositories).
   */
  async function completeModule(courseId: string, moduleId: string): Promise<void> {
    if (!user?.id) return;
    const userId = user.id;
    try {
      await refreshCoordinator.refreshCourse({
        startFull: () => loadAllProgressRun(),
        refreshOne: async () => {
          const [updated] = await fetchRemoteProgress(userId, { onlyCourseId: String(courseId) });
          if (!updated || currentUserIdRef.current !== userId) return;
          const next = new Map(courseProgressRef.current);
          next.set(updated.courseId, updated);
          courseProgressRef.current = next;
          setCourseProgress(next);
          // Continue Learning from the complete map, never from one course.
          const rebuilt = buildWatchlist(Array.from(next.values()));
          setWatchlist(rebuilt);
          await ProgressStorage.saveWatchlist(userId, rebuilt);
        },
      });
    } catch (error) {
      // Keep what is shown; screens still reload on focus (below).
      console.warn("Failed to refresh completed course progress:", error);
    }
    await invalidateRepositories();
  }

  // (updateWatchlist was never called; Continue Learning is now rebuilt in
  // loadAllProgress from lib/continueLearning.ts.)

  async function refreshWatchlist(): Promise<void> {
    if (!user?.id) return;
    const loadedWatchlist = await ProgressStorage.loadWatchlist(user.id);
    setWatchlist(normalizeWatchlist(loadedWatchlist));
  }

  return (
    <ProgressContext.Provider
      value={{
        courseProgress,
        watchlist,
        isLoading,
        progressLoadFailed,
        getCourseProgress,
        getModuleProgress,
        updateVideoProgress,
        completeModule,
        enrollCourse,
        refreshWatchlist,
        refreshProgress: loadAllProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress() {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within ProgressProvider");
  return ctx;
}
