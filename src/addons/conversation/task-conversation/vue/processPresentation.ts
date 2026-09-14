import {
  normalizeProcessToolDetails,
  normalizeProcessPlan,
  type ProcessPlan,
  type ProcessToolDetails,
} from "../toolDetails.ts";
import type { ConversationItem, ConversationLocale, ConversationStatus } from "../core/types.ts";
import { isExecutionPhaseData, queuePositionText } from "./executionPhasePresentation.ts";

/** Heartbeats carry redundant prose timers. The elapsed slots own all timing. */
export function processItemForDisplay(item: ConversationItem, locale: ConversationLocale): ConversationItem {
  if (item.data?.executionPhase === "execution_queue") {
    return { ...item, content: queuePositionText(item.data, locale) };
  }
  if (item.data?.thinkingStatus !== true || item.data?.synthetic === true) return item;
  const active = item.status === "streaming" || item.status === "pending";
  return {
    ...item,
    content: locale === "zh-CN"
      ? active ? "正在处理请求，等待首个可展示内容…" : "已结束等待。"
      : active ? "Processing the request, waiting for the first content…" : "Finished waiting.",
  };
}

export function isProcessExpanded(
  manuallyExpanded: ReadonlySet<string>,
  itemId: string,
  activeItemId?: string,
  manuallyCollapsed: ReadonlySet<string> = new Set(),
): boolean {
  if (manuallyCollapsed.has(itemId)) return false;
  return itemId === activeItemId || manuallyExpanded.has(itemId);
}

function normalizeProcessLine(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\t+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function processLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^[-*_]{3,}$/.test(line) &&
        !/^```/.test(line) &&
        !/^#{1,6}\s*$/.test(line),
    )
    .map(normalizeProcessLine)
    .filter((line) => line.length > 0);
}

export function processPreview(
  content: string,
  data?: Readonly<Record<string, unknown>>,
): string {
  const preview = processLines(content).at(-1) ?? "";
  if (
    content.trim() !== preview || data?.thinking === true || data?.plan !== undefined ||
    data?.durationUnavailable === true || typeof data?.toolCallId !== "string" ||
    data.toolCallId.trim() === "" || typeof data.durationMs !== "number" ||
    !Number.isFinite(data.durationMs) || data.durationMs < 0
  ) return preview;

  // Core's toolLifecycleContent emits these exact status-only summaries.
  // Keep authored prose and details intact; the elapsed slot owns this timer.
  const generated = /^(执行命令|联网搜索|修改文件|读取文件|搜索文件|委托任务|分析|使用工具)(完成|失败) · \d+\.\d 秒$/.exec(preview);
  if (!generated || data.toolStatus !== (generated[2] === "完成" ? "completed" : "failed")) return preview;
  return generated[1] + generated[2];
}

export function hasDistinctProcessDetails(content: string): boolean {
  const lines = processLines(content);
  const preview = lines.at(-1) ?? "";
  return (
    preview !== "" &&
    (preview.length > 160 || lines.some((line) => line !== preview))
  );
}

export function processToolDetails(
  data?: Readonly<Record<string, unknown>>,
): ProcessToolDetails | undefined {
  return normalizeProcessToolDetails(data?.toolDetails);
}

export function processPlan(
  data?: Readonly<Record<string, unknown>>,
): ProcessPlan | undefined {
  return normalizeProcessPlan(data?.plan);
}

/** 计划进度摘要：「2/3」——折叠态预览与耗时并列展示。 */
export function planProgressSummary(plan: ProcessPlan): string {
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  const inProgress = plan.steps.find((step) => step.status === "inProgress");
  if (completed === plan.steps.length) return `${completed}/${plan.steps.length} 完成`;
  if (inProgress) {
    const inProgressText =
      inProgress.step.length > 24 ? inProgress.step.slice(0, 24) + "…" : inProgress.step;
    return `${completed}/${plan.steps.length} · ${inProgressText}`;
  }
  return `${completed}/${plan.steps.length}`;
}

export function hasProcessItemDetails(
  content: string,
  data?: Readonly<Record<string, unknown>>,
): boolean {
  return (
    processToolDetails(data) !== undefined ||
    hasDistinctProcessDetails(content)
  );
}

export function isThinkingProcessItem(
  data?: Readonly<Record<string, unknown>>,
): boolean {
  return data?.thinking === true;
}

export function preferredActiveProcessItemId<
  T extends {
    id: string;
    lane: string;
    status: string;
    data?: Readonly<Record<string, unknown>>;
  },
>(items: readonly T[]): string | undefined {
  const active = items.filter(
    (item) => item.lane === "process" &&
      (item.status === "pending" || item.status === "streaming"),
  );
  return [...active].reverse().find((item) => !isExecutionPhaseProcess(item))?.id ??
    active.at(-1)?.id;
}

export function ensureDirectReplyProcessItems(
  items: readonly ConversationItem[],
  fallback: Readonly<{ title: string; responseTitle?: string; content: string }>,
): readonly ConversationItem[] {
  const enriched: ConversationItem[] = [];
  let exchangeStartedAt: string | undefined;
  let exchangeHasProcess = false;
  let initialization: ConversationItem | undefined;

  for (const item of items) {
    if (item.role === "user") {
      exchangeStartedAt = item.timestamp;
      exchangeHasProcess = false;
      initialization = undefined;
      enriched.push(item);
      continue;
    }
    if (isExecutionPhaseProcess(item)) initialization = item;
    else if (item.lane === "process") exchangeHasProcess = true;
    if (
      exchangeStartedAt !== undefined &&
      !exchangeHasProcess &&
      item.role === "assistant" &&
      item.lane === "answer" &&
      item.kind === "result" &&
      item.status === "complete"
    ) {
      const id = `direct-process-${item.id}`;
      const responseStartedAt = initialization
        ? initializationEndedAt(initialization, item.timestamp) : exchangeStartedAt;
      enriched.push({
        id,
        turnId: item.turnId,
        streamId: id,
        lane: "process",
        role: "assistant",
        kind: "plan",
        content: fallback.content,
        status: "complete",
        revision: item.revision,
        seq: item.seq,
        timestamp: responseStartedAt ?? item.timestamp,
        userReadable: true,
        title: initialization ? fallback.responseTitle ?? fallback.title : fallback.title,
        data: {
          thinking: true, synthetic: true,
          ...(initialization ? { durationEstimated: true } : {}),
          ...(responseStartedAt === undefined ? { durationUnavailable: true } : {}),
        },
      });
      exchangeHasProcess = true;
    }
    enriched.push(item);
  }
  return enriched;
}

function initializationEndedAt(item: ConversationItem, responseAt?: string): string | undefined {
  const duration = item.data?.phaseDurationMs;
  if (item.data?.phaseStatus !== "completed" || typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return undefined;
  const started = Date.parse(item.timestamp ?? "");
  const ended = started + duration;
  const response = Date.parse(responseAt ?? "");
  // The lifecycle row records when Core received phase start. Reconstructing
  // readiness from its measured duration is an estimate, not model telemetry.
  return Number.isFinite(started) && Number.isFinite(response) && ended <= response
    ? new Date(ended).toISOString() : undefined;
}

/** Keep the run timer visible while waiting for the first process event, or
 * after a run stops without one. This is a display placeholder, not telemetry. */
export function ensureExecutionProcessItems(
  items: readonly ConversationItem[],
  timings: ReadonlyMap<string, { active: boolean; totalMs?: number }>,
  fallback: Readonly<{ title: string; waiting: string; settled: string }>,
  latestRun?: Readonly<{ userId?: string; status: ConversationStatus }>,
): readonly ConversationItem[] {
  const enriched: ConversationItem[] = [];
  let exchange: ConversationItem[] = [];
  const flush = () => {
    const user = exchange[0];
    const timing = user?.role === "user" ? timings.get(user.id) : undefined;
    if (user && timing?.totalMs !== undefined && !exchange.some((item) => item.lane === "process")) {
      const id = `waiting-process-${user.id}`;
      const runStatus = latestRun?.userId === user.id ? latestRun.status : user.data?.runStatus;
      const terminalStatus = exchange.find((item) => item.status === "failed" || item.status === "cancelled")?.status ??
        (runStatus === "failed" || runStatus === "cancelled" ? runStatus : "complete");
      enriched.push(user, {
        id, turnId: user.turnId, streamId: id, lane: "process", role: "assistant",
        kind: "plan", content: timing.active ? fallback.waiting : fallback.settled,
        status: timing.active ? "streaming" : terminalStatus,
        revision: user.revision, seq: user.seq, timestamp: user.timestamp,
        userReadable: true, title: fallback.title,
        data: { thinking: true, thinkingStatus: true, synthetic: true },
      }, ...exchange.slice(1));
    } else enriched.push(...exchange);
    exchange = [];
  };
  for (const item of items) {
    if (item.role === "user" && item.data?.clarifyResponse !== true) flush();
    exchange.push(item);
  }
  flush();
  return enriched;
}

/**
 * Keep every user exchange visually coherent while events are still arriving.
 *
 * A streaming answer row can be created before a later tool/reasoning event.
 * The transport order is then `user -> process -> answer -> late process` even
 * though the late process is part of the same execution phase. Move only those
 * late process rows in front of the first assistant answer in that exchange;
 * user messages remain hard boundaries and relative order inside each lane is
 * preserved. The returned array is new and the controller state is untouched.
 */
function isExecutionPhaseProcess<T extends {
  lane: string;
  data?: Readonly<Record<string, unknown>>;
}>(item: T): boolean {
  return item.lane === "process" && isExecutionPhaseData(item.data);
}

function orderExecutionPhaseWithinProcessRuns<
  T extends { lane: string; data?: Readonly<Record<string, unknown>> },
>(items: readonly T[]): readonly T[] {
  const ordered: T[] = [];
  let process: T[] = [];
  const flush = () => {
    if (process.length === 0) return;
    ordered.push(
      ...process.filter((item) => item.data?.executionPhase === "execution_queue"),
      ...process.filter((item) => item.data?.executionPhase === "agent_initialization"),
      ...process.filter((item) => !isExecutionPhaseProcess(item)),
    );
    process = [];
  };
  for (const item of items) {
    if (item.lane === "process") {
      process.push(item);
      continue;
    }
    flush();
    ordered.push(item);
  }
  flush();
  return ordered;
}

export function orderTurnItemsForDisplay<
  T extends { lane: string; role: string; data?: Readonly<Record<string, unknown>> },
>(items: readonly T[]): readonly T[] {
  const ordered: T[] = [];
  let exchange: T[] = [];

  const flush = () => {
    if (exchange.length === 0) return;
    const firstAssistantAnswer = exchange.findIndex(
      (item) => item.role !== "user" && item.lane === "answer",
    );
    if (firstAssistantAnswer < 0) {
      ordered.push(...orderExecutionPhaseWithinProcessRuns(exchange));
      exchange = [];
      return;
    }

    const prefix = exchange.slice(0, firstAssistantAnswer);
    const suffix = exchange.slice(firstAssistantAnswer);
    const lateProcess = suffix.filter((item) => item.lane === "process");
    const remaining = suffix.filter((item) => item.lane !== "process");
    ordered.push(
      ...orderExecutionPhaseWithinProcessRuns([...prefix, ...lateProcess]),
      ...remaining,
    );
    exchange = [];
  };

  for (const item of items) {
    if (item.role === "user" && exchange.length > 0) flush();
    exchange.push(item);
  }
  flush();
  return ordered;
}

export function groupContiguousProcessItems<
  T extends { lane: string; data?: Readonly<Record<string, unknown>> },
>(
  items: readonly T[],
): readonly (readonly T[])[] {
  const groups: T[][] = [];
  let current: T[] = [];

  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
  };

  for (const item of items) {
    if (item.lane !== "process") {
      flush();
      continue;
    }
    current.push(item);
  }
  flush();
  return groups;
}

/** Display groups share the elapsed time of their owning user submission. */
export function indexProcessGroupUsers<
  T extends { id: string; role: string; lane: string; data?: Readonly<Record<string, unknown>> },
>(items: readonly T[]): ReadonlyMap<string, string> {
  const users = new Map<string, string>();
  let userId: string | undefined;
  let inProcess = false;
  for (const item of items) {
    if (item.role === "user" && item.data?.clarifyResponse !== true) userId = item.id;
    if (item.lane === "process" && !inProcess && userId) users.set(item.id, userId);
    inProcess = item.lane === "process";
  }
  return users;
}

export function indexProcessGroupLeaders<
  T extends { id: string; lane: string; data?: Readonly<Record<string, unknown>> },
>(items: readonly T[]): ReadonlyMap<string, string> {
  const leaders = new Map<string, string>();
  for (const group of groupContiguousProcessItems(items)) {
    const leaderId = group[0]?.id;
    if (!leaderId) continue;
    for (const item of group) leaders.set(item.id, leaderId);
  }
  return leaders;
}

export function processDurationMs(
  startedAt: string,
  endedAt: string | undefined,
  nowMs: number,
): number | undefined {
  const startedMs = Date.parse(startedAt);
  const endedMs = endedAt === undefined ? nowMs : Date.parse(endedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) return undefined;
  return Math.max(0, endedMs - startedMs);
}

export function resolveProcessStepDurationMs(input: {
  startedAt: string;
  endedAt?: string;
  nowMs: number;
  status: string;
  explicitDurationMs?: unknown;
}): number | undefined {
  const active = input.status === "pending" || input.status === "streaming";
  if (
    !active &&
    typeof input.explicitDurationMs === "number" &&
    Number.isFinite(input.explicitDurationMs) &&
    input.explicitDurationMs >= 0
  )
    return input.explicitDurationMs;
  if (!active && input.endedAt === undefined) return undefined;
  return processDurationMs(input.startedAt, input.endedAt, input.nowMs);
}

export function processStepEndedAt(input: {
  status: string;
  nextStepAt?: string;
  settledGroupEnd?: string;
}): string | undefined {
  const active = input.status === "pending" || input.status === "streaming";
  if (active) return undefined;
  return input.nextStepAt ?? input.settledGroupEnd;
}

function durationAtDisplayPrecision(durationMs: number): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return Math.round(durationMs / 100) * 100;
}

export function sumProcessDurationsForDisplay(
  durations: readonly (number | undefined)[],
): number | undefined {
  if (durations.length === 0) return undefined;
  let total = 0;
  for (const duration of durations) {
    if (duration === undefined) return undefined;
    const displayDuration = durationAtDisplayPrecision(duration);
    if (displayDuration === undefined) return undefined;
    total += displayDuration;
  }
  return total;
}

export function formatProcessDuration(durationMs: number): string {
  const safeDuration = Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : 0;
  const elapsedTenths = Math.round(safeDuration / 100);
  if (elapsedTenths < 600) return `${(elapsedTenths / 10).toFixed(1)}s`;
  const minutes = Math.floor(elapsedTenths / 600);
  const seconds = ((elapsedTenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}m ${seconds}s`;
}
