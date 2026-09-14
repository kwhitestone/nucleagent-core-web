import { BroadcastApiError, broadcastCancel, broadcastFollowUp } from "../api/broadcast";
import type { BroadcastCancelResult, BroadcastFollowUpResult } from "../api/types";
import type { ConversationAdapter } from "../task-conversation/core";
import { createConversationAdapter } from "./useConversationAdapter";

export interface BroadcastAdapterOptions {
  groupId: string;
  activeId: string | number;
  /** Receives successes and complete rejections with member details, before a rejection is thrown. */
  onResult?: (result: BroadcastFollowUpResult | BroadcastCancelResult) => void;
}

export function createBroadcastAdapter(options: BroadcastAdapterOptions): ConversationAdapter {
  const { groupId, activeId, onResult } = options;
  const conversationId = String(activeId);

  function report(result: BroadcastFollowUpResult | BroadcastCancelResult): void {
    const logError = (error: unknown) => console.error("Broadcast result callback failed", error);
    // Notification failure must never make accepted backend work retryable.
    try { void Promise.resolve(onResult?.(result)).catch(logError); }
    catch (error) { logError(error); }
  }

  function reportFailure(error: unknown, command: "send" | "stop"): never {
    if (error instanceof BroadcastApiError) {
      if (command === "send" && (error.details.outcomes || error.details.skipped)) {
        report({ groupId, outcomes: error.details.outcomes ?? [], skipped: error.details.skipped ?? [] });
      } else if (command === "stop" && error.details.failed) {
        report({ groupId, cancelled: [], failed: error.details.failed });
      }
    }
    throw error;
  }

  return createConversationAdapter(() => conversationId, {
    async send(input, attachments, { signal }) {
      const result = await broadcastFollowUp(groupId, {
        input, ...(attachments?.length ? { attachments } : {}),
      }, signal).catch(error => reportFailure(error, "send"));
      const active = result.outcomes.find(outcome => String(outcome.conversationId) === conversationId);
      const acceptedElsewhere = result.outcomes
        .filter(outcome => outcome.accepted && String(outcome.conversationId) !== conversationId)
        .map(outcome => outcome.conversationId);
      report(result);
      if (active?.accepted) return { accepted: true };
      const reason = active ? active.reason || "follow-up rejected" : "not included in the broadcast outcomes";
      return {
        accepted: acceptedElsewhere.length > 0,
        activeAccepted: false,
        message: `Conversation ${conversationId}: ${reason}.` +
          (acceptedElsewhere.length ? ` Accepted by conversations: ${acceptedElsewhere.join(", ")}.` : ""),
      };
    },
    async stop({ signal }) {
      const result = await broadcastCancel(groupId, signal).catch(error => reportFailure(error, "stop"));
      report(result);
      const failure = result.failed.find(item => String(item.conversationId) === conversationId);
      if (failure) return {
        accepted: false,
        message: `Conversation ${conversationId}: ${failure.reason}.` +
          (result.cancelled?.length ? ` Cancelled conversations: ${result.cancelled.join(", ")}.` : ""),
      };
      return { accepted: true };
    },
  });
}
