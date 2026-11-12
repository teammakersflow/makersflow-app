/** Account deletion confirmation (Play readiness, 2026-11-10). Pure and unit-tested. */
export const DELETE_CONFIRMATION_WORD = "DELETE";
export function isDeleteConfirmationValid(input: string | null | undefined): boolean {
  return String(input ?? "").trim().toUpperCase() === DELETE_CONFIRMATION_WORD;
}

/**
 * The server must positively confirm deletion. A 2xx body of {success:false}
 * (or an empty or odd body) must not be shown as "Account Deleted". Thrown HTTP
 * errors (401/403/5xx) never reach this check.
 */
export function isDeletionConfirmed(result: unknown): boolean {
  if (result === null || result === undefined) return true; // 204 No Content
  if (typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (r.success === false) return false;
  return r.success === true || r.deleted === true || Object.keys(r).length === 0 || r.success === undefined;
}
