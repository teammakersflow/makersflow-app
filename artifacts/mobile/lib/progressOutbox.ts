/**
 * Persistent outbox for lesson-progress updates (fix M-17, 2026-11-10).
 * Pure core with injected storage, unit-tested in tests/video_progress.test.ts.
 *
 * - Failed updates (offline, timeouts, 5xx) are kept, only the newest per lesson.
 * - flush() re-sends them, for example on reconnect or app foreground, and
 *   removes each entry only after it was sent successfully.
 * - Entries are scoped to the user and dropped when they are older than MAX_AGE_MS.
 *
 * 2026-11-13 (review M4/M5):
 * - resolve() drops (or trims) an entry once a newer update for that lesson
 *   was saved, so an old queued position is never replayed over a newer one
 *   and a synced completion does not stay queued.
 * - flushPaced() is single-flight per user, sends oldest first with spacing
 *   and a per-run cap, stops at once when told to (HTTP 429, account change),
 *   and does not hold the storage lock while sending (live saves are never
 *   blocked behind a flush). An entry is removed only if it was not changed
 *   while it was being sent.
 */
export interface ProgressUpdate {
  userId: string;
  courseId: string | number;
  lessonId: string | number;
  currentTimeSecs: number;
  watchPercentage: number;
  at: number; // epoch ms when recorded
  /**
   * Clock fix (2026-11-13): the app session that created the entry and its
   * creation order in that session. Optional: entries saved by older app
   * versions have neither and count as coming from an earlier session.
   */
  session?: string;
  seq?: number;
  /**
   * Manual "Mark complete" (2026-11-13). Sticky: once an entry for a lesson is
   * a completion it stays one when newer playback updates are merged in, so a
   * queued completion is never lost.
   */
  completed?: boolean;
  /**
   * The entry carries no playback position (a completion recorded without
   * one). Replays must not overwrite the stored position or time spent.
   */
  noPosition?: boolean;
}

export interface OutboxStorage {
  get(): Promise<string | null>;
  set(v: string): Promise<void>;
}

export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 200;

/** Result of sending one entry during a flush. "stop": keep it and end this flush now. */
export type FlushSendResult = boolean | "stop";

export interface FlushOptions {
  /** At most this many sends per flush (default: no limit). */
  maxSends?: number;
  /** Wait between two sends (default 0). */
  spacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Checked before every send; false ends the flush (e.g. the account changed). */
  shouldContinue?: () => boolean;
}

export interface FlushReport {
  sent: number;
  failed: number;
  /** Entries of this user still queued afterwards. */
  remaining: number;
  /** Ended early: a send returned "stop" or shouldContinue() was false. */
  stopped: boolean;
  /** Ended because maxSends was reached while entries were left. */
  capped: boolean;
}

const sameEntry = (a: ProgressUpdate | undefined, b: ProgressUpdate) =>
  !!a && a.at === b.at && a.session === b.session && a.seq === b.seq &&
  !!a.completed === !!b.completed && !!a.noPosition === !!b.noPosition &&
  a.currentTimeSecs === b.currentTimeSecs && a.watchPercentage === b.watchPercentage;

export interface OutboxOptions {
  /**
   * Is `a` newer than `b`? The app passes the write queue's session-aware
   * order (lib/lessonWriteQueue.ts isNewerUpdate), so merging and resolving
   * do not depend on the device clock within a session. Default: by `at`.
   */
  isNewer?: (a: ProgressUpdate, b: ProgressUpdate) => boolean;
}

const keyOf = (u: Pick<ProgressUpdate, "userId" | "courseId" | "lessonId">) => `${u.userId}:${u.courseId}:${u.lessonId}`;

export function createProgressOutbox(
  storage: OutboxStorage,
  now: () => number = () => Date.now(),
  options: OutboxOptions = {},
) {
  const isNewer = options.isNewer ?? ((a: ProgressUpdate, b: ProgressUpdate) => a.at > b.at);
  let chain: Promise<unknown> = Promise.resolve();
  // Serialise read-modify-write so concurrent puts never lose an update.
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<Record<string, ProgressUpdate>> {
    try {
      const raw = await storage.get();
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  async function save(map: Record<string, ProgressUpdate>) {
    const entries = Object.entries(map)
      .filter(([, u]) => now() - u.at <= MAX_AGE_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    await storage.set(JSON.stringify(Object.fromEntries(entries)));
  }

  // One flush at a time per user; a second call joins the running one.
  const flushing = new Map<string, Promise<FlushReport>>();

  function flushPaced(
    userId: string,
    send: (u: ProgressUpdate) => Promise<FlushSendResult>,
    opts: FlushOptions = {},
  ): Promise<FlushReport> {
    const running = flushing.get(userId);
    if (running) return running;
    const p = runFlush(userId, send, opts).finally(() => {
      if (flushing.get(userId) === p) flushing.delete(userId);
    });
    flushing.set(userId, p);
    return p;
  }

  async function runFlush(
    userId: string,
    send: (u: ProgressUpdate) => Promise<FlushSendResult>,
    opts: FlushOptions,
  ): Promise<FlushReport> {
    const maxSends = opts.maxSends ?? Infinity;
    const spacingMs = opts.spacingMs ?? 0;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const report: FlushReport = { sent: 0, failed: 0, remaining: 0, stopped: false, capped: false };
    const snapshot = await serial(async () =>
      Object.values(await load())
        .filter((u) => u.userId === userId)
        .sort((a, b) => a.at - b.at),
    );
    let attempts = 0;
    for (const u of snapshot) {
      if (attempts >= maxSends) { report.capped = true; break; }
      if (opts.shouldContinue && !opts.shouldContinue()) { report.stopped = true; break; }
      if (attempts > 0 && spacingMs > 0) {
        await sleep(spacingMs);
        if (opts.shouldContinue && !opts.shouldContinue()) { report.stopped = true; break; }
      }
      attempts++;
      let r: FlushSendResult = false;
      try { r = await send(u); } catch { r = false; }
      if (r === "stop") { report.stopped = true; break; }
      if (r === true) {
        report.sent++;
        await serial(async () => {
          const map = await load();
          // Changed while it was being sent (a newer update was queued): keep that.
          if (sameEntry(map[keyOf(u)], u)) {
            delete map[keyOf(u)];
            await save(map);
          }
        });
      } else {
        report.failed++;
      }
    }
    report.remaining = (await serial(async () => Object.values(await load()).filter((x) => x.userId === userId))).length;
    return report;
  }

  return {
    /**
     * Keep the newest update for this lesson (never move backwards in time).
     * A completion is sticky across merges, and a position-less entry keeps
     * the newest known position.
     */
    put(u: Omit<ProgressUpdate, "at"> & { at?: number }) {
      return serial(async () => {
        const map = await load();
        const entry: ProgressUpdate = { ...u, at: u.at ?? now() };
        const prev = map[keyOf(entry)];
        let next: ProgressUpdate;
        if (!prev) {
          next = entry;
        } else {
          // Ties go to the incoming entry (it was put later).
          const newer = isNewer(prev, entry) ? prev : entry;
          const older = newer === entry ? prev : entry;
          next = { ...newer };
          if (newer.noPosition && !older.noPosition) {
            next.currentTimeSecs = older.currentTimeSecs;
            next.watchPercentage = older.watchPercentage;
            delete next.noPosition;
            // The position is the older update's, so the entry takes that
            // update's order: it must not look newer than saves made after it.
            next.at = older.at;
            if (older.session !== undefined) next.session = older.session; else delete next.session;
            if (older.seq !== undefined) next.seq = older.seq; else delete next.seq;
          }
          if (prev.completed || entry.completed) next.completed = true;
        }
        if (!next.completed) delete next.completed;
        map[keyOf(entry)] = next;
        await save(map);
      });
    },
    pending(userId?: string) {
      return serial(async () => Object.values(await load()).filter((u) => !userId || u.userId === userId));
    },
    /** Send pending updates for `userId`. `send` returns true on success. Returns the number sent. */
    flush(userId: string, send: (u: ProgressUpdate) => Promise<boolean>) {
      return flushPaced(userId, send).then((r) => r.sent);
    },
    flushPaced,
    /**
     * A newer update of this lesson was saved: drop the entry, or keep only
     * the part the save did not cover (a completion, or a newer position).
     */
    resolve(saved: Pick<ProgressUpdate, "userId" | "courseId" | "lessonId" | "at" | "session" | "seq" | "completed" | "noPosition">) {
      return serial(async () => {
        const map = await load();
        const k = keyOf(saved);
        const e = map[k];
        if (!e) return false;
        // The saved update covers the entry's position unless the entry is newer.
        const needPosition = !e.noPosition && (!!saved.noPosition || isNewer(e, saved as ProgressUpdate));
        const needCompletion = !!e.completed && !saved.completed;
        if (!needPosition && !needCompletion) {
          delete map[k];
        } else if (!needPosition && !e.noPosition) {
          map[k] = { ...e, noPosition: true }; // keep only the unsynced completion
        } else if (!needCompletion && e.completed) {
          const { completed: _c, ...rest } = e;
          map[k] = rest; // completion synced; keep the newer position
        } else {
          return false;
        }
        await save(map);
        return true;
      });
    },
    /** Remove every entry for a user (logout). */
    clearUser(userId: string) {
      return serial(async () => {
        const map = await load();
        for (const [k, u] of Object.entries(map)) if (u.userId === userId) delete map[k];
        await save(map);
      });
    },
  };
}

// ── Flush orchestration (2026-11-13, review M5/M6) ──────────────────────────

export const FLUSH_SPACING_MS = 3_000;
/**
 * Per flush. The API allows 20 requests / 60 s per endpoint; live playback
 * saves use up to 12 of them, so a flush adds at most 6 and leaves headroom.
 */
export const FLUSH_MAX_SENDS = 6;

export interface ProgressFlushDeps {
  outbox: { flushPaced: ReturnType<typeof createProgressOutbox>["flushPaced"] };
  userId: string;
  /** The account signed in right now (checked before and after every send). */
  currentOwner: () => string | null | undefined;
  /** Sends one entry (through the per-lesson write queue in the app). */
  replay: (u: ProgressUpdate) => Promise<{ ok: boolean; error?: unknown }>;
  isRateLimited: (error: unknown) => boolean;
  /** Retry-After of a 429 error, in ms (null when unknown). */
  retryAfterMs: (error: unknown) => number | null;
  spacingMs?: number;
  maxSends?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProgressFlushReport extends FlushReport {
  /** Set when the flush stopped on HTTP 429. */
  rateLimited: boolean;
  retryAfterMs: number | null;
  /** The signed-in account changed: nothing more was sent for this user. */
  identityChanged: boolean;
}

/**
 * Re-sends one user's queued progress, paced and capped. Stops at once on
 * HTTP 429 (the rest stays queued for after Retry-After) and as soon as the
 * signed-in account is no longer the entries' owner. Entries are never sent
 * for another account: the owner is checked before every send, and the app's
 * send additionally refuses to go out with another account's token
 * (apiClient `expectedUserId`).
 */
export async function runProgressFlush(deps: ProgressFlushDeps): Promise<ProgressFlushReport> {
  const owner = () => String(deps.currentOwner() ?? "");
  let rateLimited = false;
  let retryAfterMs: number | null = null;
  let identityChanged = false;
  const stillOwner = () => {
    if (owner() !== String(deps.userId)) identityChanged = true;
    return !identityChanged;
  };
  const report = await deps.outbox.flushPaced(
    deps.userId,
    async (u) => {
      if (!stillOwner() || String(u.userId) !== String(deps.userId)) return "stop";
      const r = await deps.replay(u);
      if (r.ok) return true;
      if (deps.isRateLimited(r.error)) {
        rateLimited = true;
        retryAfterMs = deps.retryAfterMs(r.error);
        return "stop";
      }
      return stillOwner() ? false : "stop";
    },
    {
      maxSends: deps.maxSends ?? FLUSH_MAX_SENDS,
      spacingMs: deps.spacingMs ?? FLUSH_SPACING_MS,
      sleep: deps.sleep,
      shouldContinue: stillOwner,
    },
  );
  return { ...report, rateLimited, retryAfterMs, identityChanged };
}

/**
 * When to flush again: after Retry-After when rate-limited (bounded to
 * [2 s, 120 s]), after 60 s when the per-flush cap left entries queued,
 * otherwise not at all (foreground / reconnect / sign-in flush as before).
 */
export function nextFlushDelayMs(r: ProgressFlushReport): number | null {
  if (r.identityChanged) return null;
  if (r.rateLimited) return Math.min(120_000, Math.max(2_000, (r.retryAfterMs ?? 30_000) + 1_000));
  if (r.capped && r.remaining > 0) return 60_000;
  return null;
}
