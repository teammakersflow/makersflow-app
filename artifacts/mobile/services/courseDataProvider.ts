import { apiClient } from '@/lib/auth/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheManager } from '@/services/cacheManager';

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

    // M-23: remember public course metadata for offline use.
    cacheManager.write(`course_meta:${courseId}`, raw).catch(() => false);
    return mapCourse(raw);
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }
    const cachedRaw = await cacheManager.read<any>(`course_meta:${courseId}`, Number.MAX_SAFE_INTEGER).catch(() => null);
    if (cachedRaw?.id) return mapCourse(cachedRaw);
    console.error(`[courseDataProvider] Error fetching course ${courseId}:`, error);
    throw error;
  }
}

function mapCourse(raw: any) {
  {
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
  }
}

export async function getCourseModules(courseId: string | number): Promise<CourseModuleItem[]> {
  if (!courseId || String(courseId) === 'undefined' || String(courseId) === 'null') {
    return [];
  }

  // M-23 (2026-11-10): network failures no longer turn into an empty course.
  // The last good structure is cached per user + course and used offline. If
  // there is no cached copy, the error is thrown so screens can show an offline state.
  const settled = await Promise.allSettled([
    apiClient.get<any>('/modules'),
    apiClient.get<any>('/lessons'),
  ]);
  if (settled.some((r) => r.status === 'rejected')) {
    const cached = await readCourseStructure(courseId);
    if (cached) return cached;
    const err = (settled.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    console.warn(`[courseDataProvider] Course structure unavailable for ${courseId}:`, err?.message ?? err);
    throw err;
  }

  try {
    const [modulesResponse, lessonsResponse] = settled.map((r) => (r as PromiseFulfilledResult<any>).value);

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

    const structure: CourseModuleItem[] = courseModules.map((m: any) => {
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
    writeCourseStructure(courseId, structure).catch(() => {});
    return structure;
  } catch (error) {
    console.error(`[courseDataProvider] Error fetching modules for course ${courseId}:`, error);
    return [];
  }
}

// ── M-23: per-user course-structure cache ───────────────────────────────────
// Stored under "course_structure:<courseId>::<userId>". Raw video URLs are never
// cached: they are replaced by a marker, because playback and downloads always
// fetch a fresh signed URL. Cleared on logout (clearCourseStructureCache).
export const PROTECTED_VIDEO_MARKER = '__protected__';
const STRUCTURE_PREFIX = 'course_structure:';

function structureKey(courseId: string | number): string | null {
  const owner = cacheManager.userScope().owner;
  return owner ? `${STRUCTURE_PREFIX}${courseId}::${owner}` : null;
}

export function toCacheableStructure(structure: CourseModuleItem[]): CourseModuleItem[] {
  return structure.map((m) => ({
    ...m,
    lessons: m.lessons.map((l) => ({ ...l, video_url: l.video_url ? PROTECTED_VIDEO_MARKER : '' })),
  }));
}

async function writeCourseStructure(courseId: string | number, structure: CourseModuleItem[]) {
  const key = structureKey(courseId);
  if (!key) return;
  await AsyncStorage.setItem(key, JSON.stringify({ v: 1, at: Date.now(), data: toCacheableStructure(structure) }));
}

async function readCourseStructure(courseId: string | number): Promise<CourseModuleItem[] | null> {
  const key = structureKey(courseId);
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.v === 1 && Array.isArray(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearCourseStructureCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(STRUCTURE_PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    // best effort
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
