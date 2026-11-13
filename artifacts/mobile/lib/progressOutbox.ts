/**
 * Persistent outbox for lesson-progress updates (fix M-17, 2026-11-10).
 * Pure core with injected storage, unit-tested in tests/video_progress.test.ts.
 *
 * - Failed updates (offline, timeouts, 5xx) are kept, only the newest per lesson.
 * - flush() re-sends them, for example on reconnect or app foreground, and
 *   removes each entry only after it was sent successfully.
 * - Entries are scoped to the user and dropped when they are older than MAX_AGE_MS.
 */
export interface ProgressUpdate {
  userId: string;
  courseId: string | number;
  lessonId: string | number;
  currentTimeSecs: number;
  watchPercentage: number;
  at: number; // epoch ms when recorded
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

const keyOf = (u: Pick<ProgressUpdate, "userId" | "courseId" | "lessonId">) => `${u.userId}:${u.courseId}:${u.lessonId}`;

export function createProgressOutbox(storage: OutboxStorage, now: () => number = () => Date.now()) {
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
          const newer = prev.at <= entry.at ? entry : prev;
          const older = newer === entry ? prev : entry;
          next = { ...newer };
          if (newer.noPosition && !older.noPosition) {
            next.currentTimeSecs = older.currentTimeSecs;
            next.watchPercentage = older.watchPercentage;
            delete next.noPosition;
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
      return serial(async () => {
        const map = await load();
        let sent = 0;
        for (const [k, u] of Object.entries(map)) {
          if (u.userId !== userId) continue;
          let ok = false;
          try { ok = await send(u); } catch { ok = false; }
          if (ok) { delete map[k]; sent++; }
        }
        await save(map);
        return sent;
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
