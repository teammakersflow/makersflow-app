/**
 * Course access and CTA decisions (fixes C-5 and L-21). Pure and unit-tested.
 *
 * The backend remains the authority: lessons and signed video URLs are served
 * only to entitled users. These helpers decide only what the UI offers, and they
 * never offer a purchase for a digital course while
 * DIGITAL_COURSE_PURCHASES_IN_APP is false.
 */

export const PAID_ACCESS_STATUSES = ["completed", "paid", "free"] as const;

/**
 * Owner decision 2026-11-12: the one-year `expires_at` is NOT enforced yet.
 * Same switch as the backend (enrollments/enrollment-access.ts
 * ENROLLMENT_EXPIRY_ENFORCED). While false, an expired enrollment with an
 * allowed payment_status keeps access, and the app never shows "access
 * expired". Turn both on together, with a renewal/notification plan.
 */
export const ENFORCE_ENROLLMENT_EXPIRY = false as boolean;

export interface AccessOptions {
  /** Defaults to ENFORCE_ENROLLMENT_EXPIRY. */
  enforceExpiry?: boolean;
}
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

/**
 * Pure date check: expires_at is set and not after now (expired AT the
 * instant, like the backend's `expires_at > now` rule). Not an access decision.
 */
export function isEnrollmentExpired(enrollment: EnrollmentLike | null | undefined, nowMs: number = Date.now()): boolean {
  if (!enrollment?.expires_at) return false;
  const t = new Date(enrollment.expires_at).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

/** True only when expiry is enforced AND the enrollment has expired. */
export function expiryBlocksAccess(
  enrollment: EnrollmentLike | null | undefined,
  nowMs: number = Date.now(),
  { enforceExpiry = ENFORCE_ENROLLMENT_EXPIRY }: AccessOptions = {},
): boolean {
  return enforceExpiry && isEnrollmentExpired(enrollment, nowMs);
}

/**
 * True when the enrollment grants access right now (explicit allow-list).
 *
 * Mirrors the NestJS rule (backend B-2, enrollments/enrollment-access.ts):
 * payment_status in completed/paid/free (case-insensitive), for FREE courses
 * too; expiry only when ENFORCE_ENROLLMENT_EXPIRY is on (it is off). A free
 * course with a pending/failed row is not accessible until the student
 * re-enrolls (POST /enrollments/free renews it).
 * `course` is kept in the signature for existing callers.
 */
export function hasActiveAccess(
  enrollment: EnrollmentLike | null | undefined,
  _course?: CourseLike | null | undefined,
  nowMs: number = Date.now(),
  options: AccessOptions = {},
): boolean {
  if (!enrollment) return false;
  const status = String(enrollment.status ?? "").toLowerCase();
  if (status && REVOKED_STATUSES.includes(status)) return false;
  if (expiryBlocksAccess(enrollment, nowMs, options)) return false;

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
  enforceExpiry?: boolean;
}): CourseCta {
  const now = input.nowMs ?? Date.now();
  const options: AccessOptions = input.enforceExpiry === undefined ? {} : { enforceExpiry: input.enforceExpiry };
  const free = isFreeCourse(input.course);
  if (!input.signedIn) return free ? { kind: "enroll_free" } : { kind: "sign_in" };
  if (!input.enrollmentKnown) return input.enrollmentCheckFailed ? { kind: "verify_failed" } : { kind: "checking" };
  if (hasActiveAccess(input.enrollment, input.course, now, options)) return { kind: "continue" };
  // Free course without active access (none, pending, failed; expired when
  // enforced): (re-)enroll for free. The backend renews an inactive free enrollment.
  if (free) return { kind: "enroll_free" };
  if (input.enrollment && expiryBlocksAccess(input.enrollment, now, options)) return { kind: "expired" };
  return { kind: "not_owned" };
}

/**
 * Price label for course cards. Paid digital courses show a neutral label and
 * never an amount, because amounts plus availability would invite purchase outside Play.
 */
export function coursePriceLabel(course: CourseLike | null | undefined): "Free" | "Premium" {
  return isFreeCourse(course) ? "Free" : "Premium";
}
