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
  if (!Number.isFinite(numericCourseId) || numericCourseId <= 0) return null;

  try {
    const existingCertificates = await fetchMyCertificatesStrict();
    const existing = existingCertificates.find(
      (certificate) => Number(certificate.course_id) === numericCourseId
    );

    if (existing) return existing;

    const res = await apiRequest<any>('/certificates/me', {
      method: 'POST',
      body: JSON.stringify({ course_id: numericCourseId }),
    });

    return res?.data ?? res;
  } catch (err: any) {
    if (err?.status === 409 || err?.statusCode === 409) {
      try {
        const certificates = await fetchMyCertificatesStrict();
        return certificates.find(
          (certificate) => Number(certificate.course_id) === numericCourseId
        ) ?? null;
      } catch (fetchError) {
        console.warn('[certificateService] Could not retrieve existing certificate:', fetchError);
        return null;
      }
    }

    console.warn('[certificateService] issueCertificate error:', err?.message || err);
    return null;
  }
}

/**
 * Fetches all issued certificates for the authenticated student via NestJS GET /certificates/me.
 */
export async function fetchMyCertificatesStrict(): Promise<Certificate[]> {
  const res = await apiRequest<any>('/certificates/me');
  const data = Array.isArray(res) ? res : res?.data;
  if (!Array.isArray(data)) {
    throw new Error('Invalid certificate list response.');
  }
  return data;
}
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
