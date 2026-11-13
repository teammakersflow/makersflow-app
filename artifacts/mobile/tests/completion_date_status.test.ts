// First-completion date vs live completion status (owner decision 2026-11-13,
// option 1). Run: node --test artifacts/mobile/tests/*.test.ts
//
// Backend (makersflow-backend, feat/first-completion-date) stamps
// enrollments.completed_at once, at first completion, and never overwrites it.
// The app must show CURRENT status from the live lesson rule and use
// completed_at only as the "first completed on" date.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  summarizeCourseProgress,
  isCourseComplete,
  isCourseCompleteFromLessons,
  resolveCompletionDate,
} from "../lib/courseCompletion.ts";
import { buildContinueLearning } from "../lib/continueLearning.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

/** A tiny model of the backend: lessons, progress, enrollment.completed_at. */
function course(lessonIds: string[]) {
  const state = {
    lessons: [...lessonIds],
    progress: new Map<string, { is_completed: boolean; last_watched_at: string }>(),
    completedAt: null as string | null,
  };
  const response = () => {
    const done = state.lessons.filter((id) => state.progress.get(id)?.is_completed).length;
    return {
      data: {
        total_lessons: state.lessons.length,
        completed_lessons: done,
        is_completed: state.lessons.length > 0 && done === state.lessons.length,
        lessons: state.lessons.map((id) => ({ lesson_id: id, progress: state.progress.get(id) ?? null })),
      },
    };
  };
  // backend rule: stamp only on a real incomplete -> completed change, only if null
  const complete = (id: string, at: string) => {
    const was = state.progress.get(id)?.is_completed === true;
    state.progress.set(id, { is_completed: true, last_watched_at: at });
    if (!was && response().data.is_completed && state.completedAt === null) state.completedAt = at;
  };
  const rewatch = (id: string, at: string) => {
    const p = state.progress.get(id)!;
    state.progress.set(id, { ...p, last_watched_at: at });
  };
  /** What the app shows: live status + first-completion date. */
  const view = (certificateIssuedAt: string | null = null) => {
    const s = summarizeCourseProgress(response());
    return {
      completed: isCourseComplete({ isCompleted: s.isCompleted }),
      percentage: s.percentage,
      date: s.isCompleted
        ? resolveCompletionDate({ enrollmentCompletedAt: state.completedAt, certificateIssuedAt, lessonCompletedAt: s.completedAt })
        : null,
      firstCompletedAt: state.completedAt,
    };
  };
  return { state, complete, rewatch, view, response };
}

const D = (d: number) => `2026-11-${String(d).padStart(2, "0")}T10:00:00.000Z`;

describe("first completion", () => {
  test("date is set when every current lesson is completed, not before", () => {
    const c = course(["1", "2"]);
    c.complete("1", D(1));
    assert.deepEqual(c.view(), { completed: false, percentage: 50, date: null, firstCompletedAt: null });
    c.complete("2", D(2));
    assert.deepEqual(c.view(), { completed: true, percentage: 100, date: D(2), firstCompletedAt: D(2) });
  });
});

describe("rewatching", () => {
  test("rewatching and re-sending completions never move the date", () => {
    const c = course(["1", "2"]);
    c.complete("1", D(1));
    c.complete("2", D(2));
    c.rewatch("1", D(20));
    c.complete("1", D(21)); // e.g. watched past 90% again
    const v = c.view();
    assert.equal(v.completed, true);
    assert.equal(v.date, D(2), "original first-completion date");
    assert.equal(summarizeCourseProgress(c.response()).completedAt, D(21), "the lesson-based date did move (why it is only a fallback)");
  });
});

describe("lessons added after completion", () => {
  test("course becomes In Progress; completed_at stays but does NOT count as completed", () => {
    const c = course(["1"]);
    c.complete("1", D(1));
    c.state.lessons.push("2"); // admin adds a lesson
    const v = c.view();
    assert.equal(v.completed, false, "status is live");
    assert.equal(v.percentage, 50);
    assert.equal(v.firstCompletedAt, D(1), "date kept for history");
    // Continue Learning shows it again, at the new lesson
    const list = buildContinueLearning([
      {
        courseId: "7", courseTitle: "C", thumbnailUrl: null,
        lessons: c.state.lessons.map((id) => ({ id, title: `L${id}` })),
        progress: [...c.state.progress].map(([lesson_id, p]) => ({ lesson_id, ...p })),
        isCompleted: v.completed, percentage: v.percentage,
      },
    ]);
    assert.equal(list[0]?.lessonId, "2");
    // screens that hold per-lesson progress agree
    const lessonsProgress = [...c.state.progress].map(([lesson_id, p]) => ({ lesson_id, is_completed: p.is_completed }));
    assert.equal(isCourseCompleteFromLessons(lessonsProgress, c.state.lessons), false);
  });

  test("completing the new lessons completes it again with the ORIGINAL date", () => {
    const c = course(["1"]);
    c.complete("1", D(1));
    c.state.lessons.push("2", "3");
    c.complete("2", D(10));
    assert.equal(c.view().completed, false);
    c.complete("3", D(11));
    const v = c.view();
    assert.equal(v.completed, true);
    assert.equal(v.date, D(1));
    assert.equal(v.firstCompletedAt, D(1));
  });

  test("historical completion (no completed_at yet) uses the certificate date", () => {
    const c = course(["1"]);
    c.state.progress.set("1", { is_completed: true, last_watched_at: D(15) });
    assert.equal(c.view(D(3)).date, D(3));
  });
});

describe("screens keep status and date separate", () => {
  test("no screen treats a non-null completed_at as 'completed now'", () => {
    const files = [
      "app/(tabs)/index.tsx", "app/(tabs)/progress.tsx", "app/(tabs)/profile.tsx", "app/achievements.tsx",
      "app/course/[id].tsx", "app/course/learn.tsx", "repositories/coursesRepository.ts", "repositories/homeRepository.ts",
    ];
    for (const f of files) {
      const src = strip(read(f));
      assert.doesNotMatch(src, /!!enrollment\?\.completed_at \|\|/, f);
      assert.doesNotMatch(src, /if \(enr\.completed_at\) \{/, f);
      assert.doesNotMatch(src, /completedAt != null|completedAt !== null/, f);
      assert.doesNotMatch(src, /isCourseComplete\(\{ completedAt/, f);
    }
  });

  test("Profile/Achievements: status from live progress, date prefers the stamped first-completion date", () => {
    for (const f of ["app/(tabs)/profile.tsx", "app/achievements.tsx"]) {
      const src = strip(read(f));
      assert.match(src, /if \(prog\.isCompleted\) \{/, f);
      assert.match(src, /enrollmentCompletedAt: enr\.completed_at,/, f);
    }
  });

  test("date order: stamped completed_at > certificate > lesson date", () => {
    assert.equal(resolveCompletionDate({ enrollmentCompletedAt: D(1), certificateIssuedAt: D(2), lessonCompletedAt: D(9) }), D(1));
  });
});
