// Mark Lesson Complete protection, completion reliability and request
// reduction (2026-11-13, incl. the adversarial review fixes H1, H2, M1-M6).
// Device logs from 1.0.9 showed HTTP 429 (Retry-After ~23-26 s) after rapid
// taps on Mark Lesson Complete, with several progress errors within
// milliseconds.
//
// Runtime tests exercise the production modules directly (guard, retry
// scheduler, per-lesson write queue, outbox + flush orchestration, refresh
// coordinator, 429 policy). Source assertions are used only for the React
// wiring that node cannot run.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALREADY_COMPLETE,
  completionRetryDelayMs,
  createCompletionRetryScheduler,
  createLessonCompletionGuard,
  lessonCompletionKey,
  type CompletionTicket,
} from "../lib/lessonCompletionGuard.ts";
import { createLessonWriteQueue, isNewerUpdate, type LessonUpdate } from "../lib/lessonWriteQueue.ts";
import {
  createProgressOutbox,
  nextFlushDelayMs,
  runProgressFlush,
  FLUSH_MAX_SENDS,
  FLUSH_SPACING_MS,
} from "../lib/progressOutbox.ts";
import { createProgressRefreshCoordinator } from "../lib/progressRefreshCoordinator.ts";
import {
  createRateLimitGate,
  runWithRateLimitRetry,
  parseRetryAfterMs,
  isCooldownGatedWrite,
  rateLimitKey,
} from "../lib/auth/retryPolicy.ts";
import { createCourseRequestSources } from "../lib/courseRequestSources.ts";
import { createPlaybackTracker, COMPLETE_AT } from "../lib/playbackTracker.ts";
import { classifyApiError } from "../lib/apiErrorKind.ts";
import { profileMatchesToken } from "../lib/profileCacheCore.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");
/** Let queued promise callbacks run. */
const tick = () => new Promise<void>((r) => setImmediate(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function rateLimited(retryAfter: string | null) {
  return Object.assign(new Error("Too Many Requests"), { status: 429, retryAfter });
}

function memStore() {
  let v: string | null = null;
  return { get: async () => v, set: async (x: string) => { v = x; } };
}

/**
 * A fake API with a per-handler rate limit behind the app's real 429 policy
 * (runWithRateLimitRetry + gate). limitFor(ms) makes the server answer 429.
 */
function fakeServer() {
  let t = 1_000_000;
  const gate = createRateLimitGate();
  const calls: string[] = [];
  let limitedUntil = 0;
  const completed = new Set<string>();
  const positions = new Map<string, number>();
  const request = <T>(method: string, endpoint: string, body: () => T) =>
    runWithRateLimitRetry<T>({
      method,
      endpoint,
      gate,
      now: () => t,
      random: () => 0,
      sleep: async (ms) => { t += ms; },
      blockedError: (ms) => Object.assign(new Error("blocked"), { status: 429, retryAfter: String(Math.ceil(ms / 1000)) }),
      send: async () => {
        calls.push(`${method} ${endpoint}`);
        await Promise.resolve();
        if (t < limitedUntil) throw rateLimited(String(Math.ceil((limitedUntil - t) / 1000)));
        return body();
      },
    });
  /** PATCH /lesson-progress/:id (idempotent: is_completed only ever set to true). */
  const write = (u: LessonUpdate) =>
    request("PATCH", `/lesson-progress/${u.lessonId}`, () => {
      if (u.completed) completed.add(String(u.lessonId));
      if (!u.noPosition) positions.set(String(u.lessonId), u.currentTimeSecs);
      return { ok: true };
    });
  return {
    calls,
    completed,
    positions,
    gate,
    get now() { return t; },
    advance(ms: number) { t += ms; },
    limitFor(ms: number) { limitedUntil = t + ms; },
    write,
    /** The app's send adapter: never throws, reports the error. */
    send: (u: LessonUpdate) => write(u).then(() => ({ ok: true }), (error) => ({ ok: false, error })),
    writes: () => calls.filter((c) => c.startsWith("PATCH") || c.startsWith("POST")).length,
  };
}

/**
 * The app's completion path in miniature, built from the production modules:
 * guard (one request per lesson) -> per-lesson write queue -> 429 policy.
 */
function completionApp(server = fakeServer(), userId = "u1", courseId = 43) {
  const guard = createLessonCompletionGuard();
  const queue = createLessonWriteQueue({ send: (u) => server.send(u) });
  const confirmed = new Set<string>();
  let t = 0;
  const complete = (lessonId: string) =>
    guard.run(lessonCompletionKey(userId, courseId, lessonId), () => confirmed.has(lessonId), async () => {
      const r = await queue.complete({
        userId, courseId, lessonId, currentTimeSecs: 0, watchPercentage: 100, noPosition: true, at: ++t,
      });
      if (r.ok) confirmed.add(lessonId);
      return { result: r.ok ? ("synced" as const) : ("queued" as const), failure: r.error };
    });
  return { server, guard, queue, confirmed, complete };
}

const valueOf = (r: any) => (r === ALREADY_COMPLETE ? r : (r as CompletionTicket<any>).value);

// ── 1-5. The button ──────────────────────────────────────────────────────────
describe("Mark Lesson Complete button", () => {
  const learn = strip(read("app/course/learn.tsx"));

  test("1. the button still exists and is wired to the guarded handler", () => {
    assert.match(learn, /'Mark Lesson Complete'/);
    assert.match(learn, /onPress=\{handleMarkComplete\}\s*disabled=\{isMarkingComplete\}/);
    assert.match(learn, /const handleMarkComplete = \(\) => \{\s*if \(!activeModule\?\.id\) return;\s*void runLessonCompletion\(String\(activeModule\.id\)\);/);
  });

  test("2. one tap sends exactly one completion request", async () => {
    const app = completionApp();
    const r = await app.complete("4300");
    assert.equal(valueOf(r).result, "synced");
    assert.equal(app.server.writes(), 1);
    assert.ok(app.server.completed.has("4300"));
  });

  test("3. five to ten rapid taps send one request", async () => {
    for (const taps of [5, 10]) {
      const app = completionApp();
      const results = await Promise.all(Array.from({ length: taps }, () => app.complete("4300")));
      assert.equal(app.server.writes(), 1, `${taps} taps`);
      assert.ok(results.every((r) => valueOf(r).result === "synced"));
      // ...and exactly one caller gets to do the follow-up work
      assert.equal(results.filter((r) => (r as CompletionTicket<any>).claim()).length, 1);
    }
  });

  test("4. the button is disabled and shows Saving... while the request is pending", () => {
    assert.match(learn, /const isMarkingComplete = !!activeModule && completingLessonId === String\(activeModule\.id\);/);
    assert.match(learn, /setCompletingLessonId\(lessonId\);\s*try \{\s*const ticket = await lessonCompletionGuard\.run<CompletionOutcome>\(/);
    assert.match(learn, /finally \{\s*if \(mountedRef\.current\) setCompletingLessonId\(\(cur\) => \(cur === lessonId \? null : cur\)\);/);
    assert.match(learn, /\{isMarkingComplete \? 'Saving\.\.\.' : 'Mark Lesson Complete'\}/);
  });

  test("5. a failed completion is not shown as completed and can be retried", async () => {
    const app = completionApp();
    app.server.limitFor(25_000);
    const r = valueOf(await app.complete("4300"));
    assert.equal(r.result, "queued");
    assert.equal(classifyApiError(r.failure), "rate_limited");
    assert.equal(app.confirmed.has("4300"), false, "never shown as completed");
    assert.equal(app.guard.isInFlight(lessonCompletionKey("u1", 43, "4300")), false, "button re-enabled");

    const before = app.server.writes();
    assert.equal(valueOf(await app.complete("4300")).result, "queued");
    assert.equal(app.server.writes(), before, "no request during the active cooldown");

    app.server.advance(26_000);
    assert.equal(valueOf(await app.complete("4300")).result, "synced");
    assert.equal(app.server.writes(), before + 1);

    assert.match(learn, /if \(outcome\.result === 'queued'\) \{\s*\/?\/?[^\n]*\n?\s*setPendingCompletionIds/);
    assert.match(learn, /'Completed · waiting to sync · Tap to retry'/);
  });

  test("5b. a task that throws rejects every waiter and leaves nothing in flight", async () => {
    const guard = createLessonCompletionGuard();
    const boom = guard.run("k", () => false, async () => { throw new Error("boom"); });
    const joined = guard.run("k", () => false, async () => "never");
    await assert.rejects(boom);
    await assert.rejects(joined);
    assert.equal(guard.isInFlight("k"), false);
    assert.equal(guard.unclaimed("k"), undefined);
    const ok = await guard.run("k", () => false, async () => "ok");
    assert.equal((ok as CompletionTicket<string>).value, "ok", "can run again");
  });
});

// ── 6-8. Already completed, automatic completion, no duplicates ─────────────
describe("completion requests", () => {
  const learn = strip(read("app/course/learn.tsx"));

  test("6. an already-completed lesson sends nothing", async () => {
    const app = completionApp();
    app.confirmed.add("4300");
    assert.equal(await app.complete("4300"), ALREADY_COMPLETE);
    assert.equal(app.server.writes(), 0);
    assert.match(learn, /if \(isConfirmedComplete\(\)\) return;/);
  });

  test("6b. a second completion of a lesson already completed in this session is skipped by the queue", async () => {
    const server = fakeServer();
    const q = createLessonWriteQueue({ send: (u) => server.send(u) });
    const u = { userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 100, noPosition: true, at: 1 };
    assert.equal((await q.complete(u)).ok, true);
    const again = await q.complete({ ...u, at: 2 });
    assert.equal(again.ok, true);
    assert.equal(again.skipped, true);
    assert.equal(server.writes(), 1);
  });

  test("7. automatic completion still fires once at the unchanged 90% threshold", () => {
    assert.equal(COMPLETE_AT, 0.9);
    const t = createPlaybackTracker(() => 0);
    assert.equal(t.onTime(1, 100).complete, undefined, "not on playback start");
    assert.equal(t.onTime(89, 100).complete, undefined);
    assert.equal(t.onTime(90, 100).complete, true);
    assert.equal(t.onTime(99, 100).complete, undefined, "only once");
    const player = strip(read("components/VideoPlayerEnhanced.tsx"));
    assert.match(player, /if \(fx\.complete\) onCompleteRef\.current\?\.\(\);/);
    assert.equal((learn.match(/onComplete=\{handleVideoComplete\}/g) ?? []).length, 2, "local + streamed player");
    assert.match(learn, /const handleVideoComplete = useCallback\(\(\) => \{\s*if \(activeModule\?\.id\) void runLessonCompletion\(String\(activeModule\.id\)\);/);
  });

  test("8. manual + automatic completion at the same time send one write", async () => {
    const app = completionApp();
    const [auto, manual] = await Promise.all([app.complete("4300"), app.complete("4300")]);
    assert.equal(valueOf(auto).result, "synced");
    assert.equal(valueOf(manual).result, "synced");
    assert.equal(app.server.writes(), 1);
    assert.equal(await app.complete("4300"), ALREADY_COMPLETE, "a later tap sends nothing");
    assert.equal(app.server.writes(), 1);
  });

  test("8b. keys are per user + course + lesson; different lessons and users are not merged", async () => {
    assert.equal(lessonCompletionKey("u1", "43", "4300"), lessonCompletionKey("u1", 43, 4300));
    assert.notEqual(lessonCompletionKey("u1", 43, 4300), lessonCompletionKey("u2", 43, 4300));
    const guard = createLessonCompletionGuard();
    let sent = 0;
    await Promise.all([
      guard.run(lessonCompletionKey("u1", 43, 1), () => false, async () => { sent++; }),
      guard.run(lessonCompletionKey("u1", 43, 2), () => false, async () => { sent++; }),
      guard.run(lessonCompletionKey("u2", 43, 1), () => false, async () => { sent++; }),
    ]);
    assert.equal(sent, 3);
  });
});

// ── M1: completion vs slow playback saves ───────────────────────────────────
describe("M1. a completion waits only for the request in flight", () => {
  const base = { userId: "u1", courseId: 43, lessonId: 1, watchPercentage: 50 };

  test("slow playback saves keep arriving; the completion is the very next request", async () => {
    const sent: Array<{ kind: string; at: number; completed: boolean; t: number; noPosition: boolean }> = [];
    const gates: Array<ReturnType<typeof deferred<{ ok: boolean }>>> = [];
    const q = createLessonWriteQueue({
      send: (u, kind) => {
        sent.push({ kind, at: u.at, completed: !!u.completed, t: u.currentTimeSecs, noPosition: !!u.noPosition });
        const d = deferred<{ ok: boolean }>();
        gates.push(d);
        return d.promise;
      },
    });
    void q.save({ ...base, currentTimeSecs: 10, at: 10 }); // slow request in flight
    // Playback keeps saving every 5 s while that request is slow.
    for (let i = 1; i <= 5; i++) void q.save({ ...base, currentTimeSecs: 10 + 5 * i, at: 10 + 5 * i });
    const done = q.complete({ ...base, currentTimeSecs: 0, watchPercentage: 100, noPosition: true, at: 33 });
    void q.save({ ...base, currentTimeSecs: 40, at: 40 });
    await tick();
    assert.equal(sent.length, 1, "nothing else is sent while one request is in flight");

    gates[0].resolve({ ok: true });
    await tick();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].kind, "completion", "the completion goes before the waiting playback saves");
    gates[1].resolve({ ok: true });
    assert.equal((await done).ok, true);

    await tick();
    assert.equal(sent.length, 3, "waiting playback saves were coalesced into one");
    assert.equal(sent[2].t, 40, "only the newest position");
    assert.equal(sent[2].completed, true, "a later playback save carries the completion (never undoes it)");
    gates[2].resolve({ ok: true });
    await tick();
  });

  test("with the real 429 policy: completion during playback hits the server once, completion is kept", async () => {
    const server = fakeServer();
    const q = createLessonWriteQueue({ send: (u) => server.send(u) });
    await q.save({ ...base, lessonId: 7, currentTimeSecs: 100, at: 1 });
    const c = q.complete({ ...base, lessonId: 7, currentTimeSecs: 0, watchPercentage: 100, noPosition: true, at: 2 });
    const s = q.save({ ...base, lessonId: 7, currentTimeSecs: 30, at: 3 }); // e.g. "start over" right after
    assert.equal((await c).ok, true);
    await s;
    assert.ok(server.completed.has("7"));
    assert.equal(server.positions.get("7"), 30, "the newer position is kept");
    assert.equal(server.writes(), 3);
  });
});

// ── M4: older queued progress never overwrites newer progress ───────────────
describe("M4. monotonic progress", () => {
  const base = { userId: "u1", courseId: 43, lessonId: 1, watchPercentage: 50 };

  test("an older outbox entry replayed after a newer save is skipped (not sent)", async () => {
    const server = fakeServer();
    const q = createLessonWriteQueue({ send: (u) => server.send(u) });
    await q.save({ ...base, currentTimeSecs: 300, at: 200 });
    const r = await q.replay({ ...base, currentTimeSecs: 120, at: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(server.positions.get("1"), 300);
    assert.equal(server.writes(), 1);
  });

  test("an older queued completion is still delivered, without its older position", async () => {
    const server = fakeServer();
    const q = createLessonWriteQueue({ send: (u) => server.send(u) });
    await q.save({ ...base, currentTimeSecs: 300, at: 200 });
    const r = await q.replay({ ...base, currentTimeSecs: 120, completed: true, at: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, undefined);
    assert.ok(server.completed.has("1"), "completion delivered");
    assert.equal(server.positions.get("1"), 300, "position not moved back");
  });

  test("full path: queued during 429, newer live save succeeds, the flush then sends nothing stale", async () => {
    const server = fakeServer();
    const ob = createProgressOutbox(memStore(), () => 0);
    const q = createLessonWriteQueue({
      send: (u) => server.send(u),
      onSaved: (u) => { void ob.resolve(u); },
      onFailed: (u, kind) => { if (kind === "save") void ob.put(u); },
    });
    server.limitFor(25_000);
    await q.save({ ...base, currentTimeSecs: 100, at: 100 }); // 429 -> queued
    await tick();
    assert.equal((await ob.pending("u1")).length, 1);
    server.advance(26_000);
    await q.save({ ...base, currentTimeSecs: 160, at: 160 }); // newer save succeeds
    await tick();
    assert.equal((await ob.pending("u1")).length, 0, "the newer save resolved the stale entry");
    const writes = server.writes();
    const report = await runProgressFlush({
      outbox: ob, userId: "u1", currentOwner: () => "u1",
      replay: (u) => q.replay(u as LessonUpdate),
      isRateLimited: (e) => classifyApiError(e) === "rate_limited",
      retryAfterMs: () => null, sleep: async () => {},
    });
    assert.equal(report.sent, 0);
    assert.equal(server.writes(), writes);
    assert.equal(server.positions.get("1"), 160);
  });

  test("outbox.resolve keeps only what the save did not cover; a synced completion is removed", async () => {
    const ob = createProgressOutbox(memStore(), () => 0);
    const key = { userId: "u1", courseId: 43, lessonId: 1 };
    await ob.put({ ...key, currentTimeSecs: 120, watchPercentage: 60, completed: true, at: 100 });
    await ob.resolve({ ...key, at: 150 }); // newer position saved, completion not
    let [e] = await ob.pending("u1");
    assert.equal(e.completed, true);
    assert.equal(e.noPosition, true, "older position dropped, completion kept");
    await ob.resolve({ ...key, at: 160, completed: true, noPosition: true });
    assert.equal((await ob.pending("u1")).length, 0, "synced completion removed");

    await ob.put({ ...key, currentTimeSecs: 500, watchPercentage: 90, at: 300 });
    await ob.resolve({ ...key, at: 200 }); // an OLDER save does not cover it
    [e] = await ob.pending("u1");
    assert.equal(e.currentTimeSecs, 500);
  });

  test("a newer playback position is merged into a queued completion, which stays a completion", async () => {
    let t = 1000;
    const ob = createProgressOutbox(memStore(), () => t);
    await ob.put({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true });
    t += 5000;
    await ob.put({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 120, watchPercentage: 60 });
    const [e] = await ob.pending("u1");
    assert.equal(e.completed, true);
    assert.equal(e.currentTimeSecs, 120, "position not lost");
  });
});

// ── M5: paced, single-flight flush ──────────────────────────────────────────
describe("M5. outbox flush pacing", () => {
  async function outboxWith(n: number, userId = "u1") {
    const ob = createProgressOutbox(memStore(), () => 0);
    for (let i = 1; i <= n; i++) {
      await ob.put({ userId, courseId: 43, lessonId: i, currentTimeSecs: i, watchPercentage: 10, at: i });
    }
    return ob;
  }
  const flushDeps = (ob: ReturnType<typeof createProgressOutbox>, over: Partial<Parameters<typeof runProgressFlush>[0]> = {}) => ({
    outbox: ob,
    userId: "u1",
    currentOwner: () => "u1",
    replay: async () => ({ ok: true }),
    isRateLimited: (e: unknown) => classifyApiError(e) === "rate_limited",
    retryAfterMs: (e: unknown) => parseRetryAfterMs((e as any)?.retryAfter ?? null, 0),
    sleep: async () => {},
    ...over,
  });

  test("defaults: at most 6 sends, 3 s apart, then one follow-up after 60 s", async () => {
    assert.equal(FLUSH_MAX_SENDS, 6);
    assert.equal(FLUSH_SPACING_MS, 3_000);
    const ob = await outboxWith(10);
    const sleeps: number[] = [];
    const sent: number[] = [];
    const report = await runProgressFlush(flushDeps(ob, {
      replay: async (u) => { sent.push(Number(u.lessonId)); return { ok: true }; },
      sleep: async (ms) => { sleeps.push(ms); },
    }));
    assert.deepEqual(sent, [1, 2, 3, 4, 5, 6], "oldest first, capped");
    assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000]);
    assert.equal(report.capped, true);
    assert.equal(report.remaining, 4);
    assert.equal(nextFlushDelayMs(report), 60_000);
  });

  test("stops at the first 429; the rest stays queued; next try after Retry-After", async () => {
    const ob = await outboxWith(4);
    let calls = 0;
    const report = await runProgressFlush(flushDeps(ob, {
      replay: async () => (++calls === 2 ? { ok: false, error: rateLimited("25") } : { ok: true }),
    }));
    assert.equal(calls, 2, "nothing sent after the 429");
    assert.equal(report.sent, 1);
    assert.equal(report.rateLimited, true);
    assert.equal(report.remaining, 3);
    assert.equal(nextFlushDelayMs(report), 26_000);
  });

  test("during an active cooldown a flush sends nothing to the server", async () => {
    const server = fakeServer();
    const q = createLessonWriteQueue({ send: (u) => server.send(u) });
    server.limitFor(25_000);
    await assert.rejects(server.write({ userId: "u1", courseId: 43, lessonId: 99, currentTimeSecs: 0, watchPercentage: 0, at: 0 }));
    const ob = await outboxWith(3);
    const before = server.writes();
    const report = await runProgressFlush(flushDeps(ob, { replay: (u) => q.replay(u as LessonUpdate) }));
    assert.equal(server.writes(), before, "the write gate refused it locally");
    assert.equal(report.rateLimited, true);
    assert.equal(report.remaining, 3);
    server.advance(26_000);
    const after = await runProgressFlush(flushDeps(ob, { replay: (u) => q.replay(u as LessonUpdate) }));
    assert.equal(after.sent, 3);
    assert.equal(after.remaining, 0, "flushed and removed after the cooldown");
  });

  test("concurrent flushes for the same user share one run (no duplicate sends)", async () => {
    const ob = await outboxWith(3);
    let calls = 0;
    const gate = deferred<void>();
    const deps = flushDeps(ob, { replay: async () => { calls++; await gate.promise; return { ok: true }; } });
    const a = runProgressFlush(deps);
    const b = runProgressFlush(deps);
    gate.resolve();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(calls, 3);
    assert.equal(ra.sent, 3);
    assert.equal(rb.sent, 3);
  });

  test("a live save is never blocked behind a running flush, and its newer data survives", async () => {
    const ob = await outboxWith(1);
    const gate = deferred<{ ok: boolean }>();
    const flushing = runProgressFlush(flushDeps(ob, { replay: () => gate.promise }));
    await tick();
    // While the flush is waiting on the network, a newer update is queued.
    const put = ob.put({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 999, watchPercentage: 80, at: 50 });
    const raced = await Promise.race([put.then(() => "done"), new Promise((r) => setTimeout(() => r("blocked"), 200))]);
    assert.equal(raced, "done", "put does not wait for the flush");
    gate.resolve({ ok: true });
    await flushing;
    const [e] = await ob.pending("u1");
    assert.equal(e?.currentTimeSecs, 999, "the entry changed during the send is kept, not deleted");
  });

  test("failed sends keep the data", async () => {
    const ob = await outboxWith(2);
    const report = await runProgressFlush(flushDeps(ob, { replay: async () => ({ ok: false, error: new Error("offline") }) }));
    assert.equal(report.failed, 2);
    assert.equal(report.remaining, 2);
  });

  test("persistence: a new outbox instance on the same storage (app restart) still has the entries", async () => {
    const store = memStore();
    const ob1 = createProgressOutbox(store, () => 0);
    await ob1.put({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 5, watchPercentage: 10, completed: true, at: 1 });
    const ob2 = createProgressOutbox(store, () => 0);
    const [e] = await ob2.pending("u1");
    assert.equal(e.completed, true);
  });
});

// ── M6 / H2: account isolation of the flush ─────────────────────────────────
describe("M6 / H2. queued progress never crosses accounts", () => {
  test("H2: only the signed-in account's entries are sent; the other account's stay queued", async () => {
    const ob = createProgressOutbox(memStore(), () => 1000); // same timestamp: order must not matter
    await ob.put({ userId: "alice", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 100, completed: true });
    await ob.put({ userId: "bob", courseId: 43, lessonId: 2, currentTimeSecs: 10, watchPercentage: 20 });
    await ob.put({ userId: "alice", courseId: 43, lessonId: 3, currentTimeSecs: 30, watchPercentage: 40 });
    const replayedFor: string[] = [];
    const report = await runProgressFlush({
      outbox: ob, userId: "alice", currentOwner: () => "alice",
      replay: async (u) => { replayedFor.push(u.userId); return { ok: true }; },
      isRateLimited: () => false, retryAfterMs: () => null, sleep: async () => {},
    });
    assert.equal(report.sent, 2);
    assert.deepEqual([...new Set(replayedFor)], ["alice"]);
    assert.equal((await ob.pending("alice")).length, 0);
    const bob = await ob.pending("bob");
    assert.equal(bob.length, 1);
    assert.equal(bob[0].lessonId, 2);
  });

  test("account switch during a flush: nothing more is sent; the old account's entries stay queued", async () => {
    const ob = createProgressOutbox(memStore(), () => 1000);
    for (const lessonId of [1, 2, 3]) {
      await ob.put({ userId: "alice", courseId: 43, lessonId, currentTimeSecs: 0, watchPercentage: 10 });
    }
    let owner = "alice";
    const replayed: number[] = [];
    const report = await runProgressFlush({
      outbox: ob, userId: "alice", currentOwner: () => owner,
      replay: async (u) => {
        replayed.push(Number(u.lessonId));
        owner = "bob"; // signed out and bob signed in while this request was running
        return { ok: false, error: Object.assign(new Error("Signed-in account changed; request not sent."), { status: 0 }) };
      },
      isRateLimited: () => false, retryAfterMs: () => null, sleep: async () => {},
    });
    assert.equal(replayed.length, 1, "stopped right after the switch");
    assert.equal(report.identityChanged, true);
    assert.equal(report.stopped, true);
    assert.equal((await ob.pending("alice")).length, 3, "nothing lost or sent for alice");
    assert.equal(nextFlushDelayMs(report), null, "no follow-up flush for the old account");
  });

  test("a flush started for another account than the signed-in one sends nothing", async () => {
    const ob = createProgressOutbox(memStore(), () => 1000);
    await ob.put({ userId: "alice", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 10 });
    let calls = 0;
    const report = await runProgressFlush({
      outbox: ob, userId: "alice", currentOwner: () => "bob",
      replay: async () => { calls++; return { ok: true }; },
      isRateLimited: () => false, retryAfterMs: () => null, sleep: async () => {},
    });
    assert.equal(calls, 0);
    assert.equal(report.identityChanged, true);
  });

  test("the token-owner check used by apiClient (JWT sub)", () => {
    const jwt = (sub: string) =>
      `h.${Buffer.from(JSON.stringify({ sub })).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}.s`;
    assert.equal(profileMatchesToken({ id: "alice" }, jwt("alice")), true);
    assert.equal(profileMatchesToken({ id: "alice" }, jwt("bob")), false);
    assert.equal(profileMatchesToken({ id: "alice" }, null), false, "signed out: not sent");
  });

  test("apiClient checks the token owner right before fetch (no await in between) and progress requests carry the owner", () => {
    const api = strip(read("lib/auth/apiClient.ts"));
    const from = api.indexOf("const accessToken = await tokenStorage.getAccessToken();");
    const to = api.indexOf("const response = await fetch(url, {");
    assert.ok(from > 0 && to > from);
    const between = api.slice(from + "const accessToken = await".length, to);
    assert.doesNotMatch(between, /\bawait\b/, "no await between the identity check and fetch");
    assert.match(between, /if \(expectedUserId !== undefined && !profileMatchesToken\(\{ id: expectedUserId \}, accessToken\)\) \{\s*clearTimeout\(timeoutId\);\s*throw new ApiError\(0, SESSION_CHANGED_MESSAGE/);
    const ps = strip(read("lib/progressStorage.ts"));
    assert.equal((ps.match(/\{ expectedUserId: String\(userId\) \}/g) ?? []).length, 3, "PATCH, POST, 409-PATCH");
    assert.match(strip(read("lib/courseRequests.ts")), /apiClient\.get<any>\(path, forUserId \? \{ expectedUserId: forUserId \} : undefined\)/);
    assert.match(ps, /currentOwner: \(\) => cacheManager\.userScope\(\)\.owner,/);
    assert.match(ps, /if \(String\(cacheManager\.userScope\(\)\.owner\) !== String\(userId\)\) throw new Error\('Signed-in account changed\.'\);/, "ids never cached for another account");
  });

  test("shared progress GETs pass the user they are for", async () => {
    const seen: Array<string | undefined> = [];
    const src = createCourseRequestSources({
      getJson: async (_p, forUserId) => { seen.push(forUserId); return { success: true, data: { total_lessons: 1, lessons: [] } }; },
    });
    await src.courseProgress("alice", 43);
    assert.deepEqual(seen, ["alice"]);
  });
});

// ── M2: per-lesson automatic retry ──────────────────────────────────────────
describe("M2. completion retry scheduling", () => {
  function fakeTimers() {
    let t = 0;
    const timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = [];
    let id = 0;
    return {
      now: () => t,
      setTimer: (fn: () => void, ms: number) => { const h = { at: t + ms, fn, id: ++id, live: true }; timers.push(h); return h; },
      clearTimer: (h: any) => { h.live = false; },
      advance(ms: number) {
        t += ms;
        for (const h of timers.filter((x) => x.live && x.at <= t).sort((a, b) => a.at - b.at)) { h.live = false; h.fn(); }
      },
      live: () => timers.filter((x) => x.live).length,
    };
  }

  test("two lessons rate-limited at once each keep their own retry", () => {
    const ft = fakeTimers();
    const s = createCompletionRetryScheduler(ft);
    const fired: string[] = [];
    s.schedule("u1:43:1", 25_000, () => fired.push("1"));
    s.schedule("u1:43:2", 25_000, () => fired.push("2"));
    assert.equal(ft.live(), 2, "the second did not cancel the first");
    ft.advance(26_000);
    assert.deepEqual(fired.sort(), ["1", "2"]);
  });

  test("manual taps during the cooldown do not use up automatic attempts or pull the retry earlier", () => {
    const ft = fakeTimers();
    const s = createCompletionRetryScheduler(ft);
    let fired = 0;
    s.schedule("k", 25_000, () => fired++);
    for (let i = 0; i < 8; i++) { ft.advance(1_000); s.schedule("k", 5_000, () => fired++); }
    assert.equal(s.attemptsFired("k"), 0, "taps are not attempts");
    assert.equal(ft.live(), 1, "still one timer");
    ft.advance(10_000); // 8 s + 10 s = 18 s < 26 s
    assert.equal(fired, 0, "Retry-After respected: not earlier");
    ft.advance(9_000);
    assert.equal(fired, 1);
    assert.equal(s.attemptsFired("k"), 1);
  });

  test("a later Retry-After moves the retry later", () => {
    const ft = fakeTimers();
    const s = createCompletionRetryScheduler(ft);
    let fired = 0;
    s.schedule("k", 5_000, () => fired++);
    s.schedule("k", 40_000, () => fired++);
    ft.advance(10_000);
    assert.equal(fired, 0);
    ft.advance(32_000);
    assert.equal(fired, 1);
  });

  test("bounded: at most 3 automatic attempts per lesson; success resets; cancelAll clears", () => {
    const ft = fakeTimers();
    const s = createCompletionRetryScheduler(ft);
    let fired = 0;
    for (let i = 0; i < 5; i++) { s.schedule("k", 1_000, () => fired++); ft.advance(3_000); }
    assert.equal(fired, 3);
    assert.equal(s.schedule("k", 1_000, () => fired++), null, "exhausted");
    s.succeeded("k");
    assert.notEqual(s.schedule("k", 1_000, () => fired++), null, "reset after success");
    s.schedule("j", 1_000, () => fired++);
    s.cancelAll();
    ft.advance(10_000);
    assert.equal(fired, 3, "nothing fires after cancelAll (unmount / sign-out)");
    assert.equal(completionRetryDelayMs(25_000, 0), 26_000);
    assert.equal(completionRetryDelayMs(10 * 60_000, 0), 120_000);
  });

  test("the screen wiring: per-lesson scheduler, cleared on unmount and account change", () => {
    const learn = strip(read("app/course/learn.tsx"));
    assert.match(learn, /const completionRetries = useRef\(createCompletionRetryScheduler\(\)\)\.current;/);
    assert.match(learn, /useEffect\(\(\) => \(\) => completionRetries\.cancelAll\(\), \[completionRetries\]\);/);
    assert.match(learn, /useEffect\(\(\) => \{ completionRetries\.cancelAll\(\); \}, \[user\?\.id, completionRetries\]\);/);
    assert.match(learn, /if \(mountedRef\.current && userIdRef\.current === userId && pendingCompletionIdsRef\.current\.includes\(String\(lessonId\)\)\)/);
    assert.doesNotMatch(learn, /completionRetryTimer/);
  });
});

// ── M3: closing and reopening the lesson during a completion ────────────────
describe("M3. reopening a lesson while its completion is in flight", () => {
  test("the reopened screen sees the request, sends nothing, and the follow-up runs exactly once", async () => {
    const server = fakeServer();
    const guard = createLessonCompletionGuard(); // module-level in the app
    const gate = deferred<void>();
    const key = lessonCompletionKey("u1", 43, 1);
    const task = async () => { await gate.promise; await server.write({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true, at: 1 }); return { result: "synced" as const }; };

    // Screen A taps, then is closed while the request is running.
    const a = guard.run(key, () => false, task);
    // Screen B opens the same lesson.
    const running = guard.inFlight(key);
    assert.ok(running, "B sees the in-flight completion (shows Saving..., not the button)");
    // B's tap (if any) joins instead of writing.
    const bTap = guard.run(key, () => false, async () => { throw new Error("must not run"); });
    gate.resolve();
    const [ta, tb] = await Promise.all([a, bTap]);
    assert.equal(server.writes(), 1);
    // A (closed) awaited first and claims: it does the data steps, without navigating.
    assert.equal((ta as CompletionTicket<any>).claim(), true);
    assert.equal((tb as CompletionTicket<any>).claim(), false, "B does not repeat the certificate / course steps");
    assert.equal(guard.unclaimed(key), undefined);
  });

  test("a completion that finished while no screen was open is picked up once by the next screen", async () => {
    const guard = createLessonCompletionGuard();
    const key = lessonCompletionKey("u1", 43, 2);
    const t = await guard.run(key, () => false, async () => ({ result: "synced" as const }));
    // nobody claimed it (the only caller was gone)
    const found = guard.unclaimed<{ result: string }>(key);
    assert.equal(found, t);
    assert.equal(found!.claim(), true);
    assert.equal(guard.unclaimed(key), undefined);
    assert.equal((t as CompletionTicket<any>).claim(), false);
  });

  test("another account never sees the first account's completion state", async () => {
    const guard = createLessonCompletionGuard();
    const gate = deferred<void>();
    void guard.run(lessonCompletionKey("alice", 43, 1), () => false, async () => { await gate.promise; return 1; });
    assert.equal(guard.isInFlight(lessonCompletionKey("bob", 43, 1)), false);
    assert.equal(guard.inFlight(lessonCompletionKey("bob", 43, 1)), undefined);
    gate.resolve();
  });

  test("screen wiring: closed screens never navigate or show modals; reopened screens adopt in-flight / unclaimed results", () => {
    const learn = strip(read("app/course/learn.tsx"));
    assert.match(learn, /^const lessonCompletionGuard = createLessonCompletionGuard\(\);$/m);
    assert.match(learn, /if \(!alreadyShown && mountedRef\.current && userIdRef\.current === userId\) \{\s*await AsyncStorage\.setItem\(certKey, 'true'\);\s*router\.push\(/);
    assert.match(learn, /if \(mountedRef\.current\) setShowCompleteModal\(true\);/);
    assert.match(learn, /if \(ticket\.claim\(\)\) await handleCompletionOutcome\(lessonId, userId, ticket\.value\);/);
    assert.match(learn, /const running = lessonCompletionGuard\.inFlight<CompletionOutcome>\(key\);\s*if \(running\) \{\s*setCompletingLessonId\(lessonId\);/);
    assert.match(learn, /const done = lessonCompletionGuard\.unclaimed<CompletionOutcome>\(key\);\s*if \(done\) void settle\(done\);/);
  });
});

// ── H1: first-load race in the progress context ─────────────────────────────
describe("H1. completion during the first full progress load", () => {
  /**
   * The progress context in miniature, using the production coordinator.
   * A full load reads the server when it starts (so a load that started
   * before the completion has the old value) and applies the WHOLE map; a
   * course refresh merges one course into the current map (as completeModule).
   */
  function contextHarness() {
    const server: Record<string, string> = { "43": "1/3", "27": "0/2", "21": "2/2" };
    const coordinator = createProgressRefreshCoordinator();
    let map = new Map<string, string>();
    let watchlist: string[] = [];
    const apply = (m: Map<string, string>) => {
      map = m;
      watchlist = [...m.entries()].filter(([, v]) => { const [a, b] = v.split("/"); return a !== b; }).map(([k]) => k).sort();
    };
    const fullGates: Array<ReturnType<typeof deferred<boolean>>> = [];
    let fullLoads = 0;
    let oneLoads = 0;
    const loadFullRun = async () => {
      fullLoads++;
      const snapshot = { ...server };
      const g = deferred<boolean>();
      fullGates.push(g);
      const ok = await g.promise;
      if (ok) apply(new Map(Object.entries(snapshot)));
      return ok;
    };
    const loadAll = () => coordinator.runFull(loadFullRun);
    const completeModule = (courseId: string) =>
      coordinator.refreshCourse({
        startFull: loadFullRun,
        refreshOne: async () => {
          oneLoads++;
          const next = new Map(map);
          next.set(courseId, server[courseId]);
          apply(next);
        },
      });
    return {
      server, coordinator, loadAll, completeModule, fullGates,
      get map() { return map; }, get watchlist() { return watchlist; },
      get fullLoads() { return fullLoads; }, get oneLoads() { return oneLoads; },
    };
  }

  test("order 1: completion while the first load is running, load resolves after", async () => {
    const h = contextHarness();
    void h.loadAll(); // app start
    h.server["27"] = "1/2"; // the completion write landed
    const done = h.completeModule("27");
    await tick();
    assert.equal(h.fullLoads, 1, "no second full load");
    h.fullGates[0].resolve(true); // first load applies its (older) snapshot
    assert.equal(await done, "course");
    assert.deepEqual([...h.map.keys()].sort(), ["21", "27", "43"], "every course is still there");
    assert.equal(h.map.get("27"), "1/2", "the completed course is current");
    assert.deepEqual(h.watchlist, ["27", "43"], "Continue Learning from the complete map");
  });

  test("order 2: first load finishes before the completion's refresh starts", async () => {
    const h = contextHarness();
    const first = h.loadAll();
    await tick();
    h.fullGates[0].resolve(true);
    await first;
    h.server["43"] = "3/3";
    assert.equal(await h.completeModule("43"), "course");
    assert.equal(h.fullLoads, 1);
    assert.equal(h.oneLoads, 1);
    assert.deepEqual([...h.map.keys()].sort(), ["21", "27", "43"]);
    assert.deepEqual(h.watchlist, ["27"], "finished course dropped out of Continue Learning");
  });

  test("first load failed: one full load runs instead of a one-course map; concurrent completions share it", async () => {
    const h = contextHarness();
    const first = h.loadAll();
    await tick();
    h.fullGates[0].resolve(false); // e.g. HTTP 429
    await first;
    h.server["27"] = "1/2";
    h.server["43"] = "2/3";
    const a = h.completeModule("27");
    const b = h.completeModule("43");
    await tick();
    assert.equal(h.fullLoads, 2, "exactly one extra full load for both completions");
    h.fullGates[1].resolve(true);
    assert.deepEqual(await Promise.all([a, b]), ["full", "full"], "that load started after both writes: no extra course request");
    assert.equal(h.oneLoads, 0);
    assert.deepEqual([...h.map.keys()].sort(), ["21", "27", "43"]);
    assert.equal(h.map.get("27"), "1/2");
  });

  test("still no complete map (offline): nothing is merged; the map is not replaced by one course", async () => {
    const h = contextHarness();
    const done = h.completeModule("27");
    await tick();
    h.fullGates[0].resolve(false);
    assert.equal(await done, "skipped");
    assert.equal(h.map.size, 0);
  });

  test("account change while waiting cancels the refresh", async () => {
    const h = contextHarness();
    void h.loadAll();
    const done = h.completeModule("27");
    await tick();
    h.coordinator.reset();
    h.fullGates[0].resolve(true);
    assert.equal(await done, "cancelled");
    assert.equal(h.oneLoads, 0);
  });

  test("ProgressContext uses the coordinator and never bumps the load generation for a course refresh", () => {
    const ctx = strip(read("context/ProgressContext.tsx"));
    const body = ctx.slice(ctx.indexOf("async function completeModule"), ctx.indexOf("async function refreshWatchlist"));
    assert.match(body, /await refreshCoordinator\.refreshCourse\(\{\s*startFull: \(\) => loadAllProgressRun\(\),/);
    assert.match(body, /fetchRemoteProgress\(userId, \{ onlyCourseId: String\(courseId\) \}\)/);
    assert.match(body, /if \(!updated \|\| currentUserIdRef\.current !== userId\) return;/);
    assert.match(body, /buildWatchlist\(Array\.from\(next\.values\(\)\)\)/);
    assert.doesNotMatch(body, /loadGeneration/);
    assert.match(ctx, /return refreshCoordinator\.runFull\(\(\) => loadAllProgressRun\(opts\)\)\.then\(\(\) => undefined\);/);
    assert.match(ctx, /refreshCoordinator\.reset\(\);\s*currentUserIdRef\.current = user\?\.id \?\? null;/);
    assert.match(ctx, /courseProgressRef\.current = progressMap;\s*setCourseProgress\(progressMap\);/);
  });
});

// ── 9. Requests after a completion ──────────────────────────────────────────
describe("9. after a completion only that course is refreshed", () => {
  test("request count with 4 enrolled courses: 4 -> 1 progress GET", async () => {
    let now = 0;
    const calls: string[] = [];
    const src = createCourseRequestSources({
      now: () => now,
      getJson: async (p) => { calls.push(p); return { success: true, data: { total_lessons: 3, completed_lessons: 1, lessons: [] } }; },
    });
    const courses = [43, 27, 21, 44];
    await Promise.all(courses.map((c) => src.courseProgress("u1", c)));
    now += 60_000;
    src.invalidateCourseProgress("u1", 43);
    calls.length = 0;
    // Before: every course reloaded, then the lesson screen reloaded 43.
    await Promise.all(courses.map((c) => src.courseProgress("u1", c)));
    await src.courseProgress("u1", 43);
    const before = calls.length;
    now += 60_000;
    src.invalidateCourseProgress("u1", 43);
    calls.length = 0;
    // After: only the completed course; the lesson screen's reload shares it.
    await src.courseProgress("u1", 43);
    await src.courseProgress("u1", 43);
    assert.equal(before, 4);
    assert.deepEqual(calls, ["/lesson-progress/my/course/43"]);
  });

  test("a failed completion never updates the screen as completed", () => {
    const learn = strip(read("app/course/learn.tsx"));
    const queued = learn.match(/if \(outcome\.result === 'queued'\) \{[\s\S]*?\n {6}return;\n {4}\}/)?.[0] ?? "";
    assert.ok(queued.length > 0);
    assert.doesNotMatch(queued, /completeModule|showLessonCompleted|setLessonsProgress|completeCourse|issueCertificate|setShowCompleteModal/);
    assert.match(learn, /if \(ticket\.value\.result === 'synced' && mountedRef\.current\) showLessonCompleted\(lessonId\);/);
  });
});

// ── 10. Course Details ───────────────────────────────────────────────────────
describe("10. Course Details loads once on open", () => {
  test("the first focus after the mount load is skipped; later focuses and pull-to-refresh still load", () => {
    const src = strip(read("app/course/[id].tsx"));
    assert.match(src, /skipFocusLoadFor\.current = loadCourseData;\s*loadCourseData\(false, cancelledRef\);/);
    assert.match(src, /if \(skipFocusLoadFor\.current === loadCourseData\) \{\s*skipFocusLoadFor\.current = null;\s*return;\s*\}\s*loadCourseData\(true\);/);
    assert.match(src, /const onRefresh = async \(\) => \{\s*setRefreshing\(true\);\s*await loadCourseData\(true, undefined, true\);/);
  });
});

// ── 11. HTTP 429 cooldown ────────────────────────────────────────────────────
describe("11. 429 cooldown", () => {
  test("a progress write is not sent at all while its endpoint is cooling down, and is sent after", async () => {
    const server = fakeServer();
    const u = { userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 100, completed: true, at: 0 };
    server.limitFor(25_000);
    await assert.rejects(server.write(u), (e: any) => e.status === 429);
    assert.equal(server.writes(), 1, "reached the server once, no retry");
    for (let i = 0; i < 5; i++) {
      await assert.rejects(server.write(u), (e: any) => e.status === 429 && Number(e.retryAfter) > 0);
    }
    assert.equal(server.writes(), 1, "nothing sent during the cooldown");
    server.advance(25_000);
    await server.write(u);
    assert.equal(server.writes(), 2);
  });

  test("only lesson-progress writes are held back; auth, payment and other writes are unaffected", async () => {
    assert.equal(isCooldownGatedWrite(rateLimitKey("PATCH", "/lesson-progress/17")), true);
    assert.equal(isCooldownGatedWrite(rateLimitKey("POST", "/lesson-progress")), true);
    for (const [m, e] of [["POST", "/auth/login"], ["POST", "/payments/create-order"], ["POST", "/enrollments/free"], ["POST", "/wishlist"], ["POST", "/lesson-progressX"]]) {
      assert.equal(isCooldownGatedWrite(rateLimitKey(m, e)), false, e);
    }
    const gate = createRateLimitGate();
    gate.block("POST /payments/create-order", 60_000);
    let sent = 0;
    await runWithRateLimitRetry({
      method: "POST", endpoint: "/payments/create-order", gate, now: () => 0, random: () => 0,
      sleep: async () => {}, blockedError: () => new Error("blocked"),
      send: async () => { sent++; return "ok"; },
    });
    assert.equal(sent, 1, "unchanged behaviour for payments");
  });

  test("a 429 on writes does not block reads", async () => {
    const server = fakeServer();
    server.limitFor(25_000);
    await assert.rejects(server.write({ userId: "u1", courseId: 43, lessonId: 1, currentTimeSecs: 0, watchPercentage: 0, at: 0 }));
    assert.ok(server.gate.blockedUntil("PATCH /lesson-progress/:id") > server.now);
    assert.equal(server.gate.blockedUntil("GET /lesson-progress/my/course/:id"), 0);
  });
});

// ── 13. Signed video URL ─────────────────────────────────────────────────────
describe("13. signed video URL and HTTP 429", () => {
  const learn = strip(read("app/course/learn.tsx"));
  const player = strip(read("components/VideoPlayerEnhanced.tsx"));

  test("initial load: 429 is a 'busy' state, distinct from auth and connection errors; Try again is kept", () => {
    assert.match(learn, /status === 401 \|\| status === 403 \? "forbidden" : status === 429 \? "busy" : "network"/);
    assert.match(learn, /: signedUrlError === "busy"\s*\? "Server is busy\. Please wait a moment, then try again\."/);
    assert.match(learn, /onPress=\{\(\) => setSignedUrlAttempt\(\(n\) => n \+ 1\)\}/);
  });

  test("refresh: 429 reaches the player, which stops retrying and says so; Try Again resets", () => {
    assert.match(learn, /if \(\(err\?\.status \?\? err\?\.statusCode\) === 429 && activeLessonIdRef\.current === lessonId\) throw err;/);
    assert.match(player, /const busy = \(error as any\)\?\.status === 429;\s*if \(busy\) \{[\s\S]*?retryCountRef\.current = 3;/);
    assert.match(player, /isServerBusy\s*\? "Server is busy\. Please wait a moment, then try again\."\s*: "Unable to load video\. Please check your connection\."/);
    assert.match(player, /retryCountRef\.current = 0;\s*setRetryCount\(0\);\s*void replaceVideoSource\(\);/);
  });

  test("retries during a 25 s cooldown send one request; after the cooldown it works again", async () => {
    const server = fakeServer();
    let signed = 0;
    let limited = true;
    const getUrl = () =>
      runWithRateLimitRetry({
        method: "GET", endpoint: "/lessons/4300/video", gate: server.gate, now: () => server.now, random: () => 0,
        sleep: async (ms) => server.advance(ms),
        blockedError: (ms) => Object.assign(new Error("blocked"), { status: 429, retryAfter: String(Math.ceil(ms / 1000)) }),
        send: async () => { signed++; if (limited) throw rateLimited("25"); return "https://signed"; },
      });
    for (let i = 0; i < 3; i++) await assert.rejects(getUrl(), (e: any) => e.status === 429);
    assert.equal(signed, 1, "Retry-After 25 s > 10 s: not retried, the gate refuses the rest");
    server.advance(26_000);
    limited = false;
    assert.equal(await getUrl(), "https://signed", "Try again after the cooldown works");
    assert.equal(signed, 2);
  });
});

// ── Low-priority cleanup ─────────────────────────────────────────────────────
describe("low-priority fixes", () => {
  test("the queued message matches the failure (busy / offline / server)", () => {
    const learn = strip(read("app/course/learn.tsx"));
    assert.match(learn, /kind === 'rate_limited'\s*\? "Server is busy\. Your completion is saved on this device and will sync automatically\."/);
    assert.match(learn, /: kind === 'network' \|\| kind === 'timeout'\s*\? "Saved on this device\. It will sync when you're back online\."/);
    assert.match(learn, /: "Couldn't reach the server\. Your completion is saved on this device and will sync automatically\."/);
  });
});

// ── Clock ordering (2026-11-13): no ordering decision depends on the device
// clock within one app session. All tests use the production write queue and
// outbox; the outbox gets the queue's order exactly as lib/progressStorage.ts
// wires it.
describe("clock ordering: session + sequence instead of Date.now()", () => {
  const base = { userId: "u1", courseId: 43, lessonId: 1, watchPercentage: 50 };

  /** Server that records every position it accepts; setFail(true) makes sends fail. */
  function recordingServer() {
    const accepted: Array<{ t: number; completed: boolean; noPosition: boolean }> = [];
    let position: number | undefined;
    let completed = false;
    let fail = false;
    return {
      accepted,
      get position() { return position; },
      get completed() { return completed; },
      setFail(v: boolean) { fail = v; },
      send: async (u: LessonUpdate) => {
        await Promise.resolve();
        if (fail) return { ok: false, error: new Error("offline") };
        accepted.push({ t: u.currentTimeSecs, completed: !!u.completed, noPosition: !!u.noPosition });
        if (!u.noPosition) position = u.currentTimeSecs;
        if (u.completed) completed = true; // the server never un-completes
        return { ok: true };
      },
    };
  }

  /** Queue + outbox wired like the app (the outbox uses the queue's order). */
  function appQueue(server = recordingServer(), store = memStore(), sessionId = "current") {
    let ob!: ReturnType<typeof createProgressOutbox>;
    const q = createLessonWriteQueue({
      sessionId,
      send: (u) => server.send(u),
      onSaved: (u) => { void ob.resolve(u); },
      onFailed: (u, kind) => { if (kind === "save") void ob.put(u); },
    });
    ob = createProgressOutbox(store, () => 0, { isNewer: (a, b) => q.isNewer(a, b) });
    return { server, q, ob, store };
  }

  test("normal chronological saves are all applied in order", async () => {
    const { server, q } = appQueue();
    for (const [t, at] of [[10, 1000], [15, 6000], [20, 11000]]) await q.save({ ...base, currentTimeSecs: t, at });
    assert.deepEqual(server.accepted.map((a) => a.t), [10, 15, 20]);
    assert.equal(server.position, 20);
  });

  test("device clock moves backwards between saves: the later save is still sent", async () => {
    const { server, q } = appQueue();
    await q.save({ ...base, currentTimeSecs: 100, at: 1_700_000_000_000 });
    // The clock is set back one hour (manual change, time zone or NTP correction).
    const r = await q.save({ ...base, currentTimeSecs: 130, at: 1_700_000_000_000 - 3_600_000 });
    assert.equal(r.skipped, undefined, "not treated as stale");
    assert.equal(server.position, 130);
    assert.equal(server.accepted.length, 2);
  });

  test("two updates with identical timestamps are both applied, the later one last", async () => {
    const { server, q } = appQueue();
    await q.save({ ...base, currentTimeSecs: 40, at: 5000 });
    const r = await q.save({ ...base, currentTimeSecs: 45, at: 5000 });
    assert.equal(r.skipped, undefined);
    assert.equal(server.position, 45);
  });

  test("concurrent saves for the same lesson: one in flight; the last CREATED one wins even if the clock went back", async () => {
    const gate = deferred<{ ok: boolean }>();
    const sent: number[] = [];
    let first = true;
    const q = createLessonWriteQueue({
      sessionId: "current",
      send: async (u) => {
        sent.push(u.currentTimeSecs);
        if (first) { first = false; return gate.promise; }
        return { ok: true };
      },
    });
    const all = [q.save({ ...base, currentTimeSecs: 10, at: 9000 })];
    // While that request is slow, more saves arrive and the clock keeps jumping back.
    for (const [t, at] of [[20, 8000], [30, 7000], [40, 6000]]) all.push(q.save({ ...base, currentTimeSecs: t, at }));
    await tick();
    assert.deepEqual(sent, [10], "single writer per lesson");
    gate.resolve({ ok: true });
    await Promise.all(all);
    assert.deepEqual(sent, [10, 40], "coalesced to the newest created save (smallest timestamp)");
  });

  test("a newer live save supersedes an older queued one, even with an earlier timestamp", async () => {
    const { server, q, ob } = appQueue();
    server.setFail(true);
    await q.save({ ...base, currentTimeSecs: 100, at: 50_000 }); // fails -> queued
    await tick();
    assert.equal((await ob.pending("u1")).length, 1);
    server.setFail(false);
    await q.save({ ...base, currentTimeSecs: 160, at: 20_000 }); // clock went back; newer save succeeds
    await tick();
    assert.equal((await ob.pending("u1")).length, 0, "the stale entry was resolved");
    // Even if it were replayed, it would be skipped.
    const r = await q.replay({ ...base, currentTimeSecs: 100, at: 50_000, session: "current", seq: 1 });
    assert.equal(r.skipped, true);
    assert.equal(server.position, 160);
  });

  test("a later failed save replaces an older queued entry even when its timestamp is smaller", async () => {
    const { server, q, ob } = appQueue();
    server.setFail(true);
    await q.save({ ...base, currentTimeSecs: 100, at: 50_000 });
    await tick();
    await q.save({ ...base, currentTimeSecs: 160, at: 20_000 }); // clock went back
    await tick();
    const [e] = await ob.pending("u1");
    assert.equal(e.currentTimeSecs, 160, "the outbox kept the later-created update");
  });

  test("completion, then an older playback update: completion is never undone and the older position is not sent", async () => {
    const { server, q } = appQueue();
    await q.save({ ...base, currentTimeSecs: 300, at: 10_000 });
    assert.equal((await q.complete({ ...base, currentTimeSecs: 0, watchPercentage: 100, noPosition: true, at: 11_000 })).ok, true);
    // An older playback update arrives afterwards (e.g. from the outbox).
    const r = await q.replay({ ...base, currentTimeSecs: 120, at: 9_000, session: "current", seq: 0 });
    assert.equal(r.skipped, true);
    assert.equal(server.completed, true);
    assert.equal(server.position, 300);
    // A later playback save (clock moved back) still carries the completion.
    await q.save({ ...base, currentTimeSecs: 30, at: 1_000 });
    assert.equal(server.accepted[server.accepted.length - 1].completed, true);
    assert.equal(server.position, 30, "a genuinely later position (start over) is applied");
  });

  test("a completion merged with an older queued position keeps that position's order", async () => {
    const { q, ob } = appQueue();
    const p = q.stamp({ ...base, currentTimeSecs: 100, at: 10_000 }); // P (seq 1): queued position
    const s = q.stamp({ ...base, currentTimeSecs: 200, at: 20_000 }); // S (seq 2): saved later, no completion
    const c = q.stamp({ ...base, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true, at: 30_000 }); // C (seq 3)
    await ob.put(p);
    await ob.put(c); // merged: C's completion + P's position, ordered as P
    let [e] = await ob.pending("u1");
    assert.deepEqual([e.completed, e.currentTimeSecs, e.seq], [true, 100, 1]);
    await ob.resolve(s); // S saved this lesson later, without the completion
    [e] = await ob.pending("u1");
    assert.equal(e.completed, true, "completion still queued");
    assert.equal(e.noPosition, true, "P's older position is dropped: S was saved after it");
  });

  test("a save made after a requested completion carries it, so its success also clears the queued completion", async () => {
    const { server, q, ob } = appQueue();
    server.setFail(true);
    await q.save({ ...base, currentTimeSecs: 100, at: 10_000 });
    await tick();
    const c = q.stamp({ ...base, currentTimeSecs: 0, watchPercentage: 100, completed: true, noPosition: true, at: 30_000 });
    assert.equal((await q.complete(c)).ok, false);
    await ob.put(c);
    server.setFail(false);
    await q.save({ ...base, currentTimeSecs: 200, at: 20_000 }); // clock went back
    await tick();
    assert.equal(server.completed, true);
    assert.equal(server.position, 200);
    assert.equal((await ob.pending("u1")).length, 0);
  });

  test("entries from an earlier session are older than anything created now, whatever their timestamps", async () => {
    const earlier = { ...base, currentTimeSecs: 900, at: 9_999_999_999_999, session: "previous", seq: 7 };
    assert.equal(isNewerUpdate({ at: 1, session: "current", seq: 1 }, earlier, "current"), true);
    assert.equal(isNewerUpdate(earlier, { at: 1, session: "current", seq: 1 }, "current"), false);
    // Entries saved by older app versions have no session at all.
    assert.equal(isNewerUpdate({ at: 1, session: "current", seq: 1 }, { at: 5e12 }, "current"), true);
    // Two earlier-session entries: by timestamp (nothing better is known).
    assert.equal(isNewerUpdate({ at: 2, session: "a" }, { at: 1, session: "b" }, "current"), true);

    const { server, q } = appQueue();
    // Without a newer save in this session, the earlier-session entry is delivered.
    assert.equal((await q.replay(earlier)).skipped, undefined);
    assert.equal(server.position, 900);
    // After a save in this session (clock far behind), the old entry is stale.
    await q.save({ ...base, currentTimeSecs: 950, at: 1 });
    assert.equal((await q.replay(earlier)).skipped, true);
    assert.equal(server.position, 950);
  });

  test("app restart: hydrated entries keep their order; the new session's updates are newer", async () => {
    const store = memStore();
    // Session A (clock ahead) queues an update, then the app is killed.
    const a = appQueue(recordingServer(), store, "session-A");
    a.server.setFail(true);
    await a.q.save({ ...base, currentTimeSecs: 500, at: 8_000_000 });
    await tick();
    const [stored] = await a.ob.pending("u1");
    assert.equal(stored.session, "session-A");
    assert.equal(stored.seq, 1);

    // Session B: a new process (new queue + outbox on the same storage), clock corrected backwards.
    const b = appQueue(recordingServer(), store, "session-B");
    const [hydrated] = await b.ob.pending("u1");
    assert.deepEqual([hydrated.session, hydrated.seq, hydrated.currentTimeSecs], ["session-A", 1, 500]);
    // B's first save fails: it replaces A's entry although its timestamp is smaller.
    b.server.setFail(true);
    await b.q.save({ ...base, currentTimeSecs: 520, at: 1_000 });
    await tick();
    const [merged] = await b.ob.pending("u1");
    assert.deepEqual([merged.session, merged.currentTimeSecs], ["session-B", 520]);
    assert.equal(merged.seq, 1, "B's numbering restarts at 1 without being confused with A's");
  });

  test("app restart: a successful save in the new session resolves the previous session's entry", async () => {
    const store = memStore();
    const a = appQueue(recordingServer(), store, "session-A");
    a.server.setFail(true);
    await a.q.save({ ...base, currentTimeSecs: 500, at: 8_000_000 });
    await tick();
    const b = appQueue(recordingServer(), store, "session-B");
    await b.q.save({ ...base, currentTimeSecs: 520, at: 1_000 });
    await tick();
    assert.equal((await b.ob.pending("u1")).length, 0);
  });

  test("production wiring: the app's outbox uses the queue's order; completions are stamped once", () => {
    const ps = strip(read("lib/progressStorage.ts"));
    assert.match(ps, /\{ isNewer: \(a, b\) => lessonWrites\.isNewer\(a, b\) \},/);
    assert.match(ps, /const completion = lessonWrites\.stamp\(\{/);
    assert.match(ps, /await progressOutbox\.put\(completion\)\.catch/);
    const q = strip(read("lib/lessonWriteQueue.ts"));
    assert.doesNotMatch(q, /savedAt/, "no wall-clock ordering state left");
    assert.match(q, /return st\.saved !== null && !newer\(u, st\.saved\);/);
  });
});
