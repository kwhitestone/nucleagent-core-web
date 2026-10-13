// UI-IMPL-5 / UI-DESIGN-7: delete-own-conversation UI policy.
export const UNDO_WINDOW_MS = 5000;
export const RESTORE_WINDOW_DAYS = 30;

/** i18n keys of the confirm dialog body; running chats get the stop note (3A). */
export function deleteConfirmKeys(status?: string): string[] {
  const keys = ["conversation.delete.body"];
  if (status === "executing" || status === "blocked") keys.push("conversation.delete.runningNote");
  return keys;
}

/** Mirrors Core's 30-day restore window (Core stays authoritative). */
export function isRestorable(deletedAt: string | null | undefined, now = Date.now()): boolean {
  if (!deletedAt) return false;
  const at = Date.parse(deletedAt);
  return Number.isFinite(at) && now - at <= RESTORE_WINDOW_DAYS * 24 * 3600 * 1000;
}
