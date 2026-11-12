/**
 * Commerce policy switches (fix C-5, 2026-11-10).
 *
 * Release 1.0.x is a CONSUMPTION-ONLY app for digital courses (owner decision:
 * "Option C — website-only purchases"):
 *   - No in-app purchase, renewal or checkout of digital courses.
 *   - No prices of paid digital courses, and no buttons, links or wording that
 *     direct users to buy outside the app (Google Play Payments policy,
 *     anti-steering).
 *   - Courses bought on the MakersFlow website unlock after sign-in. Access is
 *     verified by the backend (/enrollments/my, /lessons/:id/video).
 *   - Physical products in the store keep the Razorpay checkout. That is
 *     allowed for physical goods.
 *
 * A future release may add Google Play Billing or User Choice Billing (see
 * _repair/C5_PAYMENT_STRATEGY.md). Do NOT simply flip this flag to true: that
 * would re-enable the Razorpay course flow, which is not Play-compliant.
 */
export const DIGITAL_COURSE_PURCHASES_IN_APP = false as const;

/** Product kinds that may be sold through the in-app (Razorpay) store. */
export function isPhysicalStoreProduct(p: { is_course?: unknown; isCourse?: unknown; course_id?: unknown; courseId?: unknown; type?: unknown; category?: unknown } | null | undefined): boolean {
  if (!p) return false;
  if (p.is_course === true || p.isCourse === true) return false;
  if (p.course_id !== null && p.course_id !== undefined && p.course_id !== "") return false;
  if (p.courseId !== null && p.courseId !== undefined && p.courseId !== "") return false;
  const t = String(p.type ?? "").toLowerCase();
  if (t === "course" || t === "digital" || t === "subscription") return false;
  // Store "digital" items (courses, notes, premium resources) are digital goods
  // under Play policy and cannot be sold through Razorpay in the app.
  if (String(p.category ?? "").toLowerCase() === "digital") return false;
  return true;
}
