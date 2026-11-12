/**
 * Reconnect detection (fix M-24, 2026-11-10). Pure and unit-tested.
 *
 * NetInfo commonly reports internet reachability as false → null → true when
 * the network returns. The old check compared only with the immediately
 * previous value (null), so "reconnected" never fired. This tracker remembers
 * that we were offline until reachability is confirmed true, and ignores null
 * ("unknown") in between.
 */
export function createReconnectTracker() {
  let wasOffline = false;
  return {
    /** Feed every reachability observation. Returns true exactly once per offline→online transition. */
    observe(reachable: boolean | null | undefined): boolean {
      if (reachable === false) {
        wasOffline = true;
        return false;
      }
      if (reachable === true && wasOffline) {
        wasOffline = false;
        return true;
      }
      return false;
    },
    get offline() {
      return wasOffline;
    },
  };
}
