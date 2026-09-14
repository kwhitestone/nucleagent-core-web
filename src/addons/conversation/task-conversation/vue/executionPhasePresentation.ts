import type { ConversationLocale } from "../core/types.ts";

export function isExecutionPhaseData(data?: Readonly<Record<string, unknown>>): boolean {
  return data?.executionPhase === "agent_initialization" || data?.executionPhase === "execution_queue";
}

/** Lifecycle state belongs in its child bubble; all elapsed text uses its right slot. */
export function executionPhaseLabel(
  data: Readonly<Record<string, unknown>> | undefined,
  locale: ConversationLocale,
): string | undefined {
  if (!isExecutionPhaseData(data)) return undefined;
  const english = locale !== "zh-CN";
  if (data?.executionPhase === "execution_queue") {
    switch (data.phaseStatus) {
      case "cancelled": return english ? "Queue cancelled" : "排队已取消";
      case "failed": return english ? "Queue failed" : "排队失败";
      case "unavailable": return english ? "Queue duration unavailable" : "排队耗时未知";
      default: return english ? "Queued" : "排队等待";
    }
  }
  const base = data?.phaseBoundary === "opencode_prompt_accepted"
    ? english ? "OpenCode ready" : "OpenCode 准备"
    : english ? "Agent initialization" : "Agent 初始化";
  switch (data?.phaseStatus) {
    case "running": return english ? "Initializing agent" : "Agent 初始化中";
    case "failed": return english ? `${base} failed` : `${base}失败`;
    case "cancelled": return english ? `${base} cancelled` : `${base}已取消`;
    case "unavailable": return english ? "Agent init duration unavailable" : "Agent 初始化耗时未知";
    default: return base;
  }
}

export function queuePositionText(data: Readonly<Record<string, unknown>>, locale: ConversationLocale): string {
  const position = data.queuePosition;
  if (data.phaseStatus !== "running" || typeof position !== "number" ||
      !Number.isSafeInteger(position) || position < 1) return "";
  const ahead = position - 1;
  return locale === "zh-CN" ? `前面还有 ${ahead} 个请求`
    : `${ahead} ${ahead === 1 ? "request" : "requests"} ahead`;
}
