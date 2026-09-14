import type { Conversation, Message } from "../api/types.ts";
import type { ConversationStatus } from "../task-conversation/core/types.ts";

/** Preserve only the transport facts needed to time the main reply. */
export function messageTimingData(message: Message): Record<string, unknown> {
  const meta = message.metadata;
  const executionPhase = meta?.execution_phase === "agent_initialization" || meta?.execution_phase === "execution_queue"
    ? meta.execution_phase : undefined;
  const phaseStatus = ["running", "completed", "failed", "cancelled"].includes(String(meta?.phase_status))
    ? String(meta?.phase_status) : undefined;
  const phaseDurationMs = typeof meta?.duration_ms === "number" &&
    Number.isFinite(meta.duration_ms) && meta.duration_ms >= 0
    ? meta.duration_ms : undefined;
  const mainRun = message.senderType !== "agent" ||
    message.senderName === "agent" || message.senderName === "agent.thinking";
  return {
    ...(typeof meta?.step_id === "string" ? { runStepId: meta.step_id } : {}),
    mainRun,
    runTerminal: mainRun && (
      (message.senderType === "agent" && message.msgType === "result") ||
      (["agent", "system"].includes(message.senderType) && message.msgType === "error")
    ),
    ...(meta?.thinkingStatus === true ? { thinkingStatus: true } : {}),
    ...(typeof meta?.clarify_request_id === "string" ? { clarifyResponse: true } : {}),
    ...(executionPhase && phaseStatus ? {
      executionPhase,
      phaseStatus,
      ...(typeof meta?.phase_boundary === "string" ? { phaseBoundary: meta.phase_boundary } : {}),
      ...(phaseDurationMs !== undefined ? { phaseDurationMs } : {}),
      ...(meta?.duration_source === "core_wall_clock_cutoff" ? { phaseDurationEstimated: true } : {}),
      ...(executionPhase === "execution_queue" && typeof meta?.queue_position === "number" &&
        Number.isSafeInteger(meta.queue_position) && meta.queue_position >= 1 ? { queuePosition: meta.queue_position } : {}),
      ...(executionPhase === "execution_queue" &&
        ["executor_capacity", "executor_unavailable"].includes(String(meta?.queue_reason))
        ? { queueReason: meta?.queue_reason } : {}),
    } : {}),
  };
}

export function snapshotTiming(conversation: Pick<Conversation, "status" | "completedAt">): {
  status: ConversationStatus;
  stoppedAt?: string;
} {
  const status = conversation.status === "executing" || conversation.status === "blocked"
    ? "running" : conversation.status === "drafting" ? "idle" : conversation.status;
  const stoppedAt = ["completed", "failed", "cancelled"].includes(status) &&
    typeof conversation.completedAt === "string" && Number.isFinite(Date.parse(conversation.completedAt))
    ? conversation.completedAt : undefined;
  return { status, stoppedAt };
}
