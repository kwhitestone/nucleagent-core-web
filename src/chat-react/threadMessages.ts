import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationItem } from "../addons/conversation/task-conversation/core/types.ts";
import { selectTurns, type ConversationState } from "../addons/conversation/task-conversation/core/reducer.ts";

type Status = NonNullable<ThreadMessageLike["status"]>;
type Part = Exclude<ThreadMessageLike["content"], string>[number];

const active = (item: ConversationItem) => item.status === "pending" || item.status === "streaming";

/** Core is still working on this conversation (drives Send/Stop). */
export const isRunning = (state: ConversationState): boolean =>
  state.status === "running" || Object.values(state.items).some(active);

function statusOf(items: readonly ConversationItem[]): Status {
  if (items.some(active)) return { type: "running" };
  if (items.some((i) => i.status === "cancelled")) return { type: "incomplete", reason: "cancelled" };
  if (items.some((i) => i.status === "failed")) return { type: "incomplete", reason: "error" };
  return { type: "complete", reason: "stop" };
}

function partOf(item: ConversationItem): Part | undefined {
  if (item.lane === "process" || item.lane === "tool" || item.lane === "progress") {
    const text = [item.title, item.content].filter(Boolean).join("\n");
    return text ? { type: "reasoning", text } : undefined;
  }
  return item.content ? { type: "text", text: item.content } : undefined;
}

/**
 * Core items (same visibility rules as the Vue view, via selectTurns) → assistant-ui messages.
 * Each user item is one user message; the items between two user items join one assistant
 * message (process → reasoning part, answer/system → text part).
 */
export function toThreadMessages(state: ConversationState): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  let group: ConversationItem[] = [];
  const flush = () => {
    if (!group.length) return;
    const content = group.map(partOf).filter((p): p is Part => !!p);
    out.push({
      id: group[0].id, role: "assistant", content, status: statusOf(group),
      createdAt: new Date(group[0].timestamp),
      metadata: { custom: { failed: group.some((i) => i.lane === "system" && i.status === "failed") } },
    });
    group = [];
  };
  for (const item of selectTurns(state).flatMap((t) => t.items)) {
    if (item.role !== "user") { group.push(item); continue; }
    flush();
    out.push({
      id: item.id, role: "user", content: [{ type: "text", text: item.content }],
      createdAt: new Date(item.timestamp), metadata: { custom: { pending: item.status === "pending" } },
    });
  }
  flush();
  return out;
}
