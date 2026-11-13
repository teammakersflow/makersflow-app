// Course completion not updating in the UI (2026-11-13).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  summarizeCourseProgress,
  isCourseCompleteFromLessons,
  isCourseComplete,
  coursePercentage,
  markProgressChanged,
  getProgressVersion,
} from "../lib/courseCompletion.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

// Shape of GET /lesson-progress/my/course/:courseId (lesson-progress.service.ts
// findMyCourseProgress), wrapped by the ResponseInterceptor.
function backendResponse(lessons: Array<null | { done: boolean; at?: string; watch?: number }>) {
  const completed = lessons.filter((l) => l?.done).length;
  const total = lessons.length;
  return {
    success: true,
    message: "Request completed successfully",
    data: {
      course_id: "7",
      total_lessons: total,
      completed_lessons: completed,
      completion_percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
      is_completed: total > 0 && completed === total,
      lessons: lessons.map((p, i) => ({
        lesson_id: String(100 + i),
        module_id: "1",
        title: `L${i}`,
        order_index: i,
        progress: p
          ? { id: String(900 + i), is_completed: p.done, watch_percentage: p.watch ?? (p.done ? 100 : 40), last_watched_at: p.at ?? null }
          : null,
      })),
    },
  };
}

describe("backend completion rule is preserved", () => {
  test("all lessons completed -> complete, 100%, completedAt = last completion", () => {
    const s = summarizeCourseProgress(
      backendResponse([
        { done: true, at: "2026-11-01T10:00:00.000Z" },
        { done: true, at: "2026-11-03T09:30:00.000Z" },
        { done: true, at: "2026-11-02T08:00:00.000Z" },
      ]),
    );
    assert.equal(s.isCompleted, true);
    assert.equal(s.percentage, 100);
    assert.equal(s.completed, 3);
    assert.equal(s.total, 3);
    assert.equal(s.completedAt, "2026-11-03T09:30:00.000Z");
  });

  test("some lessons completed -> not complete, rounded percentage", () => {
    const s = summarizeCourseProgress(backendResponse([{ done: true }, { done: true }, null]));
    assert.equal(s.isCompleted, false);
    assert.equal(s.percentage, 67);
    assert.equal(s.completedAt, undefined);
  });

  test("opening or watching a lesson does not complete the course", () => {
    const opened = summarizeCourseProgress(backendResponse([{ done: false, watch: 5 }]));
    const watched = summarizeCourseProgress(backendResponse([{ done: false, watch: 89 }, { done: true }]));
    assert.equal(opened.isCompleted, false);
    assert.equal(opened.percentage, 0);
    assert.equal(watched.isCompleted, false);
    assert.equal(watched.percentage, 50);
  });

  test("a course with no lessons is never complete", () => {
    const s = summarizeCourseProgress(backendResponse([]));
    assert.equal(s.isCompleted, false);
    assert.equal(s.percentage, 0);
  });

  test("backend is_completed is authoritative when present", () => {
    const r = backendResponse([{ done: true }, { done: true }]);
    // e.g. a stale row for a deleted lesson makes the backend count 3/2 -> false
    (r.data as any).is_completed = false;
    (r.data as any).completed_lessons = 3;
    (r.data as any).completion_percentage = 150;
    const s = summarizeCourseProgress(r);
    assert.equal(s.isCompleted, false);
    assert.ok(s.percentage <= 99, `percentage ${s.percentage} must not claim completion`);
  });

  test("an unfinished course never shows 100% (199/200 rounds to 100)", () => {
    assert.equal(coursePercentage(199, 200), 99);
    assert.equal(coursePercentage(200, 200), 100);
    const s = summarizeCourseProgress({ total_lessons: 200, completed_lessons: 199, completion_percentage: 100, is_completed: false });
    assert.equal(s.isCompleted, false);
    assert.equal(s.percentage, 99);
  });

  test("counter-only and camelCase responses are understood", () => {
    assert.equal(summarizeCourseProgress({ total_lessons: 4, completed_lessons: 4 }).isCompleted, true);
    assert.equal(summarizeCourseProgress({ totalLessons: 4, completedLessons: 2, completionPercentage: 50 }).percentage, 50);
    assert.equal(summarizeCourseProgress(null).isCompleted, false);
  });
});

describe("screen-level completion helpers", () => {
  test("isCourseCompleteFromLessons needs every current lesson completed", () => {
    const ids = ["1", "2", "3"];
    const p = (id: string, done: boolean) => ({ lesson_id: id, is_completed: done });
    assert.equal(isCourseCompleteFromLessons([p("1", true), p("2", true), p("3", true)], ids), true);
    assert.equal(isCourseCompleteFromLessons([p("1", true), p("2", true), p("3", false)], ids), false);
    assert.equal(isCourseCompleteFromLessons([p("1", true), p("2", true)], ids), false);
    // progress for a lesson that is no longer in the course does not count
    assert.equal(isCourseCompleteFromLessons([p("1", true), p("2", true), p("99", true)], ids), false);
    assert.equal(isCourseCompleteFromLessons([], []), false);
    assert.equal(isCourseCompleteFromLessons([p("1", true)], [1]), true); // numeric ids
  });

  test("completed_at still counts when an admin stamped it", () => {
    assert.equal(isCourseComplete({ completedAt: "2026-11-01T00:00:00Z", isCompleted: false }), true);
    assert.equal(isCourseComplete({ completedAt: null, isCompleted: true }), true);
    assert.equal(isCourseComplete({ completedAt: null, isCompleted: false }), false);
    assert.equal(isCourseComplete({}), false);
  });

  test("progress-change signal increments", () => {
    const before = getProgressVersion();
    markProgressChanged();
    assert.equal(getProgressVersion(), before + 1);
  });
});

describe("screens use lesson-based completion, not completed_at alone", () => {
  test("Home completed count uses isCompleted", () => {
    const src = strip(read("app/(tabs)/index.tsx"));
    assert.doesNotMatch(src, /filter\(\(p\) => p\.completedAt !== null\)/);
    assert.match(src, /p\.isCompleted/);
    assert.match(strip(read("repositories/homeRepository.ts")), /isCompleted:\s*isCourseComplete\(/);
  });

  test("Progress tab counts completed courses with isCourseComplete", () => {
    const src = strip(read("app/(tabs)/progress.tsx"));
    assert.doesNotMatch(src, /enr\.completed_at !== null/);
    assert.match(src, /isCourseComplete\(\{ completedAt: enr\.completed_at, isCompleted: prog\.isCompleted \}\)/);
  });

  test("My Learning classifies by isCompleted", () => {
    const src = strip(read("app/(tabs)/courses.tsx"));
    assert.match(src, /c\.isCompleted/);
    assert.match(strip(read("repositories/coursesRepository.ts")), /isCompleted:\s*isCourseComplete\(/);
  });

  test("Course details and learn screen derive completion from lesson progress", () => {
    for (const f of ["app/course/[id].tsx", "app/course/learn.tsx"]) {
      const src = strip(read(f));
      assert.doesNotMatch(src, /const isCourseCompleted = !!enrollment\?\.completed_at;/, f);
      assert.match(src, /isCourseCompleteFromLessons\(/, f);
    }
  });

  test("Profile and Achievements use the lesson completion time, not the enrollment date", () => {
    const profile = strip(read("app/(tabs)/profile.tsx"));
    assert.doesNotMatch(profile, /completedAt: enr\.enrolled_at \?\? ''/);
    assert.doesNotMatch(profile, /completeCourse\(/);
    assert.match(profile, /prog\.isCompleted/);
    assert.match(strip(read("app/achievements.tsx")), /completedAt: prog\.completedAt/);
  });

  test("ProgressContext no longer reads only camelCase completionPercentage", () => {
    const src = strip(read("lib/progressStorage.ts"));
    assert.doesNotMatch(src, /progress: courseProgData\?\.completionPercentage \|\| 0/);
    assert.match(src, /summarizeCourseProgress\(courseProgData\)\.percentage/);
  });
});

describe("tab screens reload after progress changes", () => {
  test("cache invalidation raises the progress-change signal", () => {
    assert.match(strip(read("context/ProgressContext.tsx")), /markProgressChanged\(\)/);
    assert.match(strip(read("services/enrollmentService.ts")), /async function invalidateCaches\(\) \{\s*clearEnrollmentCache\(\);\s*markProgressChanged\(\);/);
    const ps = strip(read("lib/progressStorage.ts"));
    assert.match(ps, /watchPercentage >= 90\) markProgressChanged\(\)/);
    assert.match(ps, /if \(sent > 0\) markProgressChanged\(\)/);
  });

  for (const f of ["app/(tabs)/courses.tsx", "app/(tabs)/index.tsx", "app/(tabs)/progress.tsx"]) {
    test(`${f} reloads on focus when the signal changed`, () => {
      const src = strip(read(f));
      assert.match(src, /loadedProgressVersion\.current !== getProgressVersion\(\)/);
      assert.match(src, /loadedProgressVersion\.current = getProgressVersion\(\)/);
    });
  }
});
