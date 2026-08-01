// Minimal event bus so low-level data code (e.g. progress saves during video
// playback) can signal an expired/invalid session without importing UI code.

type Listener = () => void;

const listeners = new Set<Listener>();
let lastEmit = 0;

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Debounced — repeated failed saves during playback fire the UI prompt once. */
export function emitSessionExpired(): void {
  const now = Date.now();
  if (now - lastEmit < 30_000) return;
  lastEmit = now;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // listener errors must not break the emitter
    }
  });
}

/** Heuristic: does a Supabase/PostgREST error indicate an auth/session problem? */
export function isAuthError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  const code = String(error.code ?? "");
  const status = error.status;
  return (
    status === 401 ||
    code === "PGRST301" || // JWT expired
    code === "401" ||
    msg.includes("jwt") ||
    msg.includes("invalid token") ||
    msg.includes("not authenticated") ||
    msg.includes("refresh token")
  );
}
