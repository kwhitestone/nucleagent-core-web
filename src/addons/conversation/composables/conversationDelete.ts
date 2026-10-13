// UI-IMPL-5 / UI-DESIGN-7: delete-own-conversation UI policy.
export const UNDO_WINDOW_MS = 5000;
export const RESTORE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

/** i18n keys of the confirm dialog body; running chats get the stop note (3A), compare groups the whole-group note (5A). */
export function deleteConfirmKeys(status?: string, members = 1): string[] {
  const keys = ["conversation.delete.body"];
  if (status === "executing" || status === "blocked") keys.push("conversation.delete.runningNote");
  if (members > 1) keys.push("conversation.delete.groupNote");
  return keys;
}

/** Mirrors Core's 30-day restore window (Core stays authoritative). */
export function isRestorable(deletedAt: string | null | undefined, now = Date.now()): boolean {
  if (!deletedAt) return false;
  const at = Date.parse(deletedAt);
  return Number.isFinite(at) && now - at <= RESTORE_WINDOW_DAYS * DAY_MS;
}

/** Whole days left before the conversation drops out of "recently deleted". */
export function daysLeft(deletedAt: string, now = Date.now()): number {
  const left = RESTORE_WINDOW_DAYS * DAY_MS - (now - Date.parse(deletedAt));
  return Number.isFinite(left) ? Math.max(0, Math.ceil(left / DAY_MS)) : 0;
}

type Row = { id: number; state?: Record<string, unknown> };

/** Loaded members deleted together with `id` (Core deletes the whole compare group). */
export function groupSize(rows: readonly Row[], id: number): number {
  const group = rows.find((r) => r.id === id)?.state?.broadcastGroupId;
  return group ? rows.filter((r) => r.state?.broadcastGroupId === group).length : 1;
}

/** Core answers 404 for missing and for other users' conversations alike. */
export function deleteErrorKey(error: unknown): string {
  return (error as { status?: unknown } | null)?.status === 404 ? "conversation.delete.notFound" : "conversation.delete.failed";
}

/** Shell sidebar 「⋯ › 删除」 → { source:'shell', type:'delete', conversationId }. */
export function parseDeleteIntent(payload: unknown): { conversationId: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const { source, type, conversationId } = payload as Record<string, unknown>;
  if (source !== "shell" || type !== "delete") return null;
  return Number.isSafeInteger(conversationId) && (conversationId as number) > 0 ? { conversationId: conversationId as number } : null;
}
