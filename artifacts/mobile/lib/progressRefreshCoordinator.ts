/**
 * Coordinates the progress context's full load with single-course refreshes
 * after a lesson completion (2026-11-13, review H1).
 *
 * A single-course refresh merges one course into the context's map. That is
 * only safe once a full load has produced a complete map for this user:
 * - a full load still running is awaited (and reused, never duplicated);
 * - if no full load has succeeded yet, one full load is run instead, and a
 *   course refresh is not needed when that load started after the completion;
 * - concurrent completions share the same full load.
 * reset() (account change) cancels refreshes that are still waiting.
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export type CourseRefreshOutcome =
  /** The one course was reloaded and merged into a complete map. */
  | "course"
  /** A full load that started after the completion covered it. */
  | "full"
  /** No complete map could be loaded (e.g. offline); nothing was merged. */
  | "skipped"
  /** The account changed while waiting. */
  | "cancelled";

export interface ProgressRefreshCoordinator {
  /**
   * Runs a full load. `task` resolves true when it applied a complete,
   * current map for this user (false: failed, superseded, or fallback data).
   */
  runFull(task: () => Promise<boolean>): Promise<boolean>;
  /**
   * After a completion: make sure the context holds a complete map, then
   * reload just the completed course (`refreshOne` merges it).
   */
  refreshCourse(opts: {
    startFull: () => Promise<boolean>;
    refreshOne: () => Promise<void>;
  }): Promise<CourseRefreshOutcome>;
  /** A complete map has been applied for the current user. */
  hasCompleteMap(): boolean;
  /** Account change: forget the previous user's state. */
  reset(): void;
}

export function createProgressRefreshCoordinator(): ProgressRefreshCoordinator {
  let epoch = 0;
  let complete = false;
  let startedSeq = 0;
  const running = new Map<number, Promise<boolean>>(); // seq -> full load

  const runFull: ProgressRefreshCoordinator["runFull"] = (task) => {
    const seq = ++startedSeq;
    const myEpoch = epoch;
    const p = Promise.resolve()
      .then(task)
      .catch(() => false)
      .then((ok) => {
        if (ok && myEpoch === epoch) complete = true;
        return ok;
      })
      .finally(() => {
        running.delete(seq);
      });
    running.set(seq, p);
    return p;
  };

  /** Wait until no full load is running; true if one that started after `afterSeq` succeeded. */
  async function waitForFullLoads(afterSeq: number): Promise<boolean> {
    let coveredByLater = false;
    while (running.size > 0) {
      const entries = Array.from(running.entries());
      const results = await Promise.all(entries.map(([, p]) => p.catch(() => false)));
      entries.forEach(([seq], i) => {
        if (seq > afterSeq && results[i]) coveredByLater = true;
      });
    }
    return coveredByLater;
  }

  return {
    runFull,
    async refreshCourse({ startFull, refreshOne }) {
      const myEpoch = epoch;
      const seqAtCall = startedSeq;
      let covered = await waitForFullLoads(seqAtCall);
      if (myEpoch !== epoch) return "cancelled";
      if (!complete) {
        // No complete map yet: one full load (shared by concurrent completions).
        // Any full load started after this call (the write was already done)
        // covers this completion.
        if (running.size === 0) void runFull(startFull);
        covered = (await waitForFullLoads(seqAtCall)) || covered;
        if (myEpoch !== epoch) return "cancelled";
        if (!complete) return "skipped";
      }
      if (covered) return "full";
      await refreshOne();
      return myEpoch === epoch ? "course" : "cancelled";
    },
    hasCompleteMap: () => complete,
    reset() {
      epoch += 1;
      complete = false;
    },
  };
}
