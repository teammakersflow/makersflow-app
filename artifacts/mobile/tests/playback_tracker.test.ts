// M-20 playback tracker (rules formerly inside the polling loop).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPlaybackTracker, SAVE_EVERY_MS } from "../lib/playbackTracker.ts";

describe("M-20 playback tracker", () => {
  test("saves at most every 5 s while playing, never while paused", () => {
    let now = 10_000;
    const t = createPlaybackTracker(() => now);
    t.onPlaying(true);
    assert.ok(t.onTime(1, 100).save, "first tick while playing saves");
    now += 1000;
    assert.equal(t.onTime(2, 100).save, undefined, "throttled");
    now += SAVE_EVERY_MS;
    assert.deepEqual(t.onTime(8, 100).save, { t: 8, d: 100 });
    t.onPlaying(false);
    now += SAVE_EVERY_MS * 3;
    assert.equal(t.onTime(8, 100).save, undefined, "no save while paused");
  });

  test("pausing saves immediately (M-17)", () => {
    const t = createPlaybackTracker(() => 0);
    t.onPlaying(true);
    t.onTime(42, 100);
    assert.deepEqual(t.onPlaying(false).save, { t: 42, d: 100 });
    assert.equal(t.onPlaying(false).save, undefined, "already paused: no duplicate save");
  });

  test("completion fires exactly once at 90%", () => {
    const t = createPlaybackTracker(() => 0);
    assert.equal(t.onTime(89, 100).complete, undefined);
    assert.equal(t.onTime(90, 100).complete, true);
    assert.equal(t.onTime(95, 100).complete, undefined, "only once");
  });

  test("reset starts a new completion cycle for a new source", () => {
    const t = createPlaybackTracker(() => 0);
    t.onTime(95, 100);
    t.reset();
    assert.equal(t.onTime(5, 50).complete, undefined, "old position must not complete the new lesson");
    assert.equal(t.onTime(46, 50).complete, true);
  });

  test("display time updates only on 0.25 s steps", () => {
    const t = createPlaybackTracker(() => 0);
    assert.equal(t.onTime(1.0, 10).displayTime, 1.0);
    assert.equal(t.onTime(1.1, 10).displayTime, undefined);
    assert.equal(t.onTime(1.26, 10).displayTime, 1.26);
  });

  test("invalid times and unknown duration are safe", () => {
    const t = createPlaybackTracker(() => 0);
    assert.doesNotThrow(() => t.onTime(NaN, NaN));
    assert.equal(t.onTime(50, 0).complete, undefined, "no completion without a duration");
    t.setDuration(60);
    assert.equal(t.onTime(55, 0).complete, true, "duration from sourceLoad is used");
  });
});
