/** Pure presentation rules for the read-only conversation viewer (unit tested). */
import type { ConversationDetail, ConversationMessage } from "../../api/conversations";

export interface LinkTarget {
  kind: "core" | "im";
  id: number;
  to: string;
  status?: string;
}

/**
 * IM↔Core jumps. A chat links to the IM rows mapped onto it; an IM row links to
 * the core conversations it was imported into. Never a link back to itself.
 */
export function linkTargets(detail: ConversationDetail): LinkTarget[] {
  const out: LinkTarget[] = [];
  const seen = new Set<string>();
  for (const link of detail.links ?? []) {
    if (detail.type === "im" && link.coreConversationId > 0) {
      const to = `/admin/conversations/chat/${link.coreConversationId}`;
      if (!seen.has(to)) out.push({ kind: "core", id: link.coreConversationId, to, status: link.coreStatus });
      seen.add(to);
    }
    if (detail.type === "chat" && link.imConversationId && link.imConversationId > 0) {
      const to = `/admin/conversations/im/${link.imConversationId}`;
      if (!seen.has(to)) out.push({ kind: "im", id: link.imConversationId, to });
      seen.add(to);
    }
  }
  return out;
}

export function messageState(message: ConversationMessage): Record<string, boolean> {
  return { streaming: message.streaming, user: message.senderType === "user", thinking: message.thinking === true };
}

export function messageSender(message: ConversationMessage, t: (key: string) => string): string {
  if (message.from) return message.from.nickName || message.from.username;
  if (message.fromUserId) return `UID ${message.fromUserId}`;
  if (message.senderName) return message.senderName;
  return message.senderType ? t(`conversationsAdmin.sender.${message.senderType}`) : "—";
}
