/**
 * Video player UI state (2026-11-15). Pure module with no imports, so node
 * tests can load it directly.
 *
 * Fixes two Android issues:
 * - "Thumbnail but no play button": controls used to auto-hide 2.5 s after
 *   mount even when nothing was playing, and nothing showed them again when
 *   the video became ready. Now they may only auto-hide while the video is
 *   actually playing with no overlay up (shouldAutoHide).
 * - "Controls missing / dead while playing": a fade-out's completion used to
 *   mark the controls hidden even when the fade had been interrupted by a
 *   show (e.g. a buffering playingChange), leaving the overlay visible but
 *   the buttons unmounted and untappable. Every show/hide now gets a token;
 *   only a fade that finished AND is still the latest may commit "hidden".
 */

export const AUTO_HIDE_MS = 2500;
export const FADE_OUT_MS = 350;
export const TAP_FADE_OUT_MS = 100;

export type PlayerStatus = "idle" | "loading" | "readyToPlay" | "error" | string;

export interface PlayerUiInputs {
  status: PlayerStatus;
  isPlaying: boolean;
  hasError: boolean;
  isRetrying: boolean;
  isStalled: boolean;
}

/** The single full-cover overlay shown above the controls (at most one). */
export type PlayerOverlay = "error" | "retrying" | "stalled" | "loading" | "none";

export function activeOverlay(i: PlayerUiInputs): PlayerOverlay {
  if (i.hasError) return "error";
  if (i.isRetrying) return "retrying";
  if (i.status === "loading") return i.isStalled ? "stalled" : "loading";
  return "none";
}

/** Controls may disappear on their own only while the video is really playing. */
export function shouldAutoHide(i: PlayerUiInputs): boolean {
  return i.isPlaying && activeOverlay(i) === "none";
}

/**
 * Height of the inline player box: 16:9 of the available width, capped. The
 * lesson screen sizes its wrapper with this so the player never overflows it
 * (the next views used to cover the bottom controls on screens > ~391 dp).
 */
export function inlinePlayerHeight(width: number, maxHeight = 220): number {
  if (!Number.isFinite(width) || width <= 0) return maxHeight;
  return Math.min(maxHeight, Math.round((width * 9) / 16));
}

export interface ControlsVisibilityDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /**
   * Render a change. For `visible: false`, animate out over `fadeMs`, then
   * call `commitHidden(token, finished)`; only that call actually unmounts
   * the controls.
   */
  render: (visible: boolean, token: number, fadeMs: number) => void;
}

export function createControlsVisibility(deps: ControlsVisibilityDeps) {
  let visible = true;
  let token = 0;
  let timer: unknown = null;
  let held = false;

  const clear = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };

  function scheduleHide(i: PlayerUiInputs) {
    clear();
    if (held || !shouldAutoHide(i)) return;
    const myToken = token;
    timer = deps.setTimer(() => {
      timer = null;
      if (myToken === token) hide(FADE_OUT_MS);
    }, AUTO_HIDE_MS);
  }

  function show(i: PlayerUiInputs) {
    token += 1;
    visible = true;
    deps.render(true, token, 0);
    scheduleHide(i);
  }

  function hide(fadeMs: number) {
    clear();
    token += 1;
    visible = false;
    deps.render(false, token, fadeMs);
  }

  return {
    isVisible: () => visible,
    currentToken: () => token,
    /** Show now; auto-hide later only if playing. */
    show,
    /** Single tap on the video: toggle. */
    toggle(i: PlayerUiInputs) {
      if (visible) hide(TAP_FADE_OUT_MS);
      else show(i);
    },
    /**
     * Playback state changed (ready, playing, paused, buffering, error...).
     * If the controls must stay up, show them; if they are up and may
     * auto-hide, (re)start the timer.
     */
    update(i: PlayerUiInputs) {
      if (!shouldAutoHide(i)) {
        if (!visible) show(i);
        else clear();
        return;
      }
      if (visible) scheduleHide(i);
    },
    /** Keep the controls up while the user drags the slider. */
    hold(i: PlayerUiInputs) {
      held = true;
      if (!visible) show(i);
      clear();
    },
    release(i: PlayerUiInputs) {
      held = false;
      show(i);
    },
    /** The fade for `t` ended. True when the controls should really unmount. */
    commitHidden(t: number, finished: boolean): boolean {
      return finished && t === token && !visible;
    },
    dispose() {
      clear();
      token += 1;
    },
  };
}

// ── Taps on the video surface (2026-11-15, touch-controls fix) ──────────────

export const DOUBLE_TAP_MS = 300;
/**
 * Two press events closer than this cannot come from two human taps. They are
 * one tap delivered twice (e.g. once by React Native's root and once by
 * expo-video's native view, which re-dispatches touches it receives), and
 * must not be mistaken for a double tap that seeks instead of showing the
 * controls.
 */
export const DUPLICATE_TAP_MS = 60;

export type TapSide = "left" | "right";

export interface TapClassifierDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  /** A single tap (no second tap followed within DOUBLE_TAP_MS). */
  onSingle: () => void;
  /** A double tap on one side of the video. */
  onDouble: (side: TapSide) => void;
}

/**
 * Classifies presses on the video surface: single tap (toggle the controls,
 * after DOUBLE_TAP_MS so a double tap can still be detected) or double tap
 * (seek). Duplicate deliveries of one tap are ignored. cancel() drops a
 * pending single tap (a control button was pressed, or the player unmounts).
 */
export function createTapClassifier(deps: TapClassifierDeps) {
  let lastTapAt = -Infinity;
  let pending: unknown = null;

  const cancel = () => {
    if (pending !== null) deps.clearTimer(pending);
    pending = null;
  };

  return {
    press(side: TapSide) {
      const t = deps.now();
      const gap = t - lastTapAt;
      if (gap < DUPLICATE_TAP_MS) return "duplicate" as const;
      if (pending !== null && gap < DOUBLE_TAP_MS) {
        cancel();
        lastTapAt = -Infinity; // a third tap starts over (no chained doubles)
        deps.onDouble(side);
        return "double" as const;
      }
      cancel();
      lastTapAt = t;
      pending = deps.setTimer(() => {
        pending = null;
        deps.onSingle();
      }, DOUBLE_TAP_MS);
      return "single-pending" as const;
    },
    cancel,
    hasPending: () => pending !== null,
  };
}

/**
 * What the play/pause button does, decided from the player's real state (not
 * React state, which can lag): pause when playing; otherwise play, restarting
 * from 0 when the video is at (or within 0.5 s of) its end.
 */
export function playPauseAction(playing: boolean, currentTime: number, duration: number): "pause" | "play" | "restart" {
  if (playing) return "pause";
  const atEnd = Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime) && currentTime >= duration - 0.5;
  return atEnd ? "restart" : "play";
}

/**
 * Target time for a relative seek, clamped to the video: never before 0 and
 * never past the end (a small margin keeps "forward" from ending the video by
 * accident). Returns null when the seek cannot be done (unknown duration for
 * a forward seek, or invalid input).
 */
export function clampedSeekTarget(current: number, delta: number, duration: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(delta)) return null;
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (delta > 0 && !hasDuration) return null;
  const end = hasDuration ? Math.max(0, duration - 0.5) : Infinity;
  return Math.min(end, Math.max(0, current + delta));
}
