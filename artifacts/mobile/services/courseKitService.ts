import { getApiBaseUrl } from "@/lib/auth/apiClient";
import { parseCourseKitPayload, type CourseKitResponse } from "@/lib/courseKit";

export type { CourseKit, CourseKitItem, CourseKitResponse } from "@/lib/courseKit";

/**
 * GET /kits/course/:courseId (public). Returns null when the course has no
 * kit, or on any network/API error, so the course screen looks exactly as it
 * does without a kit. Parsing rules: lib/courseKit.ts.
 */
export async function fetchCourseKit(
  courseId: string
): Promise<CourseKitResponse | null> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/kits/course/${encodeURIComponent(courseId)}`,
      { method: "GET" }
    );

    if (!response.ok) return null;

    return parseCourseKitPayload(await response.json());
  } catch {
    // Kit information is optional; never interrupt course loading.
    return null;
  }
}
