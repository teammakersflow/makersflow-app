/**
 * Shared sources for the course data every learning screen needs
 * (2026-11-13, HTTP 429 fix). Built on lib/sharedRequestCache.ts.
 *
 * - courseProgress(user, course): GET /lesson-progress/my/course/:courseId.
 *   One request per user+course per window, shared by Home, My Learning,
 *   Progress, Course Details, Learn, Profile, Achievements and the progress
 *   context (previously about 7 requests per course at startup).
 * - allModules(owner) / allLessons(owner): GET /modules and GET /lessons.
 *   Both endpoints take no parameters and return the full list, so they are
 *   fetched once per window and filtered per course locally (previously once
 *   per course, per screen). /lessons depends on who is signed in (optional
 *   auth), so both are keyed by the signed-in user.
 * - Responses are validated; malformed ones throw and are never cached.
 * - Switching user clears everything, so one account's data is never served
 *   to another.
 *
 * Pure module (no imports, dependencies injected), so node tests can load it
 * directly. The shared cache lives here too: the app's TypeScript config does
 * not allow `.ts` import specifiers, which node's test runner needs.
 */

/**
 * Shared, short-lived request cache with in-flight de-duplication
 * (2026-11-13, HTTP 429 fix).
 *
 * The production API allows 20 requests per minute per endpoint per client.
 * Home, My Learning, Progress and the progress context used to request the
 * same data independently (about 7 progress calls per course at startup).
 * This cache makes every caller of one key share a single request.
 *
 * - In-flight sharing: concurrent get() calls for a key share one promise.
 * - Fresh window: a successful value is reused for `ttlMs`.
 * - Only successes are cached. Failures (429, 5xx, network, malformed) are
 *   never stored, and they never erase the last good value.
 * - invalidate(): the next get() fetches again. A request that started before
 *   the invalidation still answers its own callers, but its result is not
 *   stored as fresh and new callers do not join it.
 * - Ordering: a result is stored only if no newer request for the key has
 *   already stored one (an older, slower response never replaces a newer one).
 * - Keys are namespaced by the caller (include the user id); clear() drops
 *   everything (account change).
 */

export interface SharedRequestCacheOptions {
  ttlMs: number;
  now?: () => number;
}

interface Entry<T> {
  value?: T;
  /** When `value` was stored; 0 = not fresh (never stored or invalidated). */
  freshAt: number;
  /** Sequence number of the request that produced `value`. */
  valueSeq: number;
  /** Bumped by invalidate(); requests started under an older one never store. */
  generation: number;
  inflight?: { promise: Promise<T>; generation: number };
}

/**
 * - force: skip the fresh value (user-initiated refresh); still joins a
 *   request already running.
 * - freshSince: accept only a value stored at/after this time (epoch ms),
 *   e.g. one fetched earlier in the same user refresh; otherwise behave like
 *   force. Lets the second step of a refresh reuse the first step's result
 *   instead of forcing a duplicate request.
 */
export interface GetOptions {
  force?: boolean;
  freshSince?: number;
}

export interface SharedRequestCache<T> {
  /** Cached value if fresh, otherwise a (shared) request via `load`. */
  get(key: string, load: () => Promise<T>, opts?: GetOptions): Promise<T>;
  /** Last successful value for the key, however old (never a failure). */
  peek(key: string): T | undefined;
  /** Mark one key stale. */
  invalidate(key: string): void;
  /** Mark every key starting with `prefix` stale. */
  invalidatePrefix(prefix: string): void;
  /** Forget everything (sign-out / account change). */
  clear(): void;
}

export function createSharedRequestCache<T>(options: SharedRequestCacheOptions): SharedRequestCache<T> {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry<T>>();
  let seq = 0;

  const entryFor = (key: string): Entry<T> => {
    let e = entries.get(key);
    if (!e) {
      e = { freshAt: 0, valueSeq: 0, generation: 0 };
      entries.set(key, e);
    }
    return e;
  };

  const markStale = (e: Entry<T>) => {
    e.generation += 1;
    e.freshAt = 0;
    e.inflight = undefined; // new callers start a new request
  };

  return {
    get(key, load, opts) {
      const e = entryFor(key);
      if (
        opts?.freshSince !== undefined &&
        e.value !== undefined &&
        e.freshAt > 0 &&
        e.freshAt >= opts.freshSince
      ) {
        return Promise.resolve(e.value);
      }
      const skipFresh = opts?.force === true || opts?.freshSince !== undefined;
      if (!skipFresh && e.value !== undefined && e.freshAt > 0 && now() - e.freshAt < options.ttlMs) {
        return Promise.resolve(e.value);
      }
      // `force` skips the fresh value but still joins a request already
      // running for the current generation (no duplicate network call).
      if (e.inflight && e.inflight.generation === e.generation) {
        return e.inflight.promise;
      }
      const generation = e.generation;
      const mySeq = ++seq;
      const promise = Promise.resolve()
        .then(load)
        .then((value) => {
          const current = entries.get(key);
          if (current && current.generation === generation && mySeq > current.valueSeq) {
            current.value = value;
            current.valueSeq = mySeq;
            current.freshAt = now();
          }
          return value;
        })
        .finally(() => {
          const current = entries.get(key);
          if (current?.inflight?.promise === promise) current.inflight = undefined;
        });
      e.inflight = { promise, generation };
      return promise;
    },
    peek(key) {
      return entries.get(key)?.value;
    },
    invalidate(key) {
      const e = entries.get(key);
      if (e) markStale(e);
    },
    invalidatePrefix(prefix) {
      for (const [key, e] of entries) if (key.startsWith(prefix)) markStale(e);
    },
    clear() {
      entries.clear();
    },
  };
}

// ── Course data sources ──────────────────────────────────────────────────────

export const COURSE_DATA_TTL_MS = 15_000;

export interface CourseRequestSourcesDeps {
  /** GET a path from the API (apiClient.get in the app). */
  /**
   * GET a path from the API (apiClient.get in the app). `forUserId`: the
   * account the data is for; the app refuses to send it with another
   * account's token (review M6).
   */
  getJson: (path: string, forUserId?: string) => Promise<any>;
  ttlMs?: number;
  now?: () => number;
}

export class MalformedResponseError extends Error {
  status = 502;
  kind = "server" as const;
  constructor(what: string) {
    super(`Unexpected response for ${what}`);
    this.name = "MalformedResponseError";
  }
}

const unwrap = (res: any) => (res && typeof res === "object" && "data" in res ? res.data : res);

export function isValidCourseProgressResponse(res: any): boolean {
  const d = unwrap(res);
  return !!d && typeof d === "object" && (Array.isArray(d.lessons) || Array.isArray(d.lessonsProgress) || d.total_lessons !== undefined);
}

export function isValidListResponse(res: any): boolean {
  return Array.isArray(res) || Array.isArray(res?.data);
}

export interface CourseRequestSources {
  courseProgress(userId: string, courseId: string | number, opts?: GetOptions): Promise<any>;
  peekCourseProgress(userId: string, courseId: string | number): any | undefined;
  invalidateCourseProgress(userId: string, courseId?: string | number): void;
  allModules(owner: string | null | undefined, opts?: { force?: boolean }): Promise<any>;
  allLessons(owner: string | null | undefined, opts?: { force?: boolean }): Promise<any>;
  invalidateStructure(): void;
  /** Drop everything (sign-out / account change). */
  clear(): void;
}

export function createCourseRequestSources(deps: CourseRequestSourcesDeps): CourseRequestSources {
  const ttlMs = deps.ttlMs ?? COURSE_DATA_TTL_MS;
  const progress: SharedRequestCache<any> = createSharedRequestCache({ ttlMs, now: deps.now });
  const structure: SharedRequestCache<any> = createSharedRequestCache({ ttlMs, now: deps.now });
  let currentUser: string | null = null;

  // A different signed-in user (or sign-out) must never see the previous data.
  const scopeTo = (userId: string | null | undefined) => {
    const next = userId ? String(userId) : null;
    if (next !== currentUser) {
      progress.clear();
      structure.clear();
      currentUser = next;
    }
  };

  const progressKey = (userId: string, courseId: string | number) => `${userId}|${Number(courseId)}`;

  const fetchValidated = async (path: string, valid: (r: any) => boolean, what: string, forUserId?: string | null) => {
    const res = await deps.getJson(path, forUserId ? String(forUserId) : undefined);
    if (!valid(res)) throw new MalformedResponseError(what);
    return res;
  };

  return {
    courseProgress(userId, courseId, opts) {
      scopeTo(userId);
      const id = Number(courseId);
      return progress.get(
        progressKey(userId, id),
        () => fetchValidated(`/lesson-progress/my/course/${id}`, isValidCourseProgressResponse, "course progress", userId),
        opts,
      );
    },
    peekCourseProgress(userId, courseId) {
      if (String(userId) !== currentUser) return undefined;
      return progress.peek(progressKey(userId, courseId));
    },
    invalidateCourseProgress(userId, courseId) {
      if (courseId === undefined || courseId === null) progress.invalidatePrefix(`${userId}|`);
      else progress.invalidate(progressKey(userId, courseId));
    },
    allModules(owner, opts) {
      scopeTo(owner);
      return structure.get(`${owner ?? "anon"}|modules`, () => fetchValidated("/modules", isValidListResponse, "modules", owner), opts);
    },
    allLessons(owner, opts) {
      scopeTo(owner);
      return structure.get(`${owner ?? "anon"}|lessons`, () => fetchValidated("/lessons", isValidListResponse, "lessons", owner), opts);
    },
    invalidateStructure() {
      structure.clear();
    },
    clear() {
      progress.clear();
      structure.clear();
      currentUser = null;
    },
  };
}
