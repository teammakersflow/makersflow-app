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
import { buildContinueLearning, ResumeCourseInput } from "@/lib/continueLearning";

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
  refreshProgress: () => Promise<void>;
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

  // Load all progress on mount or user change
  useEffect(() => {
    if (user?.id) {
      loadAllProgress();
    } else {
      hydratedForUser.current = null;
      setCourseProgress(new Map());
      setWatchlist([]);
      setProgressLoadFailed(false);
      setIsLoading(false);
    }
  }, [user?.id]);

  async function loadAllProgress() {
    if (!user?.id) return;

    // After an app restart, show the saved Continue Learning cards right away
    // while the backend data loads.
    if (hydratedForUser.current !== user.id) {
      hydratedForUser.current = user.id;
      const saved = await ProgressStorage.loadWatchlist(user.id).catch(() => []);
      if (saved.length > 0) setWatchlist(normalizeWatchlist(saved));
    }

    setIsLoading(true);
    try {
      let allProgress = await fetchRemoteProgress(user.id);

      // Save to local storage for offline use
      for (const p of allProgress) {
        await ProgressStorage.saveCourseProgress(p);
      }

      const progressMap = new Map<string, UserCourseProgress>();
      allProgress.forEach((p) => progressMap.set(p.courseId, p));
      setCourseProgress(progressMap);

      // Continue Learning is rebuilt from scratch on every load (no stale or
      // duplicate entries; completed courses drop out) and saved for restarts.
      const rebuilt = buildWatchlist(allProgress);
      setWatchlist(rebuilt);
      await ProgressStorage.saveWatchlist(user.id, rebuilt);
      setProgressLoadFailed(false);
    } catch (error) {
      console.error("Failed to load progress:", error);
      setProgressLoadFailed(true);
      // Fallback to local storage on error (e.g. offline). Keep what is
      // already shown rather than replacing it with nothing.
      try {
        const localProgress = await ProgressStorage.loadAllCourseProgress(user.id);
        if (localProgress.length > 0) {
          const progressMap = new Map<string, UserCourseProgress>();
          localProgress.forEach((p) => progressMap.set(p.courseId, p));
          setCourseProgress(progressMap);
        }
        const fromSaved = buildWatchlist(localProgress);
        const savedWatchlist = fromSaved.length > 0 ? fromSaved : await ProgressStorage.loadWatchlist(user.id);
        if (savedWatchlist.length > 0) setWatchlist(normalizeWatchlist(savedWatchlist));
      } catch (localError) {
        console.error("Failed to load local progress fallback:", localError);
      }
    } finally {
      setIsLoading(false);
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

  async function completeModule(courseId: string, moduleId: string): Promise<void> {
    if (!user?.id) return;
    await loadAllProgress();
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
