/**
 * Earned certificates are kept separate from CURRENT course status
 * (2026-11-13). If an admin adds lessons after a learner completed a course,
 * the course is In Progress again, but the certificate the learner already
 * earned still exists on the backend (never revoked, deleted or re-issued) and
 * must stay visible with its original date.
 *
 * Given the issued certificates and the courses that are complete NOW, this
 * returns entries for certificates whose course is not complete now, with the
 * real course title and the first-completion date.
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export interface CertificateRecord {
  course_id: number | string;
  certificate_number?: string | null;
  issued_at?: string | null;
}

export interface EnrollmentRecord {
  course_id?: number | string | null;
  completed_at?: string | null;
  courses?: { id?: number | string | null; title?: string | null; level?: string | null } | null;
}

export interface EarnedCertificateEntry {
  courseId: string;
  courseTitle: string;
  /** First-completion date: enrollments.completed_at, else certificate issued_at. */
  completedAt: string | null;
  certificateNumber?: string;
  level?: string;
  /** The course is not complete right now (e.g. lessons were added). */
  currentlyCompleted: false;
}

const courseIdOf = (e: EnrollmentRecord) => String(e.course_id ?? e.courses?.id ?? "");

export function earnedCertificatesNotCurrentlyCompleted(
  certificates: CertificateRecord[] | null | undefined,
  currentlyCompletedCourseIds: Iterable<string>,
  enrollments: EnrollmentRecord[] | null | undefined,
): EarnedCertificateEntry[] {
  const completedNow = new Set(Array.from(currentlyCompletedCourseIds, String));
  const byCourse = new Map<string, EnrollmentRecord>();
  for (const e of enrollments ?? []) {
    const id = courseIdOf(e);
    if (id) byCourse.set(id, e);
  }
  const seen = new Set<string>();
  const out: EarnedCertificateEntry[] = [];
  for (const cert of certificates ?? []) {
    const courseId = String(cert?.course_id ?? "");
    if (!courseId || completedNow.has(courseId) || seen.has(courseId)) continue;
    seen.add(courseId);
    const enrollment = byCourse.get(courseId);
    out.push({
      courseId,
      courseTitle: enrollment?.courses?.title || `Course #${courseId}`,
      // Same order as resolveCompletionDate (lib/courseCompletion.ts): the
      // stamped first-completion date, else the certificate issue date.
      completedAt: enrollment?.completed_at || cert.issued_at || null,
      certificateNumber: cert.certificate_number ?? undefined,
      level: enrollment?.courses?.level ?? undefined,
      currentlyCompleted: false,
    });
  }
  return out;
}
