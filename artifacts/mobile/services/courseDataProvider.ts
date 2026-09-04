import { apiClient } from '@/lib/auth/apiClient';

export interface CourseModuleItem {
  id: string;
  title: string;
  position: number;
  lessons: {
    id: string;
    title: string;
    video_url: string;
    duration_minutes: number | null;
    position: number;
    content?: string;
    notes?: string[];
  }[];
}

export async function getCourseById(courseId: string | number) {
  if (!courseId || String(courseId) === 'undefined' || String(courseId) === 'null') {
    return null;
  }

  try {
    const response = await apiClient.get<any>(`/courses/${courseId}`);
    const raw = response?.data !== undefined && response?.success !== undefined ? response.data : response;

    if (!raw || typeof raw !== 'object' || !raw.id) {
      return null;
    }

    return {
      id: String(raw.id),
      title: raw.title || 'Untitled Course',
      slug: raw.slug || '',
      category: raw.category || 'General',
      level: raw.level || 'Beginner',
      price: Number(raw.price) || 0,
      is_free: Boolean(raw.is_free),
      thumbnail_url: raw.thumbnail_url || null,
      description: raw.description || '',
      images: raw.images || [],
      is_published: raw.is_published !== undefined ? Boolean(raw.is_published) : true,
    };
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }
    console.error(`[courseDataProvider] Error fetching course ${courseId}:`, error);
    throw error;
  }
}

export async function getCourseModules(courseId: string | number): Promise<CourseModuleItem[]> {
  if (!courseId || String(courseId) === 'undefined' || String(courseId) === 'null') {
    return [];
  }

  try {
    const [modulesResponse, lessonsResponse] = await Promise.all([
      apiClient.get<any>('/modules').catch(() => []),
      apiClient.get<any>('/lessons').catch(() => []),
    ]);

    const rawModules = Array.isArray(modulesResponse)
      ? modulesResponse
      : (Array.isArray(modulesResponse?.data) ? modulesResponse.data : []);

    const rawLessons = Array.isArray(lessonsResponse)
      ? lessonsResponse
      : (Array.isArray(lessonsResponse?.data) ? lessonsResponse.data : []);

    const courseModules = rawModules
      .filter((m: any) => Number(m.course_id) === Number(courseId))
      .sort((a: any, b: any) => (a.order_index ?? a.order ?? 0) - (b.order_index ?? b.order ?? 0));

    if (courseModules.length === 0) return [];

    return courseModules.map((m: any) => {
      const moduleLessons = rawLessons
        .filter((l: any) => Number(l.module_id) === Number(m.id))
        .sort((a: any, b: any) => (a.order_index ?? a.order ?? 0) - (b.order_index ?? b.order ?? 0));

      return {
        id: String(m.id),
        title: m.title || 'Untitled Module',
        position: m.order_index ?? m.order ?? 0,
        lessons: moduleLessons.map((l: any) => ({
          id: String(l.id),
          title: l.title || 'Untitled Lesson',
          video_url: l.video_url || '',
          duration_minutes: l.duration_secs ? Math.round(Number(l.duration_secs) / 60) : null,
          position: l.order_index ?? l.order ?? 0,
          content: l.content || '',
          notes: Array.isArray(l.notes) ? l.notes : (l.notes ? [String(l.notes)] : []),
        })),
      };
    });
  } catch (error) {
    console.error(`[courseDataProvider] Error fetching modules for course ${courseId}:`, error);
    return [];
  }
}

export async function fetchAllCourses() {
  try {
    const response = await apiClient.get<any>('/courses');
    const rawList = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    if (!rawList || rawList.length === 0) return [];

    return rawList
      .filter((c: any) => c.is_published !== false)
      .map((c: any) => ({
        id: String(c.id),
        title: c.title || 'Untitled Course',
        category: c.category || 'General',
        level: c.level ? (c.level.charAt(0).toUpperCase() + c.level.slice(1)) : 'Beginner',
        price: Number(c.price) || 0,
        is_free: Boolean(c.is_free),
        thumbnail_url: c.thumbnail_url || null,
        slug: c.slug || '',
        description: c.description || '',
        instructor: 'MakersFlow Instructor',
        profiles: { full_name: 'MakersFlow Instructor' },
        images: c.images || [],
        created_at: c.created_at,
      }));
  } catch (error) {
    console.error('[courseDataProvider] Error fetching all courses:', error);
    throw error;
  }
}

export async function fetchLessonDurations(lessonIds: (string | number)[]): Promise<Map<number, number>> {
  const durationMap = new Map<number, number>();
  if (!lessonIds || lessonIds.length === 0) return durationMap;

  try {
    const response = await apiClient.get<any>('/lessons');
    const rawLessons = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    const targetSet = new Set(lessonIds.map(Number));
    for (const l of rawLessons) {
      const lid = Number(l.id);
      if (targetSet.has(lid)) {
        durationMap.set(lid, Number(l.duration_secs) || 0);
      }
    }
  } catch (error) {
    console.warn('[courseDataProvider] Error fetching lesson durations:', error);
  }

  return durationMap;
}

export const courseDataProvider = {
  getCourseById,
  getCourseModules,
  fetchAllCourses,
  fetchLessonDurations,
};
