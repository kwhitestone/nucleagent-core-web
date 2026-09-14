import type {
  ConversationItem,
  ConversationLocale,
  ConversationStatus,
} from "../core/types.ts";

export interface ExecutionTiming {
  totalMs?: number;
  waitingMs?: number;
  agentInitializationMs?: number;
  agentInitializationBoundary?: string;
  agentInitializationEstimated?: boolean;
  queueMs?: number;
  queued: boolean;
  agentInitializing: boolean;
  active: boolean;
  awaitingResponse: boolean;
}

export function executionTimingLabel(
  timing: ExecutionTiming | undefined,
  locale: ConversationLocale,
): string {
  if (timing?.totalMs === undefined) return "";
  const seconds = (timing.totalMs / 1_000).toFixed(1);
  return locale === "zh-CN"
    ? `${timing.active ? "已用" : "总耗时"} ${seconds} 秒`
    : `${timing.active ? "Elapsed" : "Total time"} ${seconds}s`;
}

interface Exchange {
  user: ConversationItem;
  start: number;
  step?: string;
  firstResponse?: number;
  end?: number;
  agentInitializationStartedAt?: number;
  agentInitializationMs?: number;
  agentInitializationBoundary?: string;
  agentInitializationEstimated?: boolean;
  agentInitializationStatus?: string;
  queueStartedAt?: number;
  queueMs?: number;
  queueStatus?: string;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function terminal(item: ConversationItem): boolean {
  if (typeof item.data?.runTerminal === "boolean") return item.data.runTerminal;
  return (item.kind === "result" && item.role === "assistant" && item.status === "complete") ||
    (item.kind === "error" && (item.role === "assistant" || item.role === "system"));
}

/** Wall-clock time for each submission, independent of tool durations or UI grouping.
 * Input is transport order, before display lane reordering or synthetic rows.
 * Only observed terminal records close history; a later user never supplies a
 * fabricated end. Step ownership prevents late prior-run output crossing users.
 */
export function executionTimings(
  items: readonly ConversationItem[],
  options: { nowMs: number; status: ConversationStatus; stoppedAt?: string },
): ReadonlyMap<string, ExecutionTiming> {
  const exchanges = new Map<string, Exchange>();
  const currentByTurn = new Map<string, string>();
  const stepOwners = new Map<string, string>();
  let latestUser: string | undefined;

  for (const item of items) {
    if (item.role === "user") {
      if (item.data?.clarifyResponse === true) continue;
      const start = timestamp(item.timestamp);
      currentByTurn.delete(item.turnId);
      if (start === undefined) continue;
      exchanges.set(item.id, { user: item, start });
      currentByTurn.set(item.turnId, item.id);
      latestUser = item.id;
      continue;
    }
    if (item.data?.mainRun === false) continue;
    const step = typeof item.data?.runStepId === "string" ? item.data.runStepId : undefined;
    const stepKey = step ? `${item.turnId}:${step}` : undefined;
    const owner = (stepKey && stepOwners.get(stepKey)) || currentByTurn.get(item.turnId);
    if (!owner) continue;
    const exchange = exchanges.get(owner)!;
    if (exchange.end !== undefined || (exchange.step && step && exchange.step !== step)) continue;
    const at = timestamp(item.timestamp);
    if (at === undefined || at < exchange.start) continue;
    if (stepKey) stepOwners.set(stepKey, owner);
    if (item.data?.executionPhase === "execution_queue") {
      const phaseStatus = typeof item.data.phaseStatus === "string" ? item.data.phaseStatus : undefined;
      const duration = typeof item.data.phaseDurationMs === "number" &&
        Number.isFinite(item.data.phaseDurationMs) && item.data.phaseDurationMs >= 0
        ? item.data.phaseDurationMs : undefined;
      exchanges.set(owner, {
        ...exchange,
        step: exchange.step ?? step,
        queueStartedAt: exchange.queueStartedAt ?? at,
        queueMs: phaseStatus === "running" ? exchange.queueMs : duration ?? exchange.queueMs,
        queueStatus: phaseStatus ?? exchange.queueStatus,
      });
      continue;
    }
    if (item.data?.executionPhase === "agent_initialization") {
      const phaseStatus = typeof item.data.phaseStatus === "string"
        ? item.data.phaseStatus : undefined;
      const duration = typeof item.data.phaseDurationMs === "number" &&
        Number.isFinite(item.data.phaseDurationMs) && item.data.phaseDurationMs >= 0
        ? item.data.phaseDurationMs : undefined;
      exchanges.set(owner, {
        ...exchange,
        step: exchange.step ?? step,
        agentInitializationStartedAt: exchange.agentInitializationStartedAt ?? at,
        agentInitializationMs: phaseStatus === "running"
          ? exchange.agentInitializationMs : duration ?? exchange.agentInitializationMs,
        agentInitializationBoundary: typeof item.data.phaseBoundary === "string"
          ? item.data.phaseBoundary : exchange.agentInitializationBoundary,
        agentInitializationEstimated: item.data.phaseDurationEstimated === true ||
          exchange.agentInitializationEstimated,
        agentInitializationStatus: phaseStatus ?? exchange.agentInitializationStatus,
      });
      continue;
    }
    const isTerminal = terminal(item);
    const isResponse = !isTerminal && item.data?.thinkingStatus !== true &&
      item.kind !== "status" && item.kind !== "progress" &&
      (item.content.trim() !== "" || item.kind === "tool_call");
    exchanges.set(owner, {
      ...exchange,
      step: exchange.step ?? step,
      firstResponse: exchange.firstResponse ?? (isResponse ? at : undefined),
      end: isTerminal ? at : undefined,
    });
  }

  return new Map([...exchanges].map(([id, exchange]) => {
    const latest = id === latestUser;
    const stopped = timestamp(exchange.user.data?.runStoppedAt) ??
      (latest ? timestamp(options.stoppedAt) : undefined);
    const end = exchange.end ?? stopped;
    const active = end === undefined && latest &&
      (options.status === "running" || exchange.user.status === "pending");
    const until = end ?? (active && Number.isFinite(options.nowMs) ? options.nowMs : undefined);
    const agentInitializing = active && exchange.agentInitializationStatus === "running" &&
      exchange.agentInitializationStartedAt !== undefined;
    const liveAgentInitializationMs = agentInitializing && Number.isFinite(options.nowMs)
      ? Math.max(0, options.nowMs - exchange.agentInitializationStartedAt!) : undefined;
    const queued = active && exchange.queueStatus === "running" && exchange.queueStartedAt !== undefined;
    const liveQueueMs = queued && Number.isFinite(options.nowMs)
      ? Math.max(0, options.nowMs - exchange.queueStartedAt!) : undefined;
    return [id, {
      totalMs: until === undefined ? undefined : Math.max(0, until - exchange.start),
      // Final-only historical replies lost their first streaming timestamp;
      // do not mislabel the entire run as measured time-to-first-response.
      waitingMs: exchange.firstResponse !== undefined
        ? Math.max(0, exchange.firstResponse - exchange.start)
        : active && until !== undefined ? Math.max(0, until - exchange.start) : undefined,
      agentInitializationMs: exchange.agentInitializationMs ?? liveAgentInitializationMs,
      agentInitializationBoundary: exchange.agentInitializationBoundary,
      agentInitializationEstimated: exchange.agentInitializationEstimated,
      queueMs: exchange.queueMs ?? liveQueueMs,
      queued,
      agentInitializing,
      active,
      awaitingResponse: active && exchange.firstResponse === undefined,
    }];
  }));
}
