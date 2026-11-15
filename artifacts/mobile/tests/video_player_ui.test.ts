// Android video player: missing play button / missing controls (2026-11-15).
// Runtime tests drive the production state module (lib/videoPlayerUi.ts) with
// fake timers and a fake animation layer; wiring into VideoPlayerEnhanced and
// the lesson screen is checked on the source (React Native views cannot run
// under node).
// Run: node --test artifacts/mobile/tests/*.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_HIDE_MS,
  FADE_OUT_MS,
  TAP_FADE_OUT_MS,
  DOUBLE_TAP_MS,
  DUPLICATE_TAP_MS,
  activeOverlay,
  clampedSeekTarget,
  createControlsVisibility,
  createTapClassifier,
  inlinePlayerHeight,
  playPauseAction,
  shouldAutoHide,
  type PlayerUiInputs,
  type TapSide,
} from "../lib/videoPlayerUi.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*$/gm, "");

const base: PlayerUiInputs = { status: "idle", isPlaying: false, hasError: false, isRetrying: false, isStalled: false };
const ui = (over: Partial<PlayerUiInputs> = {}): PlayerUiInputs => ({ ...base, ...over });

/**
 * The controller with fake timers and a fake fade: `fades` holds running
 * fade-outs; finishFades() completes them (finished=true), and a show()
 * interrupts them (finished=false), as React Native's Animated does.
 */
function harness() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const fades: Array<{ token: number; done: boolean }> = [];
  let mounted = true; // the "showControls" state in the component
  let opacity = 1;
  const c = createControlsVisibility({
    setTimer: (fn, ms) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; },
    clearTimer: (h: any) => { h.live = false; },
    render: (visible, token) => {
      if (visible) {
        // starting the fade-in stops any running fade-out (finished=false)
        for (const f of fades.filter((x) => !x.done)) { f.done = true; if (c.commitHidden(f.token, false)) mounted = false; }
        mounted = true;
        opacity = 1;
      } else {
        fades.push({ token, done: false });
      }
    },
  });
  return {
    c,
    advance(ms: number) {
      now += ms;
      for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); }
    },
    finishFades() {
      for (const f of fades.filter((x) => !x.done)) {
        f.done = true;
        opacity = 0;
        if (c.commitHidden(f.token, true)) mounted = false;
      }
    },
    /** Buttons rendered and tappable (showControls) and overlay opaque. */
    get usable() { return mounted && opacity === 1; },
    get mounted() { return mounted; },
    liveTimers: () => timers.filter((t) => t.live).length,
  };
}

describe("overlay and auto-hide rules", () => {
  test("one overlay at a time, by priority: error > retrying > stalled > loading", () => {
    assert.equal(activeOverlay(ui()), "none");
    assert.equal(activeOverlay(ui({ status: "loading" })), "loading");
    assert.equal(activeOverlay(ui({ status: "loading", isStalled: true })), "stalled");
    assert.equal(activeOverlay(ui({ status: "loading", isRetrying: true })), "retrying");
    assert.equal(activeOverlay(ui({ status: "error", hasError: true, isRetrying: true })), "error");
    assert.equal(activeOverlay(ui({ status: "readyToPlay" })), "none");
  });

  test("controls may auto-hide only while really playing with no overlay", () => {
    assert.equal(shouldAutoHide(ui({ status: "readyToPlay", isPlaying: true })), true);
    for (const s of [
      ui(), // not started
      ui({ status: "readyToPlay" }), // ready, paused
      ui({ status: "loading", isPlaying: true }), // buffering
      ui({ status: "readyToPlay", isPlaying: true, isRetrying: true }),
      ui({ status: "error", hasError: true }),
    ]) assert.equal(shouldAutoHide(s), false, JSON.stringify(s));
  });

  test("every state leaves the user something to tap (play button or Try again / Reconnect)", () => {
    for (const status of ["idle", "loading", "readyToPlay", "error"]) {
      for (const isPlaying of [false, true]) for (const hasError of [false, true]) for (const isRetrying of [false, true]) for (const isStalled of [false, true]) {
        const i = ui({ status, isPlaying, hasError, isRetrying, isStalled });
        const overlay = activeOverlay(i);
        const actionable =
          overlay === "error" || overlay === "stalled" // Try again / Reconnect buttons
          || overlay === "loading" || overlay === "retrying" // transient: resolves to ready, error or stalled (15 s watchdog)
          || (overlay === "none" && (!shouldAutoHide(i) || isPlaying)); // play button kept, or video playing (tap shows it)
        assert.ok(actionable, JSON.stringify(i));
      }
    }
  });
});

describe("Issue 1: thumbnail visible but no play button", () => {
  test("slow load: controls are still there when the video becomes ready (old code hid them after 2.5 s)", () => {
    const h = harness();
    h.c.update(ui()); // mount: idle, not playing
    h.c.update(ui({ status: "loading" }));
    h.advance(5000); // loading takes 5 s (slow phone / network)
    h.finishFades();
    h.c.update(ui({ status: "readyToPlay" }));
    h.advance(10_000);
    h.finishFades();
    assert.equal(h.usable, true, "play button visible and tappable on the ready frame");
    assert.equal(h.liveTimers(), 0, "no hide timer while paused");
  });

  test("paused controls stay up indefinitely; they auto-hide only after play", () => {
    const h = harness();
    h.c.update(ui({ status: "readyToPlay" }));
    h.advance(60_000);
    h.finishFades();
    assert.equal(h.usable, true);
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    h.advance(AUTO_HIDE_MS - 1);
    assert.equal(h.usable, true, "not before 2.5 s");
    h.advance(1);
    h.finishFades();
    assert.equal(h.mounted, false, "hidden while playing");
  });

  test("pause, end of video or an error brings the controls back by themselves", () => {
    for (const after of [ui({ status: "readyToPlay" }), ui({ status: "error", hasError: true }), ui({ status: "loading" })]) {
      const h = harness();
      h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
      h.advance(AUTO_HIDE_MS);
      h.finishFades();
      assert.equal(h.mounted, false);
      h.c.update(after);
      assert.equal(h.usable, true, JSON.stringify(after));
    }
  });
});

describe("Issue 2: controls missing or dead during playback", () => {
  test("a show that interrupts a fade-out keeps the buttons mounted (old code unmounted them)", () => {
    const h = harness();
    const playing = ui({ status: "readyToPlay", isPlaying: true });
    h.c.update(playing);
    h.advance(AUTO_HIDE_MS); // auto-hide fade starts (350 ms)
    // Before it finishes, buffering flips isPlaying -> controls are shown again.
    h.c.update(ui({ status: "readyToPlay", isPlaying: false }));
    assert.equal(h.usable, true);
    h.finishFades(); // nothing left to finish; a stale completion must not apply
    assert.equal(h.usable, true, "pause / seek buttons still rendered and tappable");
  });

  test("a stale fade completion (finished=true, old token) never hides newer controls", () => {
    const h = harness();
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    h.advance(AUTO_HIDE_MS);
    const staleToken = h.c.currentToken();
    h.c.show(ui({ status: "readyToPlay", isPlaying: true }));
    assert.equal(h.c.commitHidden(staleToken, true), false);
  });

  test("tap toggles; controls can always be brought back after auto-hide", () => {
    const h = harness();
    const playing = ui({ status: "readyToPlay", isPlaying: true });
    h.c.update(playing);
    for (let round = 0; round < 5; round++) {
      h.advance(AUTO_HIDE_MS);
      h.finishFades();
      assert.equal(h.mounted, false, `hidden (round ${round})`);
      h.c.toggle(playing); // tap the video
      assert.equal(h.usable, true, `back after tap (round ${round})`);
    }
    h.c.toggle(playing); // tap again: hide quickly
    h.finishFades();
    assert.equal(h.mounted, false);
  });

  test("a tap during the auto-hide fade does not leave a half-visible, dead overlay", () => {
    const h = harness();
    const playing = ui({ status: "readyToPlay", isPlaying: true });
    h.c.update(playing);
    h.advance(AUTO_HIDE_MS); // fading out
    h.c.toggle(playing); // controls are logically hidden now -> this tap shows them
    h.finishFades();
    assert.equal(h.usable, true);
  });

  test("dragging the slider keeps the controls up, then auto-hide resumes", () => {
    const h = harness();
    const playing = ui({ status: "readyToPlay", isPlaying: true });
    h.c.update(playing);
    h.c.hold(playing);
    h.advance(20_000);
    // Playback events keep arriving during the drag (seek -> buffering -> playing).
    h.c.update(ui({ status: "loading", isPlaying: false }));
    h.c.update(playing);
    h.advance(20_000);
    h.finishFades();
    assert.equal(h.usable, true, "never hidden mid-drag");
    h.c.release(playing);
    h.advance(AUTO_HIDE_MS);
    h.finishFades();
    assert.equal(h.mounted, false);
  });

  test("dispose (unmount / lesson switch) cancels pending hides", () => {
    const h = harness();
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    assert.equal(h.liveTimers(), 1);
    h.c.dispose();
    assert.equal(h.liveTimers(), 0);
  });

  test("inline box never exceeds the lesson screen's 220 dp wrapper", () => {
    // Old: height = width * 9/16 -> 231.75 dp at 412 dp, 270 at 480, 337.5 at 600:
    // the views below the 220 dp wrapper covered the bottom controls.
    for (const w of [320, 360, 391, 392, 393, 412, 480, 600, 800]) {
      const hgt = inlinePlayerHeight(w);
      assert.ok(hgt <= 220, `${w} dp -> ${hgt}`);
      assert.ok(Math.abs(hgt - Math.min(220, (w * 9) / 16)) <= 0.5, `${w} dp keeps 16:9 below the cap`);
    }
    assert.equal(inlinePlayerHeight(0), 220);
    assert.equal(inlinePlayerHeight(NaN), 220);
    // Vertical room for the controls at the smallest common width (320 dp):
    // center 70 dp play button + bottom bar (~74 dp) fit without overlap.
    assert.ok(inlinePlayerHeight(320) - 74 >= 70);
  });
});

describe("player wiring (source)", () => {
  const p = strip(read("components/VideoPlayerEnhanced.tsx"));

  test("both video views use TextureView so the custom controls are always drawn above the video", () => {
    assert.equal((p.match(/surfaceType="textureView"/g) ?? []).length, 2);
    assert.equal((p.match(/nativeControls=\{false\}/g) ?? []).length, 2);
  });

  test("controls follow playback state; no unconditional 2.5 s hide after mount", () => {
    assert.match(p, /useEffect\(\(\) => \{\s*controls\.update\(uiInputs\(\)\);\s*\}, \[isPlaying, lastStatus, hasError, isRetrying, isStalled\]\);/);
    assert.doesNotMatch(p, /useEffect\(\(\) => \{\s*showControlsWithTimer\(\);\s*\}, \[isPlaying\]\);/);
    assert.doesNotMatch(p, /\}, 2500\);/, "no hard-coded hide timer left");
    assert.match(p, /if \(isMounted\.current && controlsRef\.current\?\.commitHidden\(token, finished\)\) setShowControls\(false\);/);
    assert.match(p, /const handleVideoTap = \(\) => \{\s*if \(!isMounted\.current\) return;\s*controls\.toggle\(uiInputs\(\)\);/);
    assert.match(p, /controls\.hold\(uiInputs\(\)\);/);
    assert.match(p, /controls\.release\(uiInputs\(\)\);/);
    assert.match(p, /controls\.dispose\(\);/);
  });

  test("the inline box is sized from its own width and cannot overflow; the top bar only takes space in fullscreen", () => {
    assert.match(p, /style=\{\[styles\.container, \{ height: inlinePlayerHeight\(boxWidth\) \}\]\}/);
    assert.match(p, /<View style=\{isFullscreen \? styles\.topBar : styles\.topBarEmpty\} pointerEvents="auto">/);
    assert.match(p, /container: \{\s*width: "100%",\s*backgroundColor: "#000",\s*position: "relative",\s*overflow: "hidden",/);
    assert.doesNotMatch(p, /aspectRatio: 16 \/ 9/);
  });

  test("touch layering is unchanged: a catcher view sits over the video; the overlay ignores touches only when hidden", () => {
    // 2026-11-15 touch fix: the catcher must be a real native view (see "touch wiring").
    assert.equal((p.match(/<View style=\{StyleSheet\.absoluteFill\} collapsable=\{false\} \/>/g) ?? []).length, 2);
    assert.match(p, /pointerEvents=\{showControls \|\| isScrubbing \? "box-none" : "none"\}/);
    assert.match(p, /\{showControls && \(\s*<View style=\{styles\.centerPlaybackButtons\}>/);
  });

  test("signed URL refresh, retry, 429 handling and progress/completion hooks are untouched", () => {
    assert.match(p, /const freshUrl = await refreshVideoUrlRef\.current\(\);/);
    assert.match(p, /const busy = \(error as any\)\?\.status === 429;/);
    assert.match(p, /const delay = nextRetry === 1 \? 0 : nextRetry === 2 \? 3000 : 10000;/);
    assert.match(p, /if \(fx\.complete\) onCompleteRef\.current\?\.\(\);/);
    assert.match(p, /if \(fx\.save\) onProgressUpdateRef\.current\?\.\(fx\.save\.t, fx\.save\.d\);/);
    assert.match(p, /const sub = AppState\.addEventListener\("change", \(s\) => \{ if \(s !== "active"\) save\(\); \}\);/);
  });

  test("lesson switches remount the player (no stale player state) and keep the completion wiring", () => {
    const learn = strip(read("app/course/learn.tsx"));
    assert.match(learn, /key=\{`local-\$\{activeModule\?\.id\}`\}/);
    assert.match(learn, /key=\{`remote-\$\{activeModule\?\.id\}`\}/);
    assert.equal((learn.match(/onComplete=\{handleVideoComplete\}/g) ?? []).length, 2);
    assert.equal((learn.match(/onProgressUpdate=\{handleProgressUpdate\}/g) ?? []).length, 2);
    assert.match(learn, /onRefreshVideoUrl=\{refreshActiveSignedUrl\}/);
    assert.match(learn, /'Mark Lesson Complete'/);
  });
});

// ── Touch controls (2026-11-15): taps on the video must bring the controls back ──
describe("taps on the video surface", () => {
  function taps() {
    let now = 1_000;
    const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
    const events: string[] = [];
    const c = createTapClassifier({
      now: () => now,
      setTimer: (fn, ms) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; },
      clearTimer: (h: any) => { h.live = false; },
      onSingle: () => events.push("single"),
      onDouble: (side: TapSide) => events.push(`double-${side}`),
    });
    return {
      c,
      events,
      advance(ms: number) {
        now += ms;
        for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.fn(); }
      },
    };
  }

  test("one tap = one single tap (toggles the controls) after the double-tap window", () => {
    const t = taps();
    t.c.press("right");
    t.advance(DOUBLE_TAP_MS - 1);
    assert.deepEqual(t.events, [], "not before the window closes");
    t.advance(1);
    assert.deepEqual(t.events, ["single"]);
  });

  test("ROOT-CAUSE REGRESSION: one tap delivered twice (native + root dispatch) is still a single tap, never a seek", () => {
    for (const gap of [0, 1, 5, 16, 30, DUPLICATE_TAP_MS - 1]) {
      const t = taps();
      t.c.press("right");
      t.advance(gap);
      assert.equal(t.c.press("right"), "duplicate", `gap ${gap} ms`);
      t.advance(DOUBLE_TAP_MS);
      assert.deepEqual(t.events, ["single"], `gap ${gap} ms`);
    }
  });

  test("a real double tap seeks on the tapped side and does not also toggle the controls", () => {
    for (const side of ["left", "right"] as const) {
      const t = taps();
      t.c.press(side);
      t.advance(150);
      assert.equal(t.c.press(side), "double");
      t.advance(1_000);
      assert.deepEqual(t.events, [`double-${side}`]);
    }
  });

  test("taps slower than the window are separate single taps (show, then hide)", () => {
    const t = taps();
    t.c.press("left");
    t.advance(DOUBLE_TAP_MS + 200);
    t.c.press("left");
    t.advance(DOUBLE_TAP_MS);
    assert.deepEqual(t.events, ["single", "single"]);
  });

  test("a third quick tap does not chain into another seek", () => {
    const t = taps();
    t.c.press("right"); t.advance(120);
    t.c.press("right"); t.advance(120); // double
    t.c.press("right"); t.advance(DOUBLE_TAP_MS);
    assert.deepEqual(t.events, ["double-right", "single"]);
  });

  test("pressing a control cancels a pending surface tap (no accidental toggle)", () => {
    const t = taps();
    t.c.press("right");
    t.advance(100);
    t.c.cancel(); // e.g. togglePlayPause / skip / volume
    t.advance(DOUBLE_TAP_MS);
    assert.deepEqual(t.events, []);
    assert.equal(t.c.hasPending(), false);
  });

  test("with the controls hidden during playback, a tap brings them back; a tap while visible hides them", () => {
    const h = harness();
    const t = createTapClassifier({
      now: (() => { let n = 0; return () => (n += 400); })(), // taps 400 ms apart
      setTimer: (fn) => { fn(); return 1; }, // fire the single tap immediately for this check
      clearTimer: () => {},
      onSingle: () => h.c.toggle(ui({ status: "readyToPlay", isPlaying: true })),
      onDouble: () => assert.fail("must not seek"),
    });
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    h.advance(AUTO_HIDE_MS);
    h.finishFades();
    assert.equal(h.mounted, false, "auto-hidden while playing");
    t.press("right");
    assert.equal(h.usable, true, "tap shows the controls");
    t.press("right");
    h.finishFades();
    assert.equal(h.mounted, false, "next tap hides them");
  });
});

describe("control interactions and the auto-hide timer", () => {
  test("every control interaction restarts the timer; controls never hide mid-interaction", () => {
    const h = harness();
    const playing = ui({ status: "readyToPlay", isPlaying: true });
    h.c.update(playing);
    for (let i = 0; i < 6; i++) {
      h.advance(AUTO_HIDE_MS - 500);
      h.c.show(playing); // play/pause, skip, volume, speed, fullscreen all call showControlsWithTimer
    }
    assert.equal(h.usable, true, "kept up while the user keeps interacting");
    assert.equal(h.liveTimers(), 1, "only one hide timer at a time");
    h.advance(AUTO_HIDE_MS);
    h.finishFades();
    assert.equal(h.mounted, false, "hides after the inactivity period");
  });

  test("pausing keeps the controls; resuming restarts the auto-hide", () => {
    const h = harness();
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    h.c.update(ui({ status: "readyToPlay", isPlaying: false }));
    h.advance(60_000);
    assert.equal(h.usable, true);
    assert.equal(h.liveTimers(), 0);
    h.c.update(ui({ status: "readyToPlay", isPlaying: true }));
    assert.equal(h.liveTimers(), 1);
    h.advance(AUTO_HIDE_MS);
    h.finishFades();
    assert.equal(h.mounted, false);
  });
});

describe("10 s seeking", () => {
  test("forward and back by 10 s, clamped to the video", () => {
    assert.equal(clampedSeekTarget(30, 10, 120), 40);
    assert.equal(clampedSeekTarget(30, -10, 120), 20);
    assert.equal(clampedSeekTarget(4, -10, 120), 0, "never before 0");
    assert.equal(clampedSeekTarget(115, 10, 120), 119.5, "never past the end (stays playable)");
    assert.equal(clampedSeekTarget(119.8, 10, 120), 119.5);
    assert.equal(clampedSeekTarget(30, 10, 0), null, "forward needs a known duration");
    assert.equal(clampedSeekTarget(30, -10, NaN), 20, "back works without a duration");
    assert.equal(clampedSeekTarget(NaN, 10, 120), null);
  });
});

describe("touch wiring (source)", () => {
  const p = strip(read("components/VideoPlayerEnhanced.tsx"));

  test("ROOT CAUSE: the tap catchers over both video views are real native views (not flattened)", () => {
    assert.equal((p.match(/<View style=\{StyleSheet\.absoluteFill\} collapsable=\{false\} \/>/g) ?? []).length, 2);
    assert.doesNotMatch(p, /<View style=\{StyleSheet\.absoluteFill\} \/>/);
    // Each catcher sits right after its VideoView, below the controls overlay.
    // (strip() turns the JSX comment above each catcher into "{}")
    assert.equal((p.match(/surfaceType="textureView"\s*\/>\s*(?:\{\}\s*)?<View style=\{StyleSheet\.absoluteFill\} collapsable=\{false\} \/>/g) ?? []).length, 2);
  });

  test("surface presses go through the classifier; controls cancel pending surface taps", () => {
    assert.match(p, /tapClassifier\.press\(/);
    assert.equal((p.match(/tapClassifier\.cancel\(\)/g) ?? []).length >= 4, true, "play/pause, back, forward, volume (+ unmount)");
    assert.doesNotMatch(p, /singleTapTimeout|lastTap\.current/, "old ad-hoc tap timing removed");
  });

  test("actions never wait for haptics; seeks use the player's real position, clamped", () => {
    assert.doesNotMatch(p, /await Haptics\.impactAsync/);
    assert.doesNotMatch(p, /player\.seekBy\(/);
    assert.match(p, /clampedSeekTarget\(Number\(player\.currentTime\), delta, Number\(player\.duration\) \|\| duration\)/);
  });

  test("volume controls count as interactions (timer restart / hold while dragging)", () => {
    assert.match(p, /setShowVolumeBar\(!showVolumeBar\);\s*showControlsWithTimer\(\);/);
    assert.match(p, /onSlidingStart=\{\(\) => controls\.hold\(uiInputs\(\)\)\}/);
    assert.match(p, /onSlidingComplete=\{\(\) => controls\.release\(uiInputs\(\)\)\}/);
  });
});

// ── Focused regressions for the reported OPPO behaviour (2026-11-15) ────────
describe("play/pause decisions", () => {
  test("pause when playing; play when paused; restart when at the end", () => {
    assert.equal(playPauseAction(true, 30, 120), "pause");
    assert.equal(playPauseAction(false, 30, 120), "play");
    assert.equal(playPauseAction(false, 119.6, 120), "restart");
    assert.equal(playPauseAction(false, 120, 120), "restart");
    assert.equal(playPauseAction(true, 120, 120), "pause", "playing always pauses");
    assert.equal(playPauseAction(false, 30, 0), "play", "unknown duration: just play");
    assert.equal(playPauseAction(false, NaN, 120), "play");
  });

  test("the button uses the player's real state, not React state", () => {
    const p = strip(read("components/VideoPlayerEnhanced.tsx"));
    assert.match(p, /const action = playPauseAction\(\s*player\.playing,\s*Number\(player\.currentTime\),\s*Number\(player\.duration\) \|\| duration,\s*\);/);
    assert.doesNotMatch(p, /const isAtEnd = duration > 0/);
  });
});

describe("end to end: surface taps drive the controls (classifier + controller, as wired in the player)", () => {
  /** Real classifier + real controller, fake clock shared by both. */
  function player() {
    let now = 10_000;
    const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
    const setTimer = (fn: () => void, ms: number) => { const t = { at: now + ms, fn, live: true }; timers.push(t); return t; };
    const clearTimer = (h: any) => { h.live = false; };
    let shown = true;
    let state: PlayerUiInputs = ui({ status: "readyToPlay", isPlaying: true });
    let position = 60;
    const seeks: number[] = [];
    const controls = createControlsVisibility({
      setTimer, clearTimer,
      render: (visible, token) => {
        if (visible) shown = true;
        else if (controls.commitHidden(token, true)) shown = false; // fade completes
      },
    });
    const taps = createTapClassifier({
      setTimer, clearTimer, now: () => now,
      onSingle: () => controls.toggle(state),
      onDouble: (side) => {
        const t = clampedSeekTarget(position, side === "left" ? -10 : 10, 300);
        if (t !== null) { seeks.push(t); position = t; }
      },
    });
    const advance = (ms: number) => {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at; next.live = false; next.fn();
      }
      now = end;
    };
    controls.update(state);
    return {
      controls, taps, advance, seeks,
      get shown() { return shown; },
      get position() { return position; },
      setState(s: PlayerUiInputs) { state = s; controls.update(s); },
    };
  }

  test("playing -> auto-hide -> one tap anywhere brings the controls back (centre, left, right)", () => {
    for (const side of ["right", "left", "right"] as const) {
      const p = player();
      p.advance(AUTO_HIDE_MS);
      assert.equal(p.shown, false, "auto-hidden during playback");
      p.taps.press(side);
      p.advance(DOUBLE_TAP_MS);
      assert.equal(p.shown, true, `tap on ${side} shows the controls`);
      assert.deepEqual(p.seeks, [], "no accidental seek");
    }
  });

  test("the same tap delivered twice (the old flattened-catcher path) still shows the controls instead of seeking", () => {
    const p = player();
    p.advance(AUTO_HIDE_MS);
    p.taps.press("right");
    p.advance(8); // second delivery of the same physical tap
    p.taps.press("right");
    p.advance(DOUBLE_TAP_MS);
    assert.equal(p.shown, true);
    assert.deepEqual(p.seeks, []);
    assert.equal(p.position, 60, "video position unchanged");
  });

  test("repeated show/hide cycles stay reliable (no stuck state, one timer)", () => {
    const p = player();
    for (let i = 0; i < 20; i++) {
      p.advance(AUTO_HIDE_MS);
      assert.equal(p.shown, false, `cycle ${i}: hidden`);
      p.taps.press(i % 2 ? "left" : "right");
      p.advance(DOUBLE_TAP_MS);
      assert.equal(p.shown, true, `cycle ${i}: shown`);
    }
  });

  test("controls shown by a tap auto-hide again after inactivity; an interaction pushes that back", () => {
    const p = player();
    p.advance(AUTO_HIDE_MS);
    p.taps.press("right");
    p.advance(DOUBLE_TAP_MS);
    p.advance(AUTO_HIDE_MS - 100);
    assert.equal(p.shown, true);
    p.controls.show(ui({ status: "readyToPlay", isPlaying: true })); // e.g. skip forward pressed
    p.advance(AUTO_HIDE_MS - 100);
    assert.equal(p.shown, true, "timer restarted by the interaction");
    p.advance(200);
    assert.equal(p.shown, false);
  });

  test("double tap seeks 10 s on each side, clamped", () => {
    const p = player();
    p.taps.press("right"); p.advance(100); p.taps.press("right");
    p.advance(DOUBLE_TAP_MS + 10);
    p.taps.press("left"); p.advance(100); p.taps.press("left");
    assert.deepEqual(p.seeks, [70, 60]);
  });

  test("paused: controls stay visible however long; resume restarts auto-hide", () => {
    const p = player();
    p.setState(ui({ status: "readyToPlay", isPlaying: false }));
    p.advance(120_000);
    assert.equal(p.shown, true);
    p.setState(ui({ status: "readyToPlay", isPlaying: true }));
    p.advance(AUTO_HIDE_MS);
    assert.equal(p.shown, false);
  });
});
