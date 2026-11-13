// Courses follow-ups (2026-11-13): Continue Learning, error states, manual
// completion retry, completion-date preservation.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContinueLearning, pickResumePoint, MAX_CONTINUE_LEARNING } from "../lib/continueLearning.ts";
import { createProgressOutbox } from "../lib/progressOutbox.ts";
import {
  summarizeCourseProgress,
  resolveCompletionDate,
  markProgressChanged,
  onProgressChanged,
} from "../lib/courseCompletion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

const lessons = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), title: `Lesson ${i + 1}` }));
const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const P = (id: number, opts: { done?: boolean; watch?: number; pos?: number; day: number }) => ({
  lesson_id: String(id),
  is_completed: !!opts.done,
  watch_percentage: opts.watch ?? (opts.done ? 100 : 0),
  current_time_secs: opts.pos ?? 0,
  last_watched_at: at(opts.day),
});
const course = (id: string, ps: ReturnType<typeof P>[], extra: Partial<{ isCompleted: boolean; n: number; percentage: number }> = {}) => ({
  courseId: id,
  courseTitle: `Course ${id}`,
  thumbnailUrl: null,
  lessons: lessons(extra.n ?? 4),
  progress: ps,
  isCompleted: extra.isCompleted ?? false,
  percentage: extra.percentage ?? 25,
});

// ── 1. Continue Learning ─────────────────────────────────────────────────────
describe("Continue Learning: resume point", () => {
  test("resumes the most recently accessed incomplete lesson at its saved position", () => {
    const r = pickResumePoint(lessons(4), [P(1, { done: true, day: 1 }), P(2, { watch: 40, pos: 120, day: 3 })]);
    assert.equal(r?.lessonId, "2");
    assert.equal(r?.currentTimeSecs, 120);
    assert.equal(r?.watchPercentage, 40);
    assert.equal(r?.lastActivityAt, at(3));
  });

  test("after finishing a lesson, continues with the next incomplete lesson", () => {
    const r = pickResumePoint(lessons(4), [P(1, { done: true, day: 1 }), P(2, { done: true, day: 2 })]);
    assert.equal(r?.lessonId, "3");
    assert.equal(r?.currentTimeSecs, 0, "a new lesson starts at 0");
  });

  test("the latest activity wins over an older partly watched lesson", () => {
    const r = pickResumePoint(lessons(4), [P(1, { watch: 30, pos: 50, day: 1 }), P(3, { done: true, day: 5 })]);
    assert.equal(r?.lessonId, "4", "continue after the lesson finished most recently");
  });

  test("wraps to the first incomplete lesson when everything after is done", () => {
    const r = pickResumePoint(lessons(3), [P(2, { done: true, day: 1 }), P(3, { done: true, day: 2 })]);
    assert.equal(r?.lessonId, "1");
  });

  test("no activity -> not shown; all lessons done -> not shown", () => {
    assert.equal(pickResumePoint(lessons(3), []), null);
    assert.equal(pickResumePoint(lessons(3), [P(1, { watch: 0, day: 1 })]), null);
    assert.equal(pickResumePoint(lessons(2), [P(1, { done: true, day: 1 }), P(2, { done: true, day: 2 })]), null);
    assert.equal(pickResumePoint([], [P(1, { watch: 10, day: 1 })]), null);
  });

  test("progress for deleted lessons is ignored", () => {
    const r = pickResumePoint(lessons(2), [P(1, { done: true, day: 1 }), P(99, { watch: 50, pos: 30, day: 9 })]);
    assert.equal(r?.lessonId, "2");
    assert.equal(r?.lastActivityAt, at(1));
  });
});

describe("Continue Learning: list", () => {
  test("excludes completed and not-started courses, one card per course, newest first", () => {
    const list = buildContinueLearning([
      course("A", [P(1, { watch: 20, pos: 10, day: 2 })]),
      course("B", [P(1, { done: true, day: 5 })]),
      course("C", [P(1, { done: true, day: 9 })], { isCompleted: true }),
      course("D", []),
      course("A", [P(1, { watch: 60, pos: 90, day: 7 })]), // duplicate course id
    ]);
    assert.deepEqual(list.map((e) => e.courseId), ["A", "B"]);
    assert.equal(list[0].currentTimeSecs, 90, "the newer duplicate wins");
    assert.equal(list[1].lessonId, "2");
  });

  test(`caps at ${MAX_CONTINUE_LEARNING} and clamps course percentage`, () => {
    const many = Array.from({ length: 15 }, (_, i) => course(`c${i}`, [P(1, { watch: 10, day: (i % 28) + 1 })], { percentage: 140 }));
    const list = buildContinueLearning(many);
    assert.equal(list.length, MAX_CONTINUE_LEARNING);
    assert.ok(list.every((e) => e.coursePercentage <= 100));
  });

  test("ProgressContext rebuilds and persists the list; cards pass the lesson id", () => {
    const ctx = strip(read("context/ProgressContext.tsx"));
    assert.match(ctx, /const rebuilt = buildWatchlist\(allProgress\)/);
    assert.match(ctx, /ProgressStorage\.saveWatchlist\(user\.id, rebuilt\)/);
    assert.match(ctx, /ProgressStorage\.loadWatchlist\(user\.id\)/, "saved cards are shown after a restart");
    assert.doesNotMatch(ctx, /async function updateWatchlist/);
    for (const f of ["components/WatchlistCard.tsx", "app/(tabs)/index.tsx"]) {
      assert.match(strip(read(f)), /lessonId: item\.lessonId \?\? item\.moduleId/, f);
    }
    assert.match(strip(read("lib/progressStorage.ts")), /courseProgressObj\.continueInput = \{/);
  });
});

// ── 4. Manual completion retry ───────────────────────────────────────────────
function memStore() {
  let v: string | null = null;
  return { get: async () => v, set: async (x: string) => { v = x; } };
}
const U = "user-1";

describe("manual completion: outbox", () => {
  test("a queued completion stays a completion when newer playback updates arrive", async () => {
    let t = 1000;
    const ob = createProgressOutbox(memStore(), () => t);
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true });
    t = 2000;
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 45, watchPercentage: 30 });
    const [e] = await ob.pending(U);
    assert.equal(e.completed, true, "completion is sticky");
    assert.equal(e.currentTimeSecs, 45, "keeps the newest position");
    assert.equal(e.noPosition, undefined);
  });

  test("a completion without position keeps the position already queued", async () => {
    let t = 1000;
    const ob = createProgressOutbox(memStore(), () => t);
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 80, watchPercentage: 60 });
    t = 2000;
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true });
    const [e] = await ob.pending(U);
    assert.equal(e.completed, true);
    assert.equal(e.currentTimeSecs, 80, "position/time spent is not reset to 0");
    assert.equal(e.noPosition, undefined);
  });

  test("an older completion merged after a newer update is not lost", async () => {
    const ob = createProgressOutbox(memStore(), () => 5000);
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 45, watchPercentage: 30, at: 3000 });
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true, at: 2000 });
    const [e] = await ob.pending(U);
    assert.equal(e.completed, true);
    assert.equal(e.currentTimeSecs, 45);
  });

  test("offline then online: retried until sent, one record on the server, flags delivered", async () => {
    const ob = createProgressOutbox(memStore());
    // Fake server: one row per (user, course, lesson), like uq_lesson_progress_ucl.
    const rows = new Map<string, { is_completed: boolean }>();
    let online = false;
    const send = async (u: any) => {
      if (!online) throw new Error("Network request failed");
      const k = `${u.userId}:${u.courseId}:${u.lessonId}`;
      const row = rows.get(k) ?? { is_completed: false };
      if (u.completed || u.watchPercentage >= 90) row.is_completed = true;
      rows.set(k, row); // upsert, never a second row
      return true;
    };
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true });
    assert.equal(await ob.flush(U, send), 0, "offline: nothing sent");
    assert.equal(await ob.flush(U, send), 0, "still offline");
    assert.equal((await ob.pending(U)).length, 1, "kept for retry");
    online = true;
    assert.equal(await ob.flush(U, send), 1);
    assert.equal(await ob.flush(U, send), 0, "nothing left to resend");
    assert.equal(rows.size, 1, "no duplicate records");
    assert.equal(rows.get(`${U}:1:10`)?.is_completed, true);
  });

  test("markLessonComplete returns synced/queued, dedupes via the upsert path, and queues on failure", () => {
    const ps = strip(read("lib/progressStorage.ts"));
    assert.match(ps, /Promise<LessonCompletionResult>/);
    assert.match(ps, /performUpsertLessonProgress\(userId, courseId, lessonId, 0, 100, \{\s*completed: true,\s*noPosition: true,\s*\}\)/);
    assert.match(ps, /progressOutbox\s*\.put\(\{ userId, courseId, lessonId, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true \}\)/);
    assert.match(ps, /return 'queued';/);
    assert.match(ps, /completed: u\.completed,\s*noPosition: u\.noPosition,/, "flush replays the completion flags");
    assert.match(ps, /const isCompleted = opts\.completed === true \|\| watchPercentage >= 90;/);
  });

  test("learn screen: queued completion is shown as pending and never completes the course", () => {
    const src = strip(read("app/course/learn.tsx"));
    const queuedBranches = src.match(/if \(result === 'queued'\) \{[\s\S]*?return;\s*\}/g) ?? [];
    assert.equal(queuedBranches.length, 2, "video end + Mark Complete");
    for (const b of queuedBranches) {
      assert.match(b, /setPendingCompletionIds/);
      assert.doesNotMatch(b, /completeCourse|issueCertificate|setShowCompleteModal/);
    }
    assert.match(src, /Completed · waiting to sync/);
    assert.match(src, /isPendingSync/);
    // course completion is derived only from backend-confirmed lessonsProgress
    assert.match(src, /isCourseCompleteFromLessons\(lessonsProgress, lessons\.map/);
  });

  test("progress-change listeners fire and can unsubscribe", () => {
    let calls = 0;
    const off = onProgressChanged(() => { calls++; });
    markProgressChanged();
    off();
    markProgressChanged();
    assert.equal(calls, 1);
  });
});

// ── 5. Completion date ───────────────────────────────────────────────────────
describe("original completion date", () => {
  const backend = (lastWatched: string[]) => ({
    data: {
      is_completed: true,
      lessons: lastWatched.map((d, i) => ({ lesson_id: String(i + 1), progress: { is_completed: true, last_watched_at: d } })),
    },
  });

  test("certificate issue date wins and does not move when a lesson is rewatched", () => {
    const certificate = "2026-11-03T12:00:00.000Z";
    const before = summarizeCourseProgress(backend([at(1), at(3)]));
    const afterRewatch = summarizeCourseProgress(backend([at(20), at(3)])); // lesson 1 rewatched on the 20th
    assert.equal(afterRewatch.completedAt, at(20), "the lesson-based date moves (why it is only a fallback)");
    assert.equal(resolveCompletionDate({ certificateIssuedAt: certificate, lessonCompletedAt: before.completedAt }), certificate);
    assert.equal(resolveCompletionDate({ certificateIssuedAt: certificate, lessonCompletedAt: afterRewatch.completedAt }), certificate);
  });

  test("order: enrollment completed_at > certificate > lesson date > null", () => {
    assert.equal(resolveCompletionDate({ enrollmentCompletedAt: at(2), certificateIssuedAt: at(5), lessonCompletedAt: at(9) }), at(2));
    assert.equal(resolveCompletionDate({ certificateIssuedAt: at(5), lessonCompletedAt: at(9) }), at(5));
    assert.equal(resolveCompletionDate({ lessonCompletedAt: at(9) }), at(9));
    assert.equal(resolveCompletionDate({}), null);
  });

  test("Profile and Achievements use certificate dates", () => {
    for (const f of ["app/(tabs)/profile.tsx", "app/achievements.tsx"]) {
      const src = strip(read(f));
      assert.match(src, /certIssuedAt\.set\(String\(c\.course_id\), c\.issued_at\)/, f);
      assert.match(src, /resolveCompletionDate\(\{\s*enrollmentCompletedAt: enr\.completed_at,\s*certificateIssuedAt: certIssuedAt\.get\(courseId\),\s*lessonCompletedAt: prog\.completedAt,\s*\}\)/, f);
    }
  });
});

// ── 3. Error states ──────────────────────────────────────────────────────────
describe("failed requests are not shown as empty / 0%", () => {
  test("fetchCourseProgress reports failure; repositories and Progress refuse unknown progress", () => {
    // Rate-limit fix (2026-11-13): failures also carry their kind.
    assert.match(strip(read("lib/progressStorage.ts")), /watchMinutes: 0, failed: true, errorKind: classifyApiError\(error\)/);
    for (const f of ["repositories/coursesRepository.ts", "repositories/homeRepository.ts", "app/(tabs)/progress.tsx"]) {
      assert.match(strip(read(f)), /if \(prog\.failed\) throw new CourseProgressUnavailableError\([^)]*prog\.errorKind\)/, f);
    }
  });

  test("fetchRemoteProgress throws instead of returning [] and keeps saved per-course data", () => {
    const src = strip(read("lib/progressStorage.ts"));
    const body = src.slice(src.indexOf("export async function fetchRemoteProgress"), src.indexOf("const OUTBOX_KEY"));
    assert.doesNotMatch(body, /catch \(err\) \{[\s\S]*?return \[\];/);
    assert.match(body, /ProgressStorage\.loadCourseProgress\(userId, courseId\)/);
  });

  test("repositories flag errors; Home never caches zeros over saved progress", () => {
    const courses = strip(read("repositories/coursesRepository.ts"));
    assert.equal((courses.match(/loadFromCache\(userId\)\), error: true, errorKind: /g) ?? []).length, 2, "offline + failure");
    assert.match(courses, /\(!userId \|\| enrollmentsResult\)/, "no fake empty list while enrollments load");
    const home = strip(read("repositories/homeRepository.ts"));
    assert.doesNotMatch(home, /fetchProgress\(userId\)\.catch\(\(\) => EMPTY_PROGRESS\)/);
    assert.match(home, /progressFailed \? \{ \.\.\.result, error: true, errorKind: progressErrorKind \} : result/);
  });

  test("screens show error + retry instead of empty states and keep loaded data", () => {
    const courses = strip(read("app/(tabs)/courses.tsx"));
    assert.match(courses, /totalEnrolled === 0 && loadError \?/);
    assert.match(courses, /result\.data\.enrollments\.length > 0 \|\| prev\.length === 0 \? result\.data\.enrollments : prev/);
    const home = strip(read("app/(tabs)/index.tsx"));
    assert.match(home, /statsUnknown \? "–"/);
    // Rate-limit fix (2026-11-13): Home shows only its OWN failure; a
    // background (context) failure no longer puts an error on Home.
    assert.match(home, /\{progressError && \(/);
    assert.doesNotMatch(home, /progressLoadFailed/);
    const progress = strip(read("app/(tabs)/progress.tsx"));
    assert.match(progress, /loadError && !hasLoaded \? null : stats\.totalCoursesEnrolled === 0/);
    const detail = strip(read("app/course/[id].tsx"));
    assert.match(detail, /fetchCourseLessonsProgressStrict\(user\.id, id, \{ force: userInitiated \}\)/);
    assert.match(detail, /isEnrolled && progressLoadError &&/);
    const learn = strip(read("app/course/learn.tsx"));
    assert.match(learn, /setProgressLoadError\(true\)/);
    assert.doesNotMatch(learn, /fetchCourseLessonsProgress\(/, "learn screen only uses the strict fetch");
    for (const f of ["app/(tabs)/courses.tsx", "app/(tabs)/index.tsx", "app/(tabs)/progress.tsx", "app/course/[id].tsx"]) {
      assert.match(strip(read(f)), /<LoadErrorNotice/, f);
    }
  });
});
