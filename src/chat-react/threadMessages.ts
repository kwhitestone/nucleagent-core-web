import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationItem, ConversationLocale } from "../addons/conversation/task-conversation/core/types.ts";
import { selectTurns, type ConversationState } from "../addons/conversation/task-conversation/core/reducer.ts";
import { executionTimingLabel, executionTimings } from "../addons/conversation/task-conversation/vue/executionTiming.ts";
import { orderTurnItemsForDisplay, processGroupStatus, processGroupSummary, processItemForDisplay } from "../addons/conversation/task-conversation/vue/processPresentation.ts";

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

/** One collapsed "执行过程" row for a run of contiguous process items (same summary as the Vue view). */
export interface ProcessPartData {
  summary: string;
  timing: string;
  status: ConversationItem["status"];
  steps: { id: string; title: string; content: string; status: ConversationItem["status"] }[];
}

export interface ThreadOptions { locale: ConversationLocale; nowMs: number }

function partsOf(group: readonly ConversationItem[], timing: string, locale: ConversationLocale): Part[] {
  const parts: Part[] = [];
  let run: ConversationItem[] = [];
  const flush = () => {
    if (!run.length) return;
    const data: ProcessPartData = {
      summary: processGroupSummary(run, locale), timing, status: processGroupStatus(run),
      steps: run.map((i) => ({ id: i.id, title: i.title ?? "", content: i.content, status: i.status })),
    };
    parts.push({ type: "data-process", id: run[0].id, data });
    run = [];
  };
  // Late process rows move before the answer, as in the Vue view.
  for (const raw of orderTurnItemsForDisplay(group)) {
    const item = processItemForDisplay(raw, locale);
    if (item.lane === "process") { run.push(item); continue; }
    flush();
    if (item.lane === "tool" || item.lane === "progress") {
      const text = [item.title, item.content].filter(Boolean).join("\n");
      if (text) parts.push({ type: "reasoning", text });
    } else if (item.content) parts.push({ type: "text", text: item.content });
  }
  flush();
  return parts;
}

/**
 * Core items (same visibility rules as the Vue view, via selectTurns) → assistant-ui messages.
 * Each user item is one user message; the items between two user items join one assistant
 * message (contiguous process items → one `data-process` part, tool/progress → reasoning,
 * answer/system → text).
 */
export function toThreadMessages(state: ConversationState, options: ThreadOptions = { locale: "zh-CN", nowMs: Date.now() }): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  const timings = executionTimings(state.loadedOrder.map((id) => state.items[id]!).filter(Boolean), { nowMs: options.nowMs, status: state.status });
  let group: ConversationItem[] = [];
  let userId: string | undefined;
  const flush = () => {
    if (!group.length) return;
    const content = partsOf(group, executionTimingLabel(userId ? timings.get(userId) : undefined, options.locale), options.locale);
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
    if (item.data?.clarifyResponse !== true) userId = item.id;
    out.push({
      id: item.id, role: "user", content: [{ type: "text", text: item.content }],
      createdAt: new Date(item.timestamp), metadata: { custom: { pending: item.status === "pending" } },
    });
  }
  flush();
  return out;
}
