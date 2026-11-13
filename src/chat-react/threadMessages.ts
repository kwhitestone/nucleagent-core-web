import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationItem, ConversationLocale } from "../addons/conversation/task-conversation/core/types.ts";
import { selectTurns, type ConversationState } from "../addons/conversation/task-conversation/core/reducer.ts";
import { executionTimingLabel, executionTimings } from "../addons/conversation/task-conversation/vue/executionTiming.ts";
import { orderTurnItemsForDisplay, processGroupStatus, processGroupSummary, processItemForDisplay, processStepEndedAt, processToolDetails, resolveProcessStepDurationMs } from "../addons/conversation/task-conversation/vue/processPresentation.ts";

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

/** Header of one "执行过程" group (same summary as the Vue view); its steps follow as reasoning / tool-call parts. */
export interface ProcessPartData {
  summary: string;
  timing: string;
  status: ConversationItem["status"];
}

/** A media generation message (image/video task) and whether it failed. */
export interface MediaPartData { media: { kind?: string; taskId?: number }; prompt: string; failed: boolean }

/** What a Core tool step carries into its aui tool-call card (no args: Core only sends the outcome). */
export interface ToolResult { content: string; query?: string; sources?: readonly { title?: string; domain?: string; url?: string }[] }

const terminal = (item: ConversationItem) => item.status !== "pending" && item.status !== "streaming";

/** Wall-clock span of a settled step, same rules as the Vue view's step clock (none while it runs). */
function stepTiming(item: ConversationItem, endedAt: string | undefined) {
  if (item.data?.durationUnavailable === true || item.data?.phaseStatus === "unavailable") return {};
  const startedAt = Date.parse(item.timestamp);
  const ms = resolveProcessStepDurationMs({
    startedAt: item.timestamp, endedAt: processStepEndedAt({ status: item.status, nextStepAt: endedAt, settledGroupEnd: endedAt }),
    nowMs: startedAt, status: item.status, explicitDurationMs: item.data?.phaseDurationMs ?? item.data?.durationMs,
  });
  return ms === undefined || !terminal(item) || !Number.isFinite(startedAt) ? {} : { timing: { startedAt, completedAt: startedAt + ms } };
}

/** One Core process step → an aui part: tool calls become `tool-call`, everything else `reasoning` (Core status in providerMetadata.core). */
function stepPart(item: ConversationItem, endedAt: string | undefined): Part {
  const toolCallId = typeof item.data?.toolCallId === "string" ? item.data.toolCallId : undefined;
  const timing = stepTiming(item, endedAt);
  if (item.kind === "tool_call" || toolCallId) {
    const details = processToolDetails(item.data);
    const result: ToolResult = { content: item.content, ...(details?.query ? { query: details.query } : {}), ...(details?.sources ? { sources: details.sources } : {}) };
    return {
      type: "tool-call", toolCallId: toolCallId ?? item.id, toolName: item.title || item.kind, args: {},
      ...(terminal(item) ? { result, isError: item.status === "failed" } : {}), ...timing,
    };
  }
  return { type: "reasoning", id: item.id, text: [item.title, item.content].filter(Boolean).join("\n"), providerMetadata: { core: { status: item.status } }, ...timing };
}

export interface ThreadOptions { locale: ConversationLocale; nowMs: number }

function partsOf(group: readonly ConversationItem[], timing: string, locale: ConversationLocale): Part[] {
  const parts: Part[] = [];
  let run: ConversationItem[] = [];
  // A step ends when the next one starts; the last one when the next non-process item arrives (Vue's rule).
  const flush = (groupEnd?: string) => {
    if (!run.length) return;
    const data: ProcessPartData = { summary: processGroupSummary(run, locale), timing, status: processGroupStatus(run) };
    parts.push({ type: "data-process", id: run[0].id, data }, ...run.map((step, i) => stepPart(step, run[i + 1]?.timestamp ?? groupEnd)));
    run = [];
  };
  // Late process rows move before the answer, as in the Vue view.
  for (const raw of orderTurnItemsForDisplay(group)) {
    const item = processItemForDisplay(raw, locale);
    // tool/progress rows join the fold too, so every step group has its 执行过程 header.
    if (item.lane === "process" || item.lane === "tool" || item.lane === "progress") {
      if (item.lane === "process" || item.title || item.content) run.push(item);
      continue;
    }
    flush(item.timestamp);
    if (item.data?.media) parts.push({ type: "data-media", id: item.id, data: { media: item.data.media, prompt: item.content, failed: item.lane === "system" || typeof item.data.errorCode === "string" } });
    else if (item.content) parts.push({ type: "text", text: item.content });
    // Files the assistant produced (storage refs only), shown as chips after the text.
    if (item.attachments?.length) parts.push({ type: "data-files", id: `${item.id}-files`, data: item.attachments.map((a) => ({ id: a.id, name: a.name })) });
  }
  flush();
  return parts;
}

/**
 * Core items (same visibility rules as the Vue view, via selectTurns) → assistant-ui messages.
 * Each user item is one user message; the items between two user items join one assistant
 * message (contiguous process items → a `data-process` header followed by one reasoning or
 * tool-call part per step, grouped in the view by MessagePrimitive.GroupedParts; answer/system → text;
 * media generation → `data-media`; produced files → `data-files`).
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
      // Storage references only (fileId/name/mime/size), never file bytes; chips render from these.
      ...(item.attachments?.length ? { attachments: item.attachments.map((a) => ({
        id: a.id, type: a.mimeType?.startsWith("image/") ? "image" : "file", name: a.name, contentType: a.mimeType,
        status: { type: "complete" as const }, content: [],
      })) } : {}),
      createdAt: new Date(item.timestamp), metadata: { custom: { pending: item.status === "pending" } },
    });
  }
  flush();
  return out;
}
