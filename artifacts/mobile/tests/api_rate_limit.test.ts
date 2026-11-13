// HTTP 429 fix (2026-11-13): shared course requests, 429 retry policy, typed
// errors. Production logcat showed "ThrottlerException: Too Many Requests" on
// /lesson-progress/my/course/:courseId (courses 43, 27, 21, 44); the API allows
// 20 requests / 60 s per endpoint per client.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSharedRequestCache,
  createCourseRequestSources,
  MalformedResponseError,
  COURSE_DATA_TTL_MS,
} from "../lib/courseRequestSources.ts";
import {
  runWithRateLimitRetry,
  createRateLimitGate,
  parseRetryAfterMs,
  endpointTemplate,
  isRetryableMethod,
  MAX_AUTO_RETRY_WAIT_MS,
} from "../lib/auth/retryPolicy.ts";
import { classifyApiError, loadErrorMessage } from "../lib/apiErrorKind.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

/** Controllable promise for ordering tests. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const progressBody = (courseId: number, done: number, total = 3) => ({
  success: true,
  data: {
    course_id: String(courseId),
    total_lessons: total,
    completed_lessons: done,
    is_completed: done === total,
    lessons: Array.from({ length: total }, (_, i) => ({
      lesson_id: String(courseId * 100 + i),
      progress: i < done ? { id: String(i + 1), is_completed: true } : null,
    })),
  },
});

/** Fake API: counts calls per path, answers progress/modules/lessons. */
function fakeApi() {
  const calls: string[] = [];
  const getJson = async (p: string) => {
    calls.push(p);
    await Promise.resolve();
    const m = p.match(/^\/lesson-progress\/my\/course\/(\d+)$/);
    if (m) return progressBody(Number(m[1]), 1);
    if (p === "/modules") return { data: [{ id: 1, course_id: 43 }] };
    if (p === "/lessons") return { data: [{ id: 4300, module_id: 1 }] };
    throw new Error(`unexpected ${p}`);
  };
  const count = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;
  return { calls, getJson, count };
}

// ── Shared course progress ───────────────────────────────────────────────────
describe("shared course progress requests", () => {
  test("1. two simultaneous requests for the same course share one API call", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    const [a, b] = await Promise.all([src.courseProgress("u1", 43), src.courseProgress("u1", "43")]);
    assert.equal(api.count("/lesson-progress"), 1);
    assert.equal(a, b);
  });

  test("2. different courses never share progress", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    const [a, b] = await Promise.all([src.courseProgress("u1", 43), src.courseProgress("u1", 27)]);
    assert.equal(api.count("/lesson-progress"), 2);
    assert.equal(a.data.course_id, "43");
    assert.equal(b.data.course_id, "27");
  });

  test("3/4. a success is reused within the window and fetched again after it", async () => {
    let t = 1_000;
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson, now: () => t });
    await src.courseProgress("u1", 43);
    t += COURSE_DATA_TTL_MS - 1;
    await src.courseProgress("u1", 43);
    assert.equal(api.count("/lesson-progress"), 1, "cached inside the window");
    t += 2;
    await src.courseProgress("u1", 43);
    assert.equal(api.count("/lesson-progress"), 2, "expired: fetched again");
  });

  test("5. completing a lesson invalidates that course only", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    await Promise.all([src.courseProgress("u1", 43), src.courseProgress("u1", 27)]);
    src.invalidateCourseProgress("u1", 43);
    await Promise.all([src.courseProgress("u1", 43), src.courseProgress("u1", 27)]);
    assert.deepEqual(api.calls.filter((c) => c.startsWith("/lesson")), [
      "/lesson-progress/my/course/43",
      "/lesson-progress/my/course/27",
      "/lesson-progress/my/course/43",
    ]);
  });

  test("6. switching account never serves another user's data", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    await src.courseProgress("userA", 43);
    assert.ok(src.peekCourseProgress("userA", 43));
    await src.courseProgress("userB", 43);
    assert.equal(api.count("/lesson-progress"), 2, "user B fetched its own progress");
    assert.equal(src.peekCourseProgress("userA", 43), undefined, "user A's cache is gone");
    src.clear();
    assert.equal(src.peekCourseProgress("userB", 43), undefined);
  });

  test("12. a failed request (429/5xx/network) is not cached and keeps the last good value", async () => {
    let t = 0;
    let fail: any = null;
    let calls = 0;
    const src = createCourseRequestSources({
      now: () => t,
      getJson: async (p) => {
        calls++;
        if (fail) throw fail;
        return progressBody(43, 2);
      },
    });
    const good = await src.courseProgress("u1", 43);
    t += COURSE_DATA_TTL_MS + 1;
    for (const err of [{ status: 429 }, { status: 503 }, { status: 0, message: "Network request failed" }]) {
      fail = err;
      await assert.rejects(src.courseProgress("u1", 43), (e: any) => e === err);
      assert.equal(src.peekCourseProgress("u1", 43), good, "last good value preserved");
    }
    fail = null;
    await src.courseProgress("u1", 43);
    assert.equal(calls, 5, "failures were not cached: the next call went to the network");
  });

  test("malformed responses are rejected and never cached as success", async () => {
    let body: any = { data: { unexpected: true } };
    let calls = 0;
    const src = createCourseRequestSources({ getJson: async () => { calls++; return body; } });
    await assert.rejects(src.courseProgress("u1", 43), (e: any) => e instanceof MalformedResponseError && classifyApiError(e) === "server");
    assert.equal(src.peekCourseProgress("u1", 43), undefined);
    body = progressBody(43, 1);
    await src.courseProgress("u1", 43);
    assert.equal(calls, 2);
  });

  test("13. a slow older response can never overwrite a newer result", async () => {
    const cache = createSharedRequestCache<string>({ ttlMs: 60_000 });
    const slow = deferred<string>();
    const first = cache.get("k", () => slow.promise);
    cache.invalidate("k"); // progress changed while the first request was in flight
    const second = await cache.get("k", async () => "new");
    slow.resolve("old");
    assert.equal(await first, "old", "the old request still answers its own caller");
    assert.equal(second, "new");
    assert.equal(cache.peek("k"), "new", "but it does not replace the newer value");
    assert.equal(await cache.get("k", async () => "network"), "new", "and the newer value stays fresh");
  });

  test("13b. a slow older FAILURE cannot erase a newer success", async () => {
    const cache = createSharedRequestCache<string>({ ttlMs: 60_000 });
    const slow = deferred<string>();
    const first = cache.get("k", () => slow.promise);
    cache.invalidate("k");
    await cache.get("k", async () => "fresh");
    slow.reject({ status: 429 });
    await assert.rejects(first);
    assert.equal(cache.peek("k"), "fresh");
  });

  test("force skips the fresh value but still joins an in-flight request", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    await src.courseProgress("u1", 43);
    await Promise.all([src.courseProgress("u1", 43, { force: true }), src.courseProgress("u1", 43, { force: true })]);
    assert.equal(api.count("/lesson-progress"), 2, "one forced request shared by both callers");
  });
});

// ── /modules and /lessons ────────────────────────────────────────────────────
describe("modules and lessons", () => {
  test("8. downloaded once per window for any number of courses, keyed by user", async () => {
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson });
    // getCourseModules for 4 courses on 3 screens at once
    await Promise.all(
      [43, 27, 21, 44, 43, 27, 21, 44, 43, 27, 21, 44].flatMap(() => [src.allModules("u1"), src.allLessons("u1")]),
    );
    assert.equal(api.count("/modules"), 1);
    assert.equal(api.count("/lessons"), 1);
    await src.allLessons("u2");
    assert.equal(api.count("/lessons"), 2, "/lessons depends on the user: another user fetches its own");
  });

  test("the app's getCourseModules and fetchLessonDurations use the shared lists", () => {
    const src = strip(read("services/courseDataProvider.ts"));
    assert.match(src, /courseRequests\.allModules\(owner\),\s*courseRequests\.allLessons\(owner\),/);
    assert.match(src, /courseRequests\.allLessons\(cacheManager\.userScope\(\)\.owner\)/);
    assert.doesNotMatch(src, /apiClient\.get<any>\('\/(modules|lessons)'\)/);
  });
});

// ── Request counts: before vs after ──────────────────────────────────────────
/**
 * Call patterns of the screens, as in the code:
 *  - progress context (fetchRemoteProgress): per course getCourseModules
 *    (/modules + /lessons) + course progress;
 *  - Home (homeRepository.fetchProgress): per course fetchCourseProgress +
 *    fetchCourseLessonsProgress, plus /lessons for durations;
 *  - My Learning (coursesRepository.fetchEnrollments): per course progress;
 *  - Progress tab: per course 2 progress calls, /lessons for durations, and
 *    getCourseModules for courses with completed lessons.
 */
type Api = { progress: (c: number) => Promise<any>; modules: () => Promise<any>; lessons: () => Promise<any> };
const courses = [43, 27, 21, 44];
const contextLoad = (a: Api) => Promise.all(courses.map((c) => Promise.all([a.modules(), a.lessons(), a.progress(c)])));
const homeLoad = (a: Api) => Promise.all([...courses.map((c) => Promise.all([a.progress(c), a.progress(c)])), a.lessons()]);
const myLearningLoad = (a: Api) => Promise.all(courses.map((c) => a.progress(c)));
const progressTabLoad = (a: Api) =>
  Promise.all([...courses.map((c) => Promise.all([a.progress(c), a.progress(c), a.modules(), a.lessons()])), a.lessons()]);

function directApi(getJson: (p: string) => Promise<any>): Api {
  return { progress: (c) => getJson(`/lesson-progress/my/course/${c}`), modules: () => getJson("/modules"), lessons: () => getJson("/lessons") };
}
function sharedApi(getJson: (p: string) => Promise<any>): Api {
  const src = createCourseRequestSources({ getJson });
  return { progress: (c) => src.courseProgress("u1", c), modules: () => src.allModules("u1"), lessons: () => src.allLessons("u1") };
}

describe("7. request counts with 4 enrolled courses (startup + My Learning + Progress)", () => {
  // BEFORE: startup ran the context load, then Home twice (first focus + the
  // sign-in effect), each Home load also re-running the context load.
  async function before() {
    const api = fakeApi();
    const a = directApi(api.getJson);
    await Promise.all([contextLoad(a), contextLoad(a), homeLoad(a), contextLoad(a), homeLoad(a)]);
    const startup = { progress: api.count("/lesson-progress"), modules: api.count("/modules"), lessons: api.count("/lessons") };
    await myLearningLoad(a);
    await progressTabLoad(a);
    return { startup, total: { progress: api.count("/lesson-progress"), modules: api.count("/modules"), lessons: api.count("/lessons") } };
  }
  // AFTER: one Home load (no context reload on the initial load), everything
  // through the shared sources; screens opened within the window.
  async function after() {
    const api = fakeApi();
    const a = sharedApi(api.getJson);
    await Promise.all([contextLoad(a), homeLoad(a)]);
    const startup = { progress: api.count("/lesson-progress"), modules: api.count("/modules"), lessons: api.count("/lessons") };
    await myLearningLoad(a);
    await progressTabLoad(a);
    return { startup, total: { progress: api.count("/lesson-progress"), modules: api.count("/modules"), lessons: api.count("/lessons") } };
  }

  test("startup: 28 -> 4 progress calls, 12 -> 1 /modules, 14 -> 1 /lessons", async () => {
    const b = await before();
    const n = await after();
    assert.deepEqual(b.startup, { progress: 28, modules: 12, lessons: 14 });
    assert.deepEqual(n.startup, { progress: 4, modules: 1, lessons: 1 });
  });

  test("startup + My Learning + Progress: 40 -> 4 progress calls (limit is 20/min)", async () => {
    const b = await before();
    const n = await after();
    assert.deepEqual(b.total, { progress: 40, modules: 16, lessons: 19 });
    assert.deepEqual(n.total, { progress: 4, modules: 1, lessons: 1 });
    assert.ok(b.total.progress > 20, "before: over the per-endpoint limit");
    assert.ok(n.total.progress <= 20 && n.total.lessons <= 20 && n.total.modules <= 20);
  });

  test("the same screens a minute later (cache expired) still stay far below the limit", async () => {
    let t = 0;
    const api = fakeApi();
    const src = createCourseRequestSources({ getJson: api.getJson, now: () => t });
    const a: Api = { progress: (c) => src.courseProgress("u1", c), modules: () => src.allModules("u1"), lessons: () => src.allLessons("u1") };
    for (let minute = 0; minute < 4; minute++) {
      await Promise.all([contextLoad(a), homeLoad(a), myLearningLoad(a), progressTabLoad(a)]);
      t += 16_000; // every tab opened again after each cache window
    }
    assert.equal(api.count("/lesson-progress"), 16, "4 windows x 4 courses, about 1 minute of constant tab switching");
  });
});

// ── 429 handling ─────────────────────────────────────────────────────────────
function rateLimited(retryAfter?: string | null) {
  return Object.assign(new Error("ThrottlerException: Too Many Requests"), { status: 429, retryAfter });
}
function harness() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    sleeps,
    gate: createRateLimitGate(),
    random: () => 0,
    blockedError: (ms: number) => Object.assign(new Error("blocked"), { status: 429, blockedFor: ms }),
  };
}

describe("429 retry policy", () => {
  test("9. a 429 GET waits for Retry-After, then retries once", async () => {
    const h = harness();
    let calls = 0;
    const r = await runWithRateLimitRetry({
      ...h, method: "GET", endpoint: "/lesson-progress/my/course/43",
      send: async () => { calls++; if (calls === 1) throw rateLimited("2"); return "ok"; },
    });
    assert.equal(r, "ok");
    assert.equal(calls, 2);
    assert.deepEqual(h.sleeps, [2000]);
  });

  test("10. a 429 GET without Retry-After uses a bounded backoff with jitter", async () => {
    const h = harness();
    h.random = () => 0.5;
    let calls = 0;
    await runWithRateLimitRetry({
      ...h, method: "GET", endpoint: "/lessons",
      send: async () => { calls++; if (calls === 1) throw rateLimited(null); return "ok"; },
    });
    assert.equal(h.sleeps.length, 1);
    assert.ok(h.sleeps[0] >= 1000 && h.sleeps[0] <= 1750, `backoff ${h.sleeps[0]} ms`);
  });

  test("at most one retry: a second 429 is returned as a typed error", async () => {
    const h = harness();
    let calls = 0;
    await assert.rejects(
      runWithRateLimitRetry({ ...h, method: "GET", endpoint: "/modules", send: async () => { calls++; throw rateLimited("1"); } }),
      (e: any) => e.status === 429 && classifyApiError(e) === "rate_limited",
    );
    assert.equal(calls, 2);
  });

  test("11. POST, PATCH, PUT and DELETE are never retried", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const h = harness();
      let calls = 0;
      await assert.rejects(
        runWithRateLimitRetry({ ...h, method, endpoint: "/lesson-progress", send: async () => { calls++; throw rateLimited("1"); } }),
      );
      assert.equal(calls, 1, method);
      assert.deepEqual(h.sleeps, [], method);
      assert.equal(isRetryableMethod(method), false);
    }
  });

  test("a long block is not retried, and other reads of that endpoint fail fast (no storm)", async () => {
    const h = harness();
    let calls = 0;
    const send = async () => { calls++; throw rateLimited("60"); };
    await assert.rejects(runWithRateLimitRetry({ ...h, method: "GET", endpoint: "/lesson-progress/my/course/43", send }));
    assert.equal(calls, 1, "60 s > MAX_AUTO_RETRY_WAIT_MS: not retried");
    // another screen, another course: same endpoint handler, same budget
    let other = 0;
    await assert.rejects(
      runWithRateLimitRetry({ ...h, method: "GET", endpoint: "/lesson-progress/my/course/27", send: async () => { other++; return "x"; } }),
      (e: any) => e.status === 429 && e.blockedFor > MAX_AUTO_RETRY_WAIT_MS,
    );
    assert.equal(other, 0, "no request sent into a known block");
  });

  test("a short block makes other reads wait instead of hitting the server", async () => {
    const h = harness();
    h.gate.block(endpointTemplate("/lesson-progress/my/course/43"), h.now() + 3000);
    let calls = 0;
    const r = await runWithRateLimitRetry({
      ...h, method: "GET", endpoint: "/lesson-progress/my/course/21", send: async () => { calls++; return "ok"; },
    });
    assert.equal(r, "ok");
    assert.equal(calls, 1);
    assert.deepEqual(h.sleeps, [3000]);
  });

  test("no retry after the caller aborted", async () => {
    const h = harness();
    const ctl = new AbortController();
    ctl.abort();
    let calls = 0;
    await assert.rejects(runWithRateLimitRetry({
      ...h, method: "GET", endpoint: "/lessons", signal: ctl.signal,
      send: async () => { calls++; throw rateLimited("1"); },
    }));
    assert.equal(calls, 1);
  });

  test("other errors (401, 5xx, network) pass straight through untouched", async () => {
    for (const err of [{ status: 401 }, { status: 503 }, { status: 0 }]) {
      const h = harness();
      let calls = 0;
      await assert.rejects(runWithRateLimitRetry({ ...h, method: "GET", endpoint: "/x", send: async () => { calls++; throw err; } }), (e) => e === err);
      assert.equal(calls, 1);
      assert.deepEqual(h.sleeps, []);
    }
  });

  test("Retry-After parsing and endpoint templates", () => {
    assert.equal(parseRetryAfterMs("5", 0), 5000);
    assert.equal(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
    assert.equal(parseRetryAfterMs(null, 0), null);
    assert.equal(parseRetryAfterMs("soon", 0), null);
    assert.equal(endpointTemplate("/lesson-progress/my/course/43?x=1"), "/lesson-progress/my/course/:id");
    assert.equal(endpointTemplate("https://api.makersflow.in/lesson-progress/my/course/27"), "/lesson-progress/my/course/:id");
  });

  test("apiClient uses the policy for every request; 401 refresh is unchanged and not double-wrapped", () => {
    const src = strip(read("lib/auth/apiClient.ts"));
    assert.match(src, /return runWithRateLimitRetry<T>\(\{/);
    assert.match(src, /response\.status === 429 \? response\.headers\?\.get\?\.\('retry-after'\)/);
    assert.match(src, /const newToken = await refreshOnce\(\);/);
    assert.match(src, /return sendApiRequest<T>\(endpoint, options, true\);/);
  });
});

// ── Typed errors and messages ────────────────────────────────────────────────
describe("15. errors are classified and described correctly", () => {
  test("429, 5xx, 401, timeout and network are distinct", () => {
    assert.equal(classifyApiError({ status: 429 }), "rate_limited");
    assert.equal(classifyApiError({ status: 500 }), "server");
    assert.equal(classifyApiError({ status: 503 }), "server");
    assert.equal(classifyApiError({ status: 401 }), "auth");
    assert.equal(classifyApiError({ status: 408 }), "timeout");
    assert.equal(classifyApiError({ status: 0, message: "Network request failed" }), "network");
    assert.equal(classifyApiError({ status: 404 }), "client");
    assert.equal(classifyApiError({ kind: "rate_limited" }), "rate_limited");
  });

  test("messages match the agreed wording", () => {
    assert.equal(loadErrorMessage("rate_limited", true), "Server is busy. Your progress is saved. Please try again shortly.");
    assert.equal(loadErrorMessage("server", true), "We're having trouble reaching the server. Your saved progress is still available.");
    assert.equal(loadErrorMessage("network", false), "Unable to connect. Check your internet connection.");
    assert.notEqual(loadErrorMessage("timeout", true), loadErrorMessage("network", true));
    assert.match(loadErrorMessage("auth", true), /sign in/i);
  });

  test("no course-data error still blames the connection for every failure", () => {
    for (const f of ["app/(tabs)/index.tsx", "app/(tabs)/courses.tsx", "app/(tabs)/progress.tsx", "app/course/[id].tsx", "app/course/learn.tsx"]) {
      const src = strip(read(f));
      assert.match(src, /loadErrorMessage\(/, f);
      assert.doesNotMatch(src, /We couldn't load your (courses|progress)|Couldn't (refresh|load) your progress/, f);
    }
    // (The lesson VIDEO error in learn.tsx is a separate feature and endpoint;
    // it still has its own wording.)
  });
});

// ── Screens: no duplicate loads, no stale overwrites ─────────────────────────
describe("screens", () => {
  test("only the shared sources call the progress, /modules and /lessons endpoints", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(path.join(root, rel)).isDirectory()) { walk(rel); continue; }
        if (!/\.(ts|tsx)$/.test(name) || rel === "lib/courseRequestSources.ts") continue;
        const src = strip(read(rel));
        if (/\/lesson-progress\/my\/course\/|apiClient\.get<any>\('\/(modules|lessons)'\)|apiRequest<any>\('\/(modules|lessons)'\)/.test(src)) offenders.push(rel);
      }
    };
    for (const d of ["app", "components", "context", "lib", "repositories", "services"]) walk(d);
    assert.deepEqual(offenders, []);
  });

  test("Home: one startup load, no context reload on it, newest load wins, own errors only", () => {
    const home = strip(read("app/(tabs)/index.tsx"));
    assert.match(home, /if \(!\(user\?\.id && loadedForUserRef\.current === user\.id\)\) \{\s*loadData\(false, 'initial'\);/);
    assert.match(home, /if \(loadedForUserRef\.current === uid\) return;\s*loadData\(true, 'initial'\);/);
    assert.match(home, /if \(kind !== 'initial'\) \{\s*await refreshProgressRef\.current\(\{ force: kind === 'user' \}\)/);
    assert.match(home, /const gen = \+\+homeLoadGeneration\.current;/);
    assert.match(home, /if \(!isLatest\(\)\) return;\s*const data = result\.data;/);
    assert.match(home, /if \(isLatest\(\)\) setIsLoading\(false\);/);
    assert.doesNotMatch(home, /progressLoadFailed/, "14. a background failure does not put an error on Home");
    assert.match(home, /await loadData\(true, 'user'\);/, "Retry / pull-to-refresh fetch fresh progress");
  });

  test("progress context: newest run wins; account change clears shared data", () => {
    const ctx = strip(read("context/ProgressContext.tsx"));
    assert.match(ctx, /courseRequests\.clear\(\);\s*loadGeneration\.current \+= 1;/);
    assert.match(ctx, /const gen = \+\+loadGeneration\.current;/);
    assert.match(ctx, /if \(!isLatest\(\)\) return;\s*setProgressLoadFailed\(true\);/);
  });

  test("Progress tab and My Learning guard against stale loads and force only on Retry", () => {
    const progress = strip(read("app/(tabs)/progress.tsx"));
    assert.match(progress, /const gen = \+\+statsLoadGeneration\.current;/);
    assert.match(progress, /if \(isLatest\(\)\) setIsLoadingCourses\(false\);/);
    assert.match(progress, /await loadStatsAndCourses\(true, true\);/);
    const courses = strip(read("app/(tabs)/courses.tsx"));
    assert.match(courses, /requestId !== requestGenerationRef\.current/);
    assert.match(courses, /await loadData\(true, true\);/);
  });

  test("writes invalidate the course they changed; 409 recovery reads fresh", () => {
    const ps = strip(read("lib/progressStorage.ts"));
    assert.ok((ps.match(/courseRequests\.invalidateCourseProgress\(userId, numCourseId\)/g) ?? []).length >= 3, "PATCH, POST, 409-PATCH");
    assert.match(ps, /courseRequests\.invalidateCourseProgress\(userId, courseId\);\s*return 'queued';/);
    assert.match(ps, /lookupCourseProgressIds\(userId, numCourseId, true\)/);
  });
});
