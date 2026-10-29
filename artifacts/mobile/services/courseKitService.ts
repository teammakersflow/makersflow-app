import { getApiBaseUrl } from "@/lib/auth/apiClient";

export interface CourseKitItem {
  product_id: string;
  title: string;
  slug: string;
  quantity: number;
  price: string | null;
  image: string | null;
  available: boolean;
}

export interface CourseKit {
  id: string;
  name: string;
  description: string | null;
  items: CourseKitItem[];
  all_available: boolean;
}

export interface CourseKitResponse {
  course_id: string;
  kit: CourseKit | null;
  kit_included: boolean;
  kit_purchase_required: boolean;
  label?: string;
}

export async function fetchCourseKit(
  courseId: string
): Promise<CourseKitResponse | null> {
  try {
    const response = await fetch(
      `${getApiBaseUrl()}/kits/course/${encodeURIComponent(courseId)}`,
      { method: "GET" }
    );

    if (!response.ok) return null;

    const payload = await response.json();
    const data = payload?.data;

    if (!payload?.success || !data || !data.kit) return null;

    return data as CourseKitResponse;
  } catch {
    // Kit information is optional; never interrupt course loading.
    return null;
  }
}
