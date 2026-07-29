import { supabase } from '@/lib/supabase';

async function invalidateCaches() {
  try {
    const { homeRepository } = require('@/repositories/homeRepository');
    const { coursesRepository } = require('@/repositories/coursesRepository');
    await Promise.all([
      homeRepository.invalidateProgressCache().catch(() => {}),
      coursesRepository.invalidateEnrollmentsCache().catch(() => {}),
    ]);
  } catch (e) {
    // non-fatal
  }
}

export async function enrollInCourse(userId: string, courseId: string | number, isFree: boolean) {
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const doUpsert = (paymentStatus: string) =>
    supabase.from('enrollments').upsert(
      {
        user_id: userId,
        course_id: Number(courseId),
        payment_status: paymentStatus,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'user_id,course_id' },
    );

  const { error } = await doUpsert(isFree ? 'completed' : 'pending');
  if (!error) {
    await invalidateCaches();
    return;
  }

  if (error.code === '23514' && isFree) {
    const { error: retryError } = await doUpsert('paid');
    if (!retryError) {
      await invalidateCaches();
      return;
    }
    const { error: retryError2 } = await doUpsert('free');
    if (!retryError2) {
      await invalidateCaches();
      return;
    }
    throw retryError2;
  }
  throw error;
}

export async function fetchEnrolledCourses(userId: string) {
  const { data, error } = await supabase
    .from('enrollments')
    .select(
      'course_id, enrolled_at, completed_at, payment_status, expires_at, courses(id, title, category, level, thumbnail_url, is_free, price, slug)',
    )
    .eq('user_id', userId);
  if (error) throw error;

  // BUG FIX (enrollments not visible):
  // 1. When an admin deletes or unpublishes a course, the `courses(...)` join
  //    comes back as null. The screens did `enr.courses.id` which threw inside
  //    Promise.all, rejecting the WHOLE list — so My Courses / Home showed
  //    nothing (including freshly added enrollments). Drop those rows here.
  // 2. Paid enrollments stuck at payment_status 'pending'/'failed' (payment
  //    never completed) must not appear as enrolled courses. Legacy rows with
  //    a null payment_status are kept for backwards compatibility.
  // 3. Fix enrolled count bug: only count enrollments where payment_status is completed/free or the course is free.
  // ── FIX ──────────────────────────────────────────────────────────────────
  // Point 2 above says legacy rows with a NULL payment_status are kept for
  // backwards compatibility, but the code did not actually do that:
  // ['completed','free'].includes(null) is false, so any paid enrolment whose
  // payment_status was never written was silently dropped. That is why the app
  // reported 1 enrolled course while the web app reported 2 for the same user.
  // Only genuinely unpaid states ('pending' / 'failed') should be excluded.
  const REJECTED_PAYMENT_STATES = ['pending', 'failed', 'cancelled', 'refunded'];

  return (data ?? []).filter((enr: any) => {
    if (!enr.courses) return false;                 // course deleted/unpublished
    if (enr.courses.is_free === true) return true;  // free course — always visible
    const status = enr.payment_status;
    if (status == null) return true;                // legacy row — keep (see above)
    return !REJECTED_PAYMENT_STATES.includes(status);
  });
}

export async function isEnrolled(userId: string, courseId: string | number): Promise<boolean> {
  const { data } = await supabase
    .from('enrollments')
    .select('id, payment_status, courses(is_free)')
    .eq('user_id', userId)
    .eq('course_id', Number(courseId))
    .maybeSingle();
  // BUG FIX: a 'pending'/'failed' (unpaid) enrollment row must not unlock the
  // course — previously any row at all counted as enrolled.
  if (!data) return false;
  return (
    ['completed', 'free'].includes(data.payment_status) ||
    (data.courses as any)?.is_free === true
  );
}

export async function getEnrollment(userId: string, courseId: string | number) {
  const { data, error } = await supabase
    .from('enrollments')
    .select('id, user_id, course_id, enrolled_at, completed_at, payment_status, expires_at')
    .eq('user_id', userId)
    .eq('course_id', Number(courseId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isExpired(enrollment: any): boolean {
  if (!enrollment || !enrollment.expires_at) return false;
  const expiryDate = new Date(enrollment.expires_at);
  return expiryDate.getTime() < Date.now();
}

export async function completeCourse(userId: string, courseId: string | number) {
  const now = new Date().toISOString();
  const cId = Number(courseId);

  try {
    // 1. Try updating existing enrollment row
    const { data, error } = await supabase
      .from('enrollments')
      .update({ completed_at: now })
      .eq('user_id', userId)
      .eq('course_id', cId)
      .select();

    // 2. If no existing row was updated, insert new completed enrollment
    if (!error && (!data || data.length === 0)) {
      await supabase
        .from('enrollments')
        .insert({
          user_id: userId,
          course_id: cId,
          completed_at: now,
          payment_status: 'completed',
        });
    }
  } catch (err) {
    console.warn('[EnrollmentService] completeCourse error:', err);
  }

  // Clear repository caches so UI updates reactively across all screens
  try {
    const { invalidateProgressCache } = require('@/repositories/homeRepository');
    const { invalidateEnrollmentsCache } = require('@/repositories/coursesRepository');
    invalidateProgressCache();
    invalidateEnrollmentsCache();
  } catch (e) {
    // Ignore require cycle fallback
  }
}
