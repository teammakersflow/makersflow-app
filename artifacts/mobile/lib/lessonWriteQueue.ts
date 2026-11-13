/**
 * One writer per lesson for lesson-progress writes (2026-11-13, review M1/M4).
 *
 * Every write for a user + course + lesson goes through one queue, so:
 * - at most one request per lesson is in flight;
 * - playback saves are coalesced: only the newest waiting position is sent;
 * - a completion jumps ahead of waiting playback saves. It waits only for the
 *   request currently in flight, never for an endlessly extending save loop
 *   (M1). Concurrent completions of the same lesson share one request;
 * - after a completion was requested, later playback saves for that lesson
 *   also carry the completion, so an older playback update can never undo it;
 * - replays from the offline outbox go through the same queue and are skipped
 *   when a newer update for that lesson was already saved (M4): an old queued
 *   position never overwrites a newer one. A queued completion whose position
 *   is older than a saved one is sent without its position.
 *
 * Ordering (2026-11-13, clock fix): "newer" never depends on the device clock
 * within one app session. Each update created in this session is stamped with
 * this session's id and an increasing sequence number (stamp()); see
 * isNewerUpdate. The wall-clock `at` is kept for the outbox's age limit and to
 * order two entries that both come from earlier sessions.
 *
 * "Newer" means created later, not a larger value: rewatching a lesson from
 * the start legitimately moves the resume point back.
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export interface UpdateOrder {
  /** Epoch ms when recorded (device clock; may jump). */
  at: number;
  /** App session that created the update (absent on entries from older app versions). */
  session?: string;
  /** Creation order within `session`. */
  seq?: number;
}

export interface LessonUpdate extends UpdateOrder {
  userId: string;
  courseId: string | number;
  lessonId: string | number;
  currentTimeSecs: number;
  watchPercentage: number;
  completed?: boolean;
  /** No playback position: must not overwrite the stored position. */
  noPosition?: boolean;
}

/**
 * Is `a` newer than `b`?
 * - same session: by sequence number (the clock is not used at all);
 * - one from the current session, one from an earlier session (or an older
 *   app version): the current session's update is newer. Everything persisted
 *   by an earlier session existed before this session created anything;
 * - both from earlier sessions (possibly different ones): by `at`, the only
 *   information left. Equal values are not "newer".
 */
export function isNewerUpdate(a: UpdateOrder, b: UpdateOrder, currentSession: string): boolean {
  if (a.session !== undefined && a.session === b.session && a.seq !== undefined && b.seq !== undefined) {
    return a.seq > b.seq;
  }
  const aCurrent = a.session === currentSession;
  const bCurrent = b.session === currentSession;
  if (aCurrent !== bCurrent) return aCurrent;
  return a.at > b.at;
}

export interface WriteResult {
  ok: boolean;
  /** The update was not sent because a newer one was already saved. */
  skipped?: boolean;
  error?: unknown;
}

export type WriteKind = "save" | "completion" | "replay";

export interface LessonWriteQueueDeps {
  /** Sends one update. Resolves { ok } (should not throw; a throw counts as a failure). */
  send(u: LessonUpdate, kind: WriteKind): Promise<{ ok: boolean; error?: unknown }>;
  onSaved?(u: LessonUpdate, kind: WriteKind): void;
  onFailed?(u: LessonUpdate, kind: WriteKind, error: unknown): void;
  /** This app session's id (default: random per queue instance, i.e. per app process). */
  sessionId?: string;
}

export function lessonWriteKey(u: Pick<LessonUpdate, "userId" | "courseId" | "lessonId">): string {
  return `${u.userId}:${Number(u.courseId)}:${Number(u.lessonId)}`;
}

interface Waiting {
  update: LessonUpdate;
  waiters: Array<(r: WriteResult) => void>;
}

interface LessonState {
  running: boolean;
  completion?: Waiting;
  replays: Waiting[];
  pending?: Waiting;
  /** Order of the newest saved update that carried a position (null: none yet). */
  saved: UpdateOrder | null;
  savedCompleted: boolean;
  /** A completion was requested in this app session. */
  completionRequested: boolean;
}

function randomSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createLessonWriteQueue(deps: LessonWriteQueueDeps) {
  const sessionId = deps.sessionId ?? randomSessionId();
  let seq = 0;
  const lessons = new Map<string, LessonState>();
  const newer = (a: UpdateOrder, b: UpdateOrder) => isNewerUpdate(a, b, sessionId);

  /** Stamp an update created now in this session (kept if already stamped). */
  function stamp<T extends UpdateOrder>(u: T): T {
    if (u.session !== undefined && u.seq !== undefined) return u;
    return { ...u, session: sessionId, seq: ++seq };
  }

  const stateFor = (key: string): LessonState => {
    let st = lessons.get(key);
    if (!st) {
      st = { running: false, replays: [], saved: null, savedCompleted: false, completionRequested: false };
      lessons.set(key, st);
    }
    return st;
  };

  /** A newer (or the same) update of this lesson was already saved. */
  function supersededIn(st: LessonState, u: LessonUpdate): boolean {
    if (u.completed && !st.savedCompleted) return false;
    if (u.noPosition) return !!u.completed && st.savedCompleted;
    return st.saved !== null && !newer(u, st.saved);
  }

  function enqueue(key: string, kind: WriteKind, update: LessonUpdate): Promise<WriteResult> {
    const st = stateFor(key);
    return new Promise<WriteResult>((resolve) => {
      if (kind === "completion") {
        st.completionRequested = true;
        if (st.completion) {
          st.completion.waiters.push(resolve); // join the waiting completion
        } else {
          st.completion = { update, waiters: [resolve] };
        }
      } else if (kind === "replay") {
        st.replays.push({ update, waiters: [resolve] });
      } else if (st.pending) {
        // Coalesce: keep only the newest position; everyone waits for it.
        if (!newer(st.pending.update, update)) st.pending.update = update;
        st.pending.waiters.push(resolve);
      } else {
        st.pending = { update, waiters: [resolve] };
      }
      if (!st.running) void drain(st);
    });
  }

  async function drain(st: LessonState): Promise<void> {
    st.running = true;
    try {
      for (;;) {
        let kind: WriteKind;
        let item: Waiting | undefined;
        if (st.completion) { kind = "completion"; item = st.completion; st.completion = undefined; }
        else if (st.replays.length) { kind = "replay"; item = st.replays.shift(); }
        else if (st.pending) { kind = "save"; item = st.pending; st.pending = undefined; }
        else break;
        if (!item) break;

        let u = item.update;
        if (kind !== "completion" && st.completionRequested && !u.completed) {
          u = { ...u, completed: true }; // never send a later update without the completion
        }
        if (supersededIn(st, u)) {
          const r: WriteResult = { ok: true, skipped: true };
          item.waiters.forEach((w) => w(r));
          continue;
        }
        if (u.completed && !u.noPosition && st.saved !== null && !newer(u, st.saved)) {
          u = { ...u, noPosition: true }; // keep the completion, not the older position
        }

        let r: WriteResult;
        try {
          r = await deps.send(u, kind);
        } catch (error) {
          r = { ok: false, error };
        }
        if (r.ok) {
          if (!u.noPosition && (st.saved === null || newer(u, st.saved))) {
            st.saved = { at: u.at, session: u.session, seq: u.seq };
          }
          if (u.completed) st.savedCompleted = true;
          try { deps.onSaved?.(u, kind); } catch { /* observer only */ }
        } else {
          try { deps.onFailed?.(u, kind, r.error); } catch { /* observer only */ }
        }
        item.waiters.forEach((w) => w(r));
      }
    } finally {
      st.running = false;
    }
  }

  return {
    /** This app session's id. */
    sessionId,
    /** Is `a` newer than `b` (for the outbox; see isNewerUpdate). */
    isNewer: newer,
    /** Stamp an update created now with this session's id and the next sequence number. */
    stamp,
    /** Playback save (coalesced). Stamped here if not stamped yet. */
    save: (u: LessonUpdate) => enqueue(lessonWriteKey(u), "save", stamp(u)),
    /** Completion: waits only for the request in flight, then goes first. */
    complete: (u: LessonUpdate) => enqueue(lessonWriteKey(u), "completion", stamp({ ...u, completed: true })),
    /** Re-send an outbox entry (keeps its own stamp); skipped (ok) when a newer update was already saved. */
    replay: (u: LessonUpdate) => enqueue(lessonWriteKey(u), "replay", u),
    /** For tests / diagnostics. */
    isBusy: (key: string) => !!lessons.get(key)?.running,
  };
}
