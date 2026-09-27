import type { Conversation, ConversationStatus } from "../api/types";

/**
 * Chat home task desk order (board §11 ①): needs-you (blocked) first, then
 * running, then everything else by recency. Stable within each band.
 */
const BAND: Partial<Record<ConversationStatus, number>> = { blocked: 0, executing: 1 };

export function deskOrder<T extends Pick<Conversation, "status" | "createdAt" | "id">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    (BAND[a.status] ?? 2) - (BAND[b.status] ?? 2) ||
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
    b.id - a.id);
}

/** "3 分钟前" / "3 min ago"; absolute date past a week. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
  return new Date(then).toLocaleDateString(locale);
}
