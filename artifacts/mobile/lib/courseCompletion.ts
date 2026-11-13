/**
 * Course completion, as the backend defines it (2026-11-13).
 *
 * Rule (unchanged, from lesson-progress.service.ts findMyCourseProgress and
 * certificates.service.ts): a course is complete when it has at least one
 * lesson and every one of its current lessons has a completed lesson_progress
 * row. Opening or partly watching a lesson never completes a course.
 *
 * The backend does not write enrollments.completed_at for students (only the
 * admin PATCH /enrollments/:id can), so completed_at alone must never be the
 * only completion signal in the app. It is still honoured when present.
 *
 * The backend's is_completed flag is used whenever it is present, so the app
 * agrees with the backend (and its certificate check). Displayed counts come
 * from the per-lesson `lessons` array, and percentages never exceed 100 or show
 * 100 for an unfinished course.
 *
 * Pure module: no React Native imports, so tests can load it directly.
 */

export interface CourseProgressSummary {
  completed: number;
  total: number;
  percentage: number;
  isCompleted: boolean;
  /**
   * When the course became complete: the latest last_watched_at among its
   * completed lessons. Only set when isCompleted and the per-lesson list is
   * available.
   */
  completedAt?: string;
}

/** Same rounding rule as computeCoursePercentage in progressStorage.ts. */
export function coursePercentage(completed: number, total: number): number {
  if (total <= 0) return 0;
  if (completed >= total) return 100;
  const ratio = Math.round((completed / total) * 100);
  return Math.max(0, Math.min(ratio, 99));
}

/**
 * Summarises a GET /lesson-progress/my/course/:courseId response (wrapped in
 * {success, data} or bare). Prefers the per-lesson list; falls back to the
 * backend's own counters when the list is absent.
 */
export function summarizeCourseProgress(response: any): CourseProgressSummary {
  const data = response?.data ?? response;
  if (!data || typeof data !== "object") {
    return { completed: 0, total: 0, percentage: 0, isCompleted: false };
  }

  const backendFlag = data.is_completed ?? data.isCompleted;

  if (Array.isArray(data.lessons)) {
    const total = data.lessons.length;
    const completed = data.lessons.filter((l: any) => l?.progress?.is_completed === true).length;
    // The backend's is_completed is authoritative (the certificate check uses
    // the same count); the per-lesson count is only the fallback.
    const isCompleted =
      typeof backendFlag === "boolean" ? backendFlag && total > 0 : total > 0 && completed >= total;
    let completedAt: string | undefined;
    if (isCompleted) {
      let latest = -Infinity;
      for (const l of data.lessons) {
        const at = l?.progress?.last_watched_at;
        const t = at ? new Date(at).getTime() : NaN;
        if (Number.isFinite(t) && t > latest) {
          latest = t;
          completedAt = new Date(t).toISOString();
        }
      }
    }
    const percentage = isCompleted ? 100 : Math.min(99, coursePercentage(completed, total));
    return { completed, total, percentage, isCompleted, completedAt };
  }

  const total = Number(data.total_lessons ?? data.totalLessons ?? 0) || 0;
  const completed = Math.min(
    total,
    Number(data.completed_lessons ?? data.completedLessonsCount ?? data.completedLessons ?? 0) || 0,
  );
  const isCompleted =
    typeof backendFlag === "boolean" ? backendFlag && total > 0 : total > 0 && completed >= total;
  const reported = Number(data.completion_percentage ?? data.completionPercentage);
  const percentage = isCompleted
    ? 100
    : Number.isFinite(reported)
      ? Math.max(0, Math.min(99, Math.round(reported)))
      : coursePercentage(completed, total);
  return { completed, total, percentage, isCompleted };
}

/**
 * Completion from the per-lesson progress the course and learn screens already
 * hold. Only lessons in `lessonIds` (the course's current lessons) count.
 */
export function isCourseCompleteFromLessons(
  lessonsProgress: Array<{ lesson_id?: unknown; is_completed?: unknown }> | null | undefined,
  lessonIds: Array<string | number>,
): boolean {
  if (!lessonIds || lessonIds.length === 0) return false;
  const done = new Set(
    (lessonsProgress ?? [])
      .filter((p) => p?.is_completed === true)
      .map((p) => String(p.lesson_id)),
  );
  return lessonIds.every((id) => done.has(String(id)));
}

/** True when either the enrollment was stamped complete or the lessons say so. */
export function isCourseComplete(input: {
  completedAt?: string | null;
  isCompleted?: boolean | null;
}): boolean {
  return !!input.completedAt || input.isCompleted === true;
}

// ── Progress-change signal ──────────────────────────────────────────────────
// Bumped whenever lesson progress or enrollments change (lesson completed,
// enrollment created). Tab screens that keep data in memory compare it on
// focus and reload only when something changed, so a finished course shows as
// finished without a pull-to-refresh or restart.
let progressVersion = 0;

export function markProgressChanged(): void {
  progressVersion += 1;
}

export function getProgressVersion(): number {
  return progressVersion;
}
