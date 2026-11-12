/**
 * Playback progress decisions (fix M-20, 2026-11-10). Pure and unit-tested.
 *
 * VideoPlayerEnhanced now reacts to expo-video events (timeUpdate,
 * playingChange, statusChange, ...) instead of polling the player. This
 * tracker holds the rules that used to live inside the polling loop:
 *  - save progress at most every SAVE_EVERY_MS while playing;
 *  - save immediately when playback pauses (M-17);
 *  - report completion once, when the position reaches COMPLETE_AT (90%);
 *  - only push a new displayed time when it changes at DISPLAY_STEP_S resolution.
 */
export const SAVE_EVERY_MS = 5000;
export const COMPLETE_AT = 0.9;
export const DISPLAY_STEP_S = 0.25;

export interface PlaybackEffects {
  save?: { t: number; d: number };
  complete?: true;
  displayTime?: number;
}

export function createPlaybackTracker(now: () => number = () => Date.now()) {
  let lastSave = 0;
  let completed = false;
  let playing = false;
  let shown = -1;
  let pos = { t: 0, d: 0 };

  function onTime(t: number, d: number): PlaybackEffects {
    const fx: PlaybackEffects = {};
    const time = Number.isFinite(t) && t > 0 ? t : 0;
    const dur = Number.isFinite(d) && d > 0 ? d : pos.d;
    pos = { t: time, d: dur };
    const step = Math.floor(time / DISPLAY_STEP_S) * DISPLAY_STEP_S;
    if (step !== shown) { shown = step; fx.displayTime = time; }
    if (playing && now() - lastSave >= SAVE_EVERY_MS) { lastSave = now(); fx.save = { ...pos }; }
    if (!completed && dur > 0 && time / dur >= COMPLETE_AT) { completed = true; fx.complete = true; }
    return fx;
  }

  function onPlaying(isPlaying: boolean): PlaybackEffects {
    const fx: PlaybackEffects = {};
    const wasPlaying = playing;
    playing = isPlaying;
    if (wasPlaying && !isPlaying && pos.t > 0) { lastSave = now(); fx.save = { ...pos }; }
    return fx;
  }

  return {
    onTime,
    onPlaying,
    setDuration(d: number) { if (Number.isFinite(d) && d > 0) pos = { ...pos, d }; },
    /** New source (lesson switch or signed-URL refresh): start a fresh completion cycle. */
    reset(opts: { keepCompletion?: boolean } = {}) {
      lastSave = 0; playing = false; shown = -1; pos = { t: 0, d: 0 };
      if (!opts.keepCompletion) completed = false;
    },
    get position() { return pos; },
    get isPlaying() { return playing; },
  };
}
