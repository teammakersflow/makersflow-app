/**
 * One completion request per lesson at a time (2026-11-13).
 *
 * Shared by the "Mark Lesson Complete" button and the player's automatic
 * completion at 90% watched (lib/playbackTracker.ts), and kept at module level
 * so it survives the lesson screen being closed and reopened:
 * - rapid repeated taps send ONE completion request (later taps join it);
 * - a tap while the automatic completion is being sent (or the reverse)
 *   joins the request already in flight instead of sending a second write;
 * - a lesson the backend already reports as completed sends nothing;
 * - once a request settles (success OR failure) the lesson can be completed
 *   again, so a failed attempt can be retried.
 *
 * Review M3: everyone waiting on a request gets the same ticket. The
 * follow-up work (course completion, certificate) must run once, so it is
 * done only by the caller that claim()s the ticket. A reopened screen can
 * see a request still in flight (inFlight) or a finished one nobody claimed
 * (unclaimed). Keys include the user id, so accounts never share state.
 *
 * Also: per-lesson automatic re-send after HTTP 429 (review M2).
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export const ALREADY_COMPLETE = "already_complete" as const;

export interface CompletionTicket<T> {
  readonly value: T;
  /** True for the first caller only: that caller does the follow-up work. */
  claim(): boolean;
}

export interface LessonCompletionGuard {
  /**
   * Runs `task` for `key` unless a run for the same key is still in flight
   * (its ticket is returned instead) or `isAlreadyComplete()` is true
   * (resolves to ALREADY_COMPLETE without calling `task`). Decided
   * synchronously, before any await, so taps in the same frame are deduped.
   * A rejected task rejects every waiter and leaves nothing in flight.
   */
  run<T>(
    key: string,
    isAlreadyComplete: () => boolean,
    task: () => Promise<T>,
  ): Promise<CompletionTicket<T> | typeof ALREADY_COMPLETE>;
  isInFlight(key: string): boolean;
  /** The ticket promise of a request still running for `key`. */
  inFlight<T = unknown>(key: string): Promise<CompletionTicket<T>> | undefined;
  /** A finished request for `key` whose ticket nobody has claimed yet. */
  unclaimed<T = unknown>(key: string): CompletionTicket<T> | undefined;
}

export function lessonCompletionKey(
  userId: string | number,
  courseId: string | number,
  lessonId: string | number,
): string {
  return `${userId}:${Number(courseId)}:${Number(lessonId)}`;
}

export function createLessonCompletionGuard(): LessonCompletionGuard {
  const running = new Map<string, Promise<CompletionTicket<any>>>();
  const settled = new Map<string, CompletionTicket<any>>();

  return {
    run(key, isAlreadyComplete, task) {
      const existing = running.get(key);
      if (existing) return existing;
      if (isAlreadyComplete()) return Promise.resolve(ALREADY_COMPLETE);
      settled.delete(key); // an older unclaimed result is superseded
      const p: Promise<CompletionTicket<any>> = Promise.resolve()
        .then(task)
        .then((value) => {
          let claimed = false;
          const ticket: CompletionTicket<any> = {
            value,
            claim() {
              if (claimed) return false;
              claimed = true;
              if (settled.get(key) === ticket) settled.delete(key);
              return true;
            },
          };
          settled.set(key, ticket);
          return ticket;
        })
        .finally(() => {
          if (running.get(key) === p) running.delete(key);
        });
      running.set(key, p);
      return p;
    },
    isInFlight: (key) => running.has(key),
    inFlight: (key) => running.get(key),
    unclaimed: (key) => settled.get(key),
  };
}

/**
 * When an automatic re-send of a queued completion may run after HTTP 429:
 * the server's Retry-After (plus a little slack), bounded to [2 s, 120 s].
 * Null after `maxAttempts`, so it never retries forever.
 */
export function completionRetryDelayMs(
  retryAfterMs: number | null,
  attempt: number,
  maxAttempts = 3,
): number | null {
  if (attempt >= maxAttempts) return null;
  const base = retryAfterMs ?? 30_000 * 2 ** attempt;
  return Math.min(120_000, Math.max(2_000, base + 1_000));
}

export interface RetrySchedulerDeps {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  maxAutoAttempts?: number;
}

/**
 * Review M2: automatic re-sends of completions queued after HTTP 429, one
 * independent timer per key (user + course + lesson):
 * - one lesson never cancels another lesson's retry;
 * - only a retry that actually fires counts as an attempt (at most
 *   maxAutoAttempts per key); a manual tap during the cooldown does not;
 * - a new Retry-After can only move a pending retry later, never earlier;
 * - succeeded()/cancel() clear a key; cancelAll() on unmount or sign-out.
 */
export function createCompletionRetryScheduler(deps: RetrySchedulerDeps = {}) {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as any));
  const now = deps.now ?? (() => Date.now());
  const maxAutoAttempts = deps.maxAutoAttempts ?? 3;
  const timers = new Map<string, { handle: unknown; fireAt: number }>();
  const fired = new Map<string, number>();

  function cancel(key: string) {
    const t = timers.get(key);
    if (t) clearTimer(t.handle);
    timers.delete(key);
  }

  return {
    /** Returns the delay until the (possibly existing) retry, or null when exhausted. */
    schedule(key: string, retryAfterMs: number | null, run: () => void): number | null {
      const attempts = fired.get(key) ?? 0;
      const delay = completionRetryDelayMs(retryAfterMs, attempts, maxAutoAttempts);
      if (delay == null) return null;
      const fireAt = now() + delay;
      const existing = timers.get(key);
      if (existing && existing.fireAt >= fireAt) return existing.fireAt - now();
      cancel(key);
      const handle = setTimer(() => {
        if (timers.get(key)?.handle !== handle) return;
        timers.delete(key);
        fired.set(key, (fired.get(key) ?? 0) + 1);
        run();
      }, delay);
      timers.set(key, { handle, fireAt });
      return delay;
    },
    succeeded(key: string) {
      cancel(key);
      fired.delete(key);
    },
    cancel,
    cancelAll() {
      for (const key of Array.from(timers.keys())) cancel(key);
    },
    pendingKeys: () => Array.from(timers.keys()),
    attemptsFired: (key: string) => fired.get(key) ?? 0,
  };
}
