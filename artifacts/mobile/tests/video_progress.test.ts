// Video / progress / offline fixes: M-17, M-18, M-20, M-21, M-23.
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProgressOutbox, MAX_AGE_MS } from "../lib/progressOutbox.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

function memStore() {
  let v: string | null = null;
  return { get: async () => v, set: async (x: string) => { v = x; }, peek: () => v };
}
const U = "user-1";

describe("M-17 progress outbox", () => {
  test("keeps only the newest update per lesson", async () => {
    let t = 1000;
    const ob = createProgressOutbox(memStore(), () => t);
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 30, watchPercentage: 10 });
    t = 2000;
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 90, watchPercentage: 30 });
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 20, watchPercentage: 5, at: 1500 }); // older, ignored
    const p = await ob.pending(U);
    assert.equal(p.length, 1);
    assert.equal(p[0].currentTimeSecs, 90);
  });

  test("flush sends and removes only successes; failures stay queued", async () => {
    const ob = createProgressOutbox(memStore());
    await ob.put({ userId: U, courseId: 1, lessonId: 10, currentTimeSecs: 30, watchPercentage: 10 });
    await ob.put({ userId: U, courseId: 1, lessonId: 11, currentTimeSecs: 40, watchPercentage: 20 });
    const sent = await ob.flush(U, async (u) => u.lessonId === 10);
    assert.equal(sent, 1);
    const left = await ob.pending(U);
    assert.deepEqual(left.map((x) => x.lessonId), [11]);
    assert.equal(await ob.flush(U, async () => { throw new Error("offline"); }), 0);
    assert.equal((await ob.pending(U)).length, 1);
  });

  test("updates are scoped per user", async () => {
    const ob = createProgressOutbox(memStore());
    await ob.put({ userId: "a", courseId: 1, lessonId: 1, currentTimeSecs: 5, watchPercentage: 1 });
    await ob.put({ userId: "b", courseId: 1, lessonId: 1, currentTimeSecs: 6, watchPercentage: 2 });
    const sentFor: string[] = [];
    await ob.flush("a", async (u) => { sentFor.push(u.userId); return true; });
    assert.deepEqual(sentFor, ["a"]);
    assert.equal((await ob.pending("b")).length, 1);
  });

  test("entries older than MAX_AGE are dropped", async () => {
    let t = 0;
    const ob = createProgressOutbox(memStore(), () => t);
    await ob.put({ userId: U, courseId: 1, lessonId: 1, currentTimeSecs: 5, watchPercentage: 1 });
    t = MAX_AGE_MS + 10;
    await ob.put({ userId: U, courseId: 1, lessonId: 2, currentTimeSecs: 5, watchPercentage: 1 });
    assert.deepEqual((await ob.pending(U)).map((x) => x.lessonId), [2]);
  });

  test("concurrent puts are not lost", async () => {
    const ob = createProgressOutbox(memStore());
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      ob.put({ userId: U, courseId: 1, lessonId: i, currentTimeSecs: i, watchPercentage: i })));
    assert.equal((await ob.pending(U)).length, 20);
  });

  test("failed upserts go to the outbox; it is flushed on login/foreground/reconnect", () => {
    const ps = strip(read("lib/progressStorage.ts"));
    // 2026-11-13 (review M1): failed playback saves are queued by the lesson write queue.
    assert.match(ps, /onFailed: \(u, kind\) => \{[\s\S]*?if \(kind === 'save'\) progressOutbox\.put\(u\)/);
    assert.match(ps, /export async function flushPendingProgress/);
    const gate = strip(read("components/AppGate.tsx"));
    assert.match(gate, /flushPendingProgress\(uid\)/);
    assert.match(gate, /addReconnectListener\(flush\)/);
  });

  test("player saves on pause, background and unmount", () => {
    const v = strip(read("components/VideoPlayerEnhanced.tsx"));
    // pause-save now flows: playingChange → tracker.onPlaying → fx.save → onProgressUpdate
    assert.match(v, /applyEffects\(tracker\.onPlaying\(playingNow\)\);/);
    assert.match(v, /if \(fx\.save\) onProgressUpdateRef\.current\?\.\(fx\.save\.t, fx\.save\.d\);/);
    assert.match(v, /AppState\.addEventListener\("change", \(s\) => \{ if \(s !== "active"\) save\(\); \}\);\s*return \(\) => \{ sub\.remove\(\); save\(\); \};/);
  });
});

describe("M-18 / M-20 / M-21 player", () => {
  const v = strip(read("components/VideoPlayerEnhanced.tsx"));
  test("late resume position is applied once (M-18)", () => {
    assert.match(v, /appliedInitialRef\.current === initialTime/);
    assert.match(v, /else resumeAfterReplaceRef\.current = initialTime;/);
    const l = strip(read("app/course/learn.tsx"));
    assert.match(l, /startOverLessonId === activeModuleId \? 0 :/);
  });
  test("M-20: event-driven, no polling of the player", () => {
    for (const ev of ["timeUpdate", "playingChange", "statusChange", "sourceLoad", "mutedChange", "volumeChange"]) {
      assert.match(v, new RegExp(`player\\.addListener\\("${ev}"`), ev);
    }
    assert.match(v, /player\.timeUpdateEventInterval = 0\.5;/);
    // the only interval left is the 1 s stall watchdog, which reads a ref and never the player
    const intervals = v.match(/setInterval\(/g) ?? [];
    assert.equal(intervals.length, 1, "only the stall watchdog interval may remain");
    assert.match(v, /const watchdog = setInterval\(\(\) => \{\s*if \(loadingSince\.current !== null/);
    assert.ok(!/player\.currentTime;\s*\n\s*const durationT = player\.duration;/.test(v), "no per-tick player reads");
    assert.match(v, /subs\.forEach\(\(sub\) => sub\.remove\(\)\);\s*clearInterval\(watchdog\);/, "listeners cleaned up");
  });
  test("M-20: no production diagnostics logging", () => {
    assert.ok(!/console\.warn\("\[VideoPlayer\]\[DIAG\]/.test(read("components/VideoPlayerEnhanced.tsx")));
  });
  test("orientation returns to portrait, never unlocked (M-21)", () => {
    assert.ok(!/unlockAsync\(/.test(v), "unlockAsync must not be used");
    assert.equal((v.match(/OrientationLock\.PORTRAIT_UP/g) ?? []).length >= 3, true);
  });
});

describe("M-23 offline course structure", () => {
  const s = strip(read("services/courseDataProvider.ts"));
  test("network failure falls back to the per-user cache, else throws (no silent empty course)", () => {
    assert.ok(!/apiClient\.get<any>\('\/modules'\)\.catch\(\(\) => \[\]\)/.test(s));
    assert.match(s, /const cached = await readCourseStructure\(courseId\);\s*if \(cached\) return cached;/);
    assert.match(s, /throw err;/);
  });
  test("raw video URLs are never cached", () => {
    assert.match(s, /video_url: l\.video_url \? PROTECTED_VIDEO_MARKER : ''/);
  });
  test("cache is per user and cleared on logout", () => {
    assert.match(s, /`\$\{STRUCTURE_PREFIX\}\$\{courseId\}::\$\{owner\}`/);
    assert.match(strip(read("context/AuthContext.tsx")), /clearCourseStructureCache\(\)/);
  });
});
