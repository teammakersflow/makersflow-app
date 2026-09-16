import { apiRequest } from '@/lib/auth/apiClient';

export interface Certificate {
  id: string;
  user_id: string;
  course_id: number;
  certificate_number: string;
  issued_at: string;
  created_at: string;
}

/**
 * Self-issues a certificate for the authenticated student for a completed course via NestJS POST /certificates/me.
 * Backend verifies active enrollment and 100% lesson completion.
 */
export async function issueCertificate(courseId: number | string): Promise<Certificate | null> {
  const numericCourseId = Number(courseId);
  if (isNaN(numericCourseId)) return null;

  try {
    const res = await apiRequest<any>('/certificates/me', {
      method: 'POST',
      body: JSON.stringify({ course_id: numericCourseId }),
    });
    return res?.data ?? res;
  } catch (err: any) {
    // 409 Conflict means already issued on backend, retrieve existing
    if (err?.status === 409 || err?.statusCode === 409) {
      const list = await fetchMyCertificates();
      return list.find((c) => Number(c.course_id) === numericCourseId) ?? null;
    }
    console.warn('[certificateService] issueCertificate error:', err?.message || err);
    return null;
  }
}

/**
 * Fetches all issued certificates for the authenticated student via NestJS GET /certificates/me.
 */
export async function fetchMyCertificates(): Promise<Certificate[]> {
  try {
    const res = await apiRequest<any>('/certificates/me');
    const data = res?.data ?? (Array.isArray(res) ? res : []);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[certificateService] fetchMyCertificates error:', err);
    return [];
  }
}
