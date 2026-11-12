/**
 * Notification-tap routing (fixes M-29 and L-18, 2026-11-10). Pure and unit-tested.
 *
 * Push payloads come from the server (see supabase/functions/_shared/pushPayload.ts),
 * but they are still treated as untrusted: only known screens are routed, ids
 * must look like ids, and anything else falls back to the notifications list.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function routeForNotification(data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "string" || typeof v === "number") && ID_RE.test(String(v)) ? String(v) : null;
  switch (d.screen) {
    case "orders":
      return "/store/orders";
    case "course": {
      const c = id(d.courseId);
      return c ? `/course/${c}` : "/notifications";
    }
    case "news": {
      const n = id(d.newsId);
      return n ? `/news/${n}` : "/notifications";
    }
    case "announcements":
    case "notifications":
    default:
      return "/notifications";
  }
}

/** In-app links stored on notification rows (app/notifications.tsx). Only relative app routes are allowed. */
const ALLOWED_LINK_PREFIXES = ["/store/orders", "/course/", "/news/", "/notifications", "/certificate", "/achievements", "/(tabs)"];
export function safeInAppLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const l = link.trim();
  if (!l.startsWith("/") || l.startsWith("//") || /[\s\\]/.test(l) || l.includes("..")) return null;
  return ALLOWED_LINK_PREFIXES.some((p) => l === p || l.startsWith(p)) ? l : null;
}
