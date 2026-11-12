/**
 * Course access and CTA decisions (fixes C-5 and L-21). Pure and unit-tested.
 *
 * The backend remains the authority: lessons and signed video URLs are served
 * only to entitled users. These helpers decide only what the UI offers, and they
 * never offer a purchase for a digital course while
 * DIGITAL_COURSE_PURCHASES_IN_APP is false.
 */

export const PAID_ACCESS_STATUSES = ["completed", "paid", "free"] as const;
const REVOKED_STATUSES = ["cancelled", "canceled", "revoked", "suspended", "refunded", "inactive", "expired"];

export interface CourseLike { isFree?: boolean | null; is_free?: boolean | null; price?: number | string | null }
export interface EnrollmentLike {
  payment_status?: string | null;
  status?: string | null;
  expires_at?: string | null;
  courses?: { is_free?: boolean | null } | null;
}

export function isFreeCourse(course: CourseLike | null | undefined): boolean {
  if (!course) return false;
  if (course.isFree === true || course.is_free === true) return true;
  const price = Number(course.price);
  return Number.isFinite(price) && price <= 0 && course.isFree !== false && course.is_free !== false;
}

export function isEnrollmentExpired(enrollment: EnrollmentLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!enrollment?.expires_at) return false;
  const t = new Date(enrollment.expires_at).getTime();
  return Number.isFinite(t) && t < nowMs;
}

/**
 * True when the enrollment grants access right now (explicit allow-list).
 *
 * Mirrors the NestJS rule (backend B-2, enrollments/enrollment-access.ts):
 * payment_status in completed/paid/free (case-insensitive) AND not expired,
 * for FREE courses too. A free course with a pending/failed/expired row is not
 * accessible until the student re-enrolls (POST /enrollments/free renews it).
 * `course` is kept in the signature for existing callers.
 */
export function hasActiveAccess(
  enrollment: EnrollmentLike | null | undefined,
  _course?: CourseLike | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!enrollment) return false;
  const status = String(enrollment.status ?? "").toLowerCase();
  if (status && REVOKED_STATUSES.includes(status)) return false;
  if (isEnrollmentExpired(enrollment, nowMs)) return false;

  const pay = String(enrollment.payment_status ?? "").toLowerCase();
  return (PAID_ACCESS_STATUSES as readonly string[]).includes(pay);
}

export type CourseCta =
  | { kind: "checking" }
  | { kind: "verify_failed" }
  | { kind: "continue" }
  | { kind: "expired" }                 // had access; it has lapsed. No in-app renewal
  | { kind: "enroll_free" }
  | { kind: "sign_in" }                 // signed out: sign in to see owned courses
  | { kind: "not_owned" };              // paid course, no access. Informational only

export function decideCourseCta(input: {
  signedIn: boolean;
  enrollmentKnown: boolean;
  enrollmentCheckFailed: boolean;
  enrollment: EnrollmentLike | null | undefined;
  course: CourseLike;
  nowMs?: number;
}): CourseCta {
  const now = input.nowMs ?? Date.now();
  const free = isFreeCourse(input.course);
  if (!input.signedIn) return free ? { kind: "enroll_free" } : { kind: "sign_in" };
  if (!input.enrollmentKnown) return input.enrollmentCheckFailed ? { kind: "verify_failed" } : { kind: "checking" };
  if (hasActiveAccess(input.enrollment, input.course, now)) return { kind: "continue" };
  // Free course without active access (none, pending, failed, expired):
  // (re-)enroll for free. The backend renews an inactive free enrollment.
  if (free) return { kind: "enroll_free" };
  if (input.enrollment && isEnrollmentExpired(input.enrollment, now)) return { kind: "expired" };
  return { kind: "not_owned" };
}

/**
 * Price label for course cards. Paid digital courses show a neutral label and
 * never an amount, because amounts plus availability would invite purchase outside Play.
 */
export function coursePriceLabel(course: CourseLike | null | undefined): "Free" | "Premium" {
  return isFreeCourse(course) ? "Free" : "Premium";
}
