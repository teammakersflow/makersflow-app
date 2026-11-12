// 2026-11-11 integration: mobile <-> NestJS B-2 entitlement alignment.
// Run: node --test artifacts/mobile/tests/*.test.ts   (Node >= 23.6)
//
// enrollmentService.ts imports the API client through the "@/" alias, which
// node:test cannot resolve, so its wiring is checked statically here; the
// decision logic it uses (hasActiveAccess) is unit-tested in
// c5_consumption_only.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasActiveAccess, PAID_ACCESS_STATUSES } from "../lib/courseAccess.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("same allow-list as the backend", () => {
  test("statuses match NestJS ACCESS_PAYMENT_STATUSES", () => {
    assert.deepEqual([...PAID_ACCESS_STATUSES].sort(), ["completed", "free", "paid"]);
  });

  test("My Courses filter: only active rows survive", () => {
    const rows = [
      { course_id: 1, payment_status: "completed", courses: { is_free: false } },
      { course_id: 2, payment_status: "completed", expires_at: "2026-01-01", courses: { is_free: false } },
      { course_id: 3, payment_status: "pending", courses: { is_free: true } },
      { course_id: 4, payment_status: "refunded", courses: { is_free: false } },
      { course_id: 5, payment_status: "FREE", courses: { is_free: true } },
      { course_id: 6, payment_status: "processing", courses: { is_free: false } },
    ];
    const active = rows.filter((r) => hasActiveAccess(r, r.courses, NOW)).map((r) => r.course_id);
    assert.deepEqual(active, [1, 5]);
  });
});

describe("enrollmentService wiring (static)", () => {
  const src = read("services/enrollmentService.ts");

  test("no deny-list and no free-course shortcut remain", () => {
    assert.doesNotMatch(src, /REJECTED_PAYMENT_STATES/);
    assert.doesNotMatch(src, /status == null\) return true/);
    assert.doesNotMatch(src, /courses\.is_free === true\) return true/);
  });

  test("fetchEnrolledCourses filters with hasActiveAccess; getEnrollment sees all rows", () => {
    assert.match(src, /export async function fetchEnrolledCourses[\s\S]*?hasActiveAccess\(enr, enr\.courses\)/);
    assert.match(src, /export async function getEnrollment[\s\S]*?fetchAllMyEnrollments\(\)/);
    assert.match(src, /export async function isEnrolled[\s\S]*?hasActiveAccess\(match, match\?\.courses\)/);
  });
});

describe("screens (static)", () => {
  test("course page: enrolled means active access; re-enrollment reloads the row", () => {
    const src = read("app/course/[id].tsx");
    assert.match(src, /const enrolledStatus = hasActiveAccess\(enrollmentData, enrollmentData\?\.courses\)/);
    assert.match(src, /setEnrollment\(await getEnrollment\(user\.id, course\.id\)/);
    assert.match(src, /Enrollment Not Renewed/);
  });

  test("learn screen offers free (re-)enrollment instead of a dead end", () => {
    const src = read("app/course/learn.tsx");
    assert.match(src, /Re-enroll for Free/);
    assert.match(src, /Enroll for Free/);
  });

  test("notification delete uses the student-scoped route", () => {
    const src = read("services/notificationService.ts");
    assert.match(src, /\/notifications\/my\/\$\{encodeURIComponent\(notificationId\)\}/);
    assert.doesNotMatch(src, /apiClient\.delete<any>\(`\/notifications\/\$\{notificationId\}`\)/);
  });
});
