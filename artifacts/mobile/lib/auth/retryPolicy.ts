/**
 * HTTP 429 (rate limit) handling for apiRequest (2026-11-13).
 *
 * The API rate-limits per endpoint (20 requests / 60 s per client). When it
 * answers 429:
 * - only idempotent reads (GET/HEAD) are retried, at most ONCE;
 * - the wait honours Retry-After (seconds or HTTP date); without it, a
 *   conservative exponential backoff with jitter is used;
 * - waits longer than MAX_AUTO_RETRY_WAIT_MS are not retried automatically
 *   (the error is returned at once so the screen keeps its saved data);
 * - a shared gate remembers "this endpoint is blocked until T", so other
 *   screens' reads to the same endpoint wait (short blocks) or fail fast (long
 *   blocks) instead of all hitting the server again: no retry storms;
 * - an aborted request is never retried.
 * 401 handling (token refresh) is untouched and lives in apiClient.
 *
 * Pure module with no imports, so node tests can load it directly.
 */

export const MAX_AUTO_RETRY_WAIT_MS = 10_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_JITTER_MS = 500;

export function isRetryableMethod(method: string | undefined): boolean {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** Retry-After as milliseconds (delta-seconds or HTTP-date), or null. */
export function parseRetryAfterMs(value: string | null | undefined, nowMs: number): number | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.max(0, Math.round(Number(v) * 1000));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/** Exponential backoff with jitter: attempt 0 -> 1.0-1.5 s, 1 -> 2.0-2.5 s ... */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempt) + Math.floor(random() * BACKOFF_JITTER_MS);
}

/**
 * The rate limit is per endpoint HANDLER, not per URL: /lesson-progress/my/course/43
 * and /course/27 share one budget. Collapse ids so they share one gate entry.
 */
export function endpointTemplate(endpoint: string): string {
  const path = String(endpoint).replace(/^https?:\/\/[^/]+/i, "").split("?")[0];
  return path
    .split("/")
    .map((seg) =>
      /^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ":id" : seg,
    )
    .join("/");
}

export interface RateLimitGate {
  blockedUntil(template: string): number;
  block(template: string, untilMs: number): void;
  reset(): void;
}

export function createRateLimitGate(): RateLimitGate {
  const until = new Map<string, number>();
  return {
    blockedUntil: (t) => until.get(t) ?? 0,
    block: (t, ms) => {
      if (ms > (until.get(t) ?? 0)) until.set(t, ms);
    },
    reset: () => until.clear(),
  };
}

export interface RateLimitRetryOptions<T> {
  method: string;
  endpoint: string;
  /** One attempt. Must reject with an error carrying `status` (and `retryAfter`). */
  send: () => Promise<T>;
  gate: RateLimitGate;
  /** Builds the error returned when the endpoint is known to be blocked. */
  blockedError: (waitMs: number) => Error;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  signal?: AbortSignal | null;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runWithRateLimitRetry<T>(o: RateLimitRetryOptions<T>): Promise<T> {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  const maxRetries = o.maxRetries ?? 1;
  const template = endpointTemplate(o.endpoint);
  const retryable = isRetryableMethod(o.method);

  // Another screen already got a 429 for this endpoint: do not add to it.
  if (retryable) {
    const wait = o.gate.blockedUntil(template) - now();
    if (wait > MAX_AUTO_RETRY_WAIT_MS) throw o.blockedError(wait);
    if (wait > 0) await sleep(wait + Math.floor(random() * 250));
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await o.send();
    } catch (err: any) {
      if (err?.status !== 429) throw err;
      const delay = parseRetryAfterMs(err?.retryAfter, now()) ?? backoffDelayMs(attempt, random);
      o.gate.block(template, now() + delay);
      if (!retryable || attempt >= maxRetries || delay > MAX_AUTO_RETRY_WAIT_MS || o.signal?.aborted) {
        throw err;
      }
      await sleep(delay + Math.floor(random() * 250));
      if (o.signal?.aborted) throw err;
    }
  }
}
