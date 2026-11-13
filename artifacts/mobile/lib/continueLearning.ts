/**
 * Continue Learning (2026-11-13): which enrolled courses to resume and where.
 *
 * Built only from data the app already loads: the course's lessons (in course
 * order, from getCourseModules) and the learner's lesson progress (from
 * GET /lesson-progress/my/course/:courseId). No new backend API.
 *
 * Rules
 * - Completed courses are excluded (backend is_completed).
 * - Courses with no activity yet (no lesson watched or completed) are excluded:
 *   they appear under "Not started" in My Learning, not as something to resume.
 * - Resume lesson:
 *     1. the most recently accessed lesson, if it is not completed (resume it);
 *     2. otherwise the next incomplete lesson after it in course order (the
 *        learner just finished a lesson, so continue with the next one);
 *     3. otherwise the first incomplete lesson in the course.
 * - Only lessons that currently belong to the course count; progress for
 *   deleted lessons is ignored.
 * - One card per course (no duplicates), newest activity first, at most 10.
 *
 * Pure module: no React Native imports, so tests can load it directly.
 */

export interface ResumeLesson {
  id: string;
  title: string;
}

export interface ResumeLessonProgress {
  lesson_id: string | number;
  is_completed?: boolean;
  watch_percentage?: number | string | null;
  current_time_secs?: number | string | null;
  last_watched_at?: string | null;
}

export interface ResumeCourseInput {
  courseId: string;
  courseTitle: string;
  /** First thumbnail URL, or null for the default artwork. */
  thumbnailUrl: string | null;
  /** Current lessons in course order. */
  lessons: ResumeLesson[];
  progress: ResumeLessonProgress[];
  isCompleted: boolean;
  /** Course percentage (0-100), shown on the card. */
  percentage: number;
}

export interface ResumePoint {
  lessonId: string;
  lessonTitle: string;
  /** Saved position in the resume lesson, in seconds (0 for a new lesson). */
  currentTimeSecs: number;
  watchPercentage: number;
  /** Latest activity anywhere in the course (ISO), used for ordering. */
  lastActivityAt: string;
}

export interface ContinueLearningEntry extends ResumePoint {
  courseId: string;
  courseTitle: string;
  thumbnailUrl: string | null;
  coursePercentage: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const time = (v: unknown) => {
  const t = v ? new Date(v as string).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};
const hasActivity = (p: ResumeLessonProgress) =>
  p.is_completed === true || num(p.watch_percentage) > 0 || num(p.current_time_secs) > 0;

export function pickResumePoint(
  lessons: ResumeLesson[],
  progress: ResumeLessonProgress[],
): ResumePoint | null {
  if (!lessons || lessons.length === 0) return null;

  const order = new Map(lessons.map((l, i) => [String(l.id), i]));
  const byLesson = new Map<string, ResumeLessonProgress>();
  for (const p of progress ?? []) {
    const id = String(p.lesson_id);
    if (!order.has(id)) continue; // lesson no longer in the course
    const prev = byLesson.get(id);
    if (!prev || time(p.last_watched_at) >= time(prev.last_watched_at)) byLesson.set(id, p);
  }

  const active = Array.from(byLesson.entries()).filter(([, p]) => hasActivity(p));
  if (active.length === 0) return null; // not started

  const isDone = (id: string) => byLesson.get(id)?.is_completed === true;
  if (lessons.every((l) => isDone(String(l.id)))) return null; // finished

  active.sort((a, b) => time(b[1].last_watched_at) - time(a[1].last_watched_at));
  const [latestId, latest] = active[0];
  const lastActivity = time(latest.last_watched_at);

  let target: ResumeLesson | undefined;
  if (!isDone(latestId)) {
    target = lessons[order.get(latestId)!];
  } else {
    const from = order.get(latestId)! + 1;
    target =
      lessons.slice(from).find((l) => !isDone(String(l.id))) ??
      lessons.find((l) => !isDone(String(l.id)));
  }
  if (!target) return null;

  const tp = byLesson.get(String(target.id));
  const resumable = tp && !tp.is_completed;
  return {
    lessonId: String(target.id),
    lessonTitle: target.title,
    currentTimeSecs: resumable ? num(tp!.current_time_secs) : 0,
    watchPercentage: resumable ? Math.min(100, num(tp!.watch_percentage)) : 0,
    lastActivityAt: Number.isFinite(lastActivity) ? new Date(lastActivity).toISOString() : new Date(0).toISOString(),
  };
}

export const MAX_CONTINUE_LEARNING = 10;

export function buildContinueLearning(courses: ResumeCourseInput[]): ContinueLearningEntry[] {
  const byCourse = new Map<string, ContinueLearningEntry>();
  for (const c of courses ?? []) {
    if (!c || c.isCompleted) continue;
    const point = pickResumePoint(c.lessons, c.progress);
    if (!point) continue;
    const entry: ContinueLearningEntry = {
      ...point,
      courseId: String(c.courseId),
      courseTitle: c.courseTitle,
      thumbnailUrl: c.thumbnailUrl,
      coursePercentage: Math.max(0, Math.min(100, Math.round(num(c.percentage)))),
    };
    const prev = byCourse.get(entry.courseId);
    if (!prev || time(entry.lastActivityAt) > time(prev.lastActivityAt)) byCourse.set(entry.courseId, entry);
  }
  return Array.from(byCourse.values())
    .sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt))
    .slice(0, MAX_CONTINUE_LEARNING);
}
