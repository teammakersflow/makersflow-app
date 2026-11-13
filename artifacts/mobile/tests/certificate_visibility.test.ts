// Earned certificates stay visible when a course regresses to In Progress,
// and old cached completion status is dropped on upgrade (2026-11-13).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { earnedCertificatesNotCurrentlyCompleted } from "../lib/certificateEntries.ts";
import { summarizeCourseProgress, resolveCompletionDate } from "../lib/courseCompletion.ts";
import { CACHE_VERSION, decodeCachePayload } from "../constants/cachePolicy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

const FIRST = "2026-11-02T09:00:00.000Z";
const ISSUED = "2026-11-02T09:00:05.000Z";

/**
 * What Profile builds for its "Achievements & Certificates" section:
 * courses complete NOW (live rule, first-completion date) + earned
 * certificates whose course is not complete now.
 */
function profileCertificateList(opts: {
  lessons: string[];
  doneLessons: string[];
  enrollment: { course_id: number; completed_at: string | null; courses: { title: string } };
  certificates: Array<{ course_id: number; certificate_number: string; issued_at: string }>;
}) {
  const response = {
    data: {
      lessons: opts.lessons.map((id) => ({
        lesson_id: id,
        progress: opts.doneLessons.includes(id) ? { is_completed: true, last_watched_at: "2026-11-20T00:00:00.000Z" } : null,
      })),
    },
  };
  const s = summarizeCourseProgress(response);
  const courseId = String(opts.enrollment.course_id);
  const cert = opts.certificates.find((c) => String(c.course_id) === courseId);
  const completedNow = s.isCompleted
    ? [{
        courseId,
        courseTitle: opts.enrollment.courses.title,
        completedAt: resolveCompletionDate({
          enrollmentCompletedAt: opts.enrollment.completed_at,
          certificateIssuedAt: cert?.issued_at,
          lessonCompletedAt: s.completedAt,
        }),
      }]
    : [];
  const earned = earnedCertificatesNotCurrentlyCompleted(
    opts.certificates,
    completedNow.map((c) => c.courseId),
    [opts.enrollment],
  );
  const list = [...completedNow, ...earned.map((e) => ({ courseId: e.courseId, courseTitle: e.courseTitle, completedAt: e.completedAt }))];
  return { courseCompleted: s.isCompleted, list, count: list.length, earned };
}

describe("certificate stays visible when lessons are added", () => {
  const enrollment = { course_id: 7, completed_at: FIRST, courses: { title: "Robotics 101" } };
  const certificates = [{ course_id: 7, certificate_number: "CERT-abc", issued_at: ISSUED }];

  test("issued certificate, course complete: listed once with the original date", () => {
    const r = profileCertificateList({ lessons: ["1", "2"], doneLessons: ["1", "2"], enrollment, certificates });
    assert.equal(r.courseCompleted, true);
    assert.equal(r.count, 1);
    assert.deepEqual(r.list[0], { courseId: "7", courseTitle: "Robotics 101", completedAt: FIRST });
    assert.equal(r.earned.length, 0, "not duplicated");
  });

  test("lesson added: course In Progress, certificate still listed and counted with title and original date", () => {
    const r = profileCertificateList({ lessons: ["1", "2", "3"], doneLessons: ["1", "2"], enrollment, certificates });
    assert.equal(r.courseCompleted, false, "current status regressed");
    assert.equal(r.count, 1, "certificate count unchanged");
    assert.deepEqual(r.list[0], { courseId: "7", courseTitle: "Robotics 101", completedAt: FIRST });
    assert.equal(r.earned[0].certificateNumber, "CERT-abc", "same certificate, not re-issued");
    assert.equal(r.earned[0].currentlyCompleted, false);
  });

  test("new lesson completed: course Completed again, still one entry, original date", () => {
    const r = profileCertificateList({ lessons: ["1", "2", "3"], doneLessons: ["1", "2", "3"], enrollment, certificates });
    assert.equal(r.courseCompleted, true);
    assert.equal(r.count, 1);
    assert.equal(r.list[0].completedAt, FIRST);
  });

  test("historical enrollment without completed_at: certificate issue date is used", () => {
    const r = profileCertificateList({
      lessons: ["1", "2"], doneLessons: ["1"],
      enrollment: { ...enrollment, completed_at: null },
      certificates,
    });
    assert.equal(r.list[0].completedAt, ISSUED);
  });

  test("certificate without a known enrollment row keeps a readable fallback title", () => {
    const e = earnedCertificatesNotCurrentlyCompleted([{ course_id: 9, certificate_number: "C9", issued_at: ISSUED }], [], []);
    assert.deepEqual(e.map((x) => [x.courseTitle, x.completedAt]), [["Course #9", ISSUED]]);
  });

  test("helper is pure: no entries for completed courses, one per course", () => {
    const certs = [
      { course_id: 1, certificate_number: "A", issued_at: ISSUED },
      { course_id: 1, certificate_number: "A", issued_at: ISSUED },
      { course_id: 2, certificate_number: "B", issued_at: ISSUED },
    ];
    const frozen = JSON.stringify(certs);
    const e = earnedCertificatesNotCurrentlyCompleted(certs, ["2"], []);
    assert.deepEqual(e.map((x) => x.courseId), ["1"]);
    assert.equal(JSON.stringify(certs), frozen);
  });
});

describe("screens: certificate visibility is separate from current status", () => {
  test("Profile merges earned certificates into the list it renders and counts", () => {
    const src = strip(read("app/(tabs)/profile.tsx"));
    assert.match(src, /earnedCertificatesNotCurrentlyCompleted\(\s*certificates,\s*results\.map\(\(r\) => r\.courseId\),/);
    assert.match(src, /for \(const e of earned\) \{\s*results\.push\(/);
    assert.match(src, /setCompletedCourses\(results\)/);
    assert.match(src, /\{completedCourses\.length\}<\/Text>\s*\)\}\s*<Text style=\{styles\.statLabel\}>Certificates/);
  });

  test("Achievements uses the same helper (real title + date, no 'Course #id' / null date)", () => {
    const src = strip(read("app/achievements.tsx"));
    assert.match(src, /setEarnedCertificates\(\s*earnedCertificatesNotCurrentlyCompleted\(/);
    assert.doesNotMatch(src, /courseTitle: `Course #\$\{certificate\.course_id\}`/);
    assert.doesNotMatch(src, /completedAt: null,\s*certificateNumber/);
  });

  test("neither screen issues, deletes or re-issues certificates", () => {
    for (const f of ["app/(tabs)/profile.tsx", "app/achievements.tsx"]) {
      const src = strip(read(f));
      assert.doesNotMatch(src, /issueCertificate\(|method: 'DELETE'|\/certificates\/me', \{\s*method: 'POST'/, f);
    }
  });
});

describe("cache upgrade drops old completion status", () => {
  const entry = (version: number) =>
    JSON.stringify({
      version,
      updatedAt: "2026-11-01T00:00:00.000Z",
      data: { enrolledCourses: [{ courseId: "7", progress: 100, completedAt: FIRST, isCompleted: true }] },
    });

  test("CACHE_VERSION is 3", () => assert.equal(CACHE_VERSION, 3));

  test("an entry written by an older build (version 2) is discarded, never used", () => {
    assert.deepEqual(decodeCachePayload(entry(2)), { payload: null, discard: true });
    assert.deepEqual(decodeCachePayload(entry(1)), { payload: null, discard: true });
  });

  test("current-version entries are used; corrupt ones discarded; missing ones ignored", () => {
    const ok = decodeCachePayload<any>(entry(3));
    assert.equal(ok.discard, false);
    assert.equal(ok.payload?.data.enrolledCourses[0].courseId, "7");
    assert.deepEqual(decodeCachePayload("{not json"), { payload: null, discard: true });
    assert.deepEqual(decodeCachePayload("null"), { payload: null, discard: true });
    assert.deepEqual(decodeCachePayload(null), { payload: null, discard: false });
  });

  test("cacheManager reads through decodeCachePayload and removes discarded entries", () => {
    const src = strip(read("services/cacheManager.ts"));
    assert.match(src, /const \{ payload, discard \} = decodeCachePayload<T>\(raw\);\s*if \(discard\) \{\s*await AsyncStorage\.removeItem\(key\)/);
  });
});
