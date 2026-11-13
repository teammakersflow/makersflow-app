/**
 * Classifies request failures so screens show what actually happened
 * (2026-11-13). Previously every failure (429, 5xx, timeout, auth, offline)
 * showed "check your connection", even when the phone was online.
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export type ApiErrorKind = "rate_limited" | "server" | "timeout" | "network" | "auth" | "client" | "unknown";

/** apiClient's ApiError uses status 0 for network failures and 408 for its own timeout. */
export function classifyApiError(err: unknown): ApiErrorKind {
  const e = err as any;
  if (e?.kind && typeof e.kind === "string") return e.kind as ApiErrorKind;
  const status = typeof e?.status === "number" ? e.status : typeof e?.statusCode === "number" ? e.statusCode : undefined;
  if (status === 429) return "rate_limited";
  if (status === 401) return "auth";
  if (status === 408 || e?.name === "AbortError") return "timeout";
  if (status === 0) return "network";
  if (typeof status === "number" && status >= 500) return "server";
  if (typeof status === "number" && status >= 400) return "client";
  if (/network request failed|failed to fetch|network/i.test(String(e?.message ?? ""))) return "network";
  return "unknown";
}

/** User-facing message for a failed load. `hasData`: saved data is still shown. */
export function loadErrorMessage(kind: ApiErrorKind | undefined, hasData: boolean): string {
  switch (kind) {
    case "rate_limited":
      return "Server is busy. Your progress is saved. Please try again shortly.";
    case "server":
      return "We're having trouble reaching the server. Your saved progress is still available.";
    case "network":
      return "Unable to connect. Check your internet connection.";
    case "timeout":
      return "The server is taking too long to respond. Please try again.";
    case "auth":
      return "Your session has expired. Please sign in again.";
    default:
      return hasData
        ? "Couldn't refresh. Showing what was last loaded."
        : "Something went wrong while loading. Please try again.";
  }
}
