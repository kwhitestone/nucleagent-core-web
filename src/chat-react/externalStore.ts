import { MessageNotSentError, type AppendMessage, type AttachmentAdapter, type ExternalStoreAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationAttachment, ConversationState } from "@/addons/conversation/task-conversation/core";
import { isRunning, toThreadMessages, type ThreadOptions } from "./threadMessages";
import { toConversationAttachments } from "./attachments";
import { isConflict, type SingleSlot } from "./singleSlotQueue";

/** The two controller calls the composer needs (useConversation's send/stop). */
export interface ChatController {
  send(content: string, attachments?: readonly ConversationAttachment[]): Promise<void>;
  stop(): Promise<void>;
}

/** Sends one composer message through the controller (text + stored attachment refs). */
export const sendAppend = (controller: ChatController, message: AppendMessage) =>
  controller.send(appendText(message), toConversationAttachments(message.attachments));

export const appendText = (message: AppendMessage): string =>
  message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();

/**
 * ExternalStoreRuntime adapter (plan §2): Core + the existing reducer own history and run
 * state; assistant-ui only renders and forwards send/cancel. A failed send hands the draft
 * back to the composer (MessageNotSentError), like the Vue view keeps the input. With a `slot`,
 * sends during a run wait in the single-slot queue and a 409 parks the message there.
 */
export function externalStore(
  state: ConversationState, controller: ChatController, options?: ThreadOptions, attachments?: AttachmentAdapter,
  slot?: SingleSlot,
): ExternalStoreAdapter<ThreadMessageLike> {
  return {
    messages: toThreadMessages(state, options),
    convertMessage: (message) => message,
    isRunning: isRunning(state),
    async onNew(message) {
      const text = appendText(message);
      if (!text) return;
      try {
        await sendAppend(controller, message);
      } catch (error) {
        if (slot && isConflict(error)) return slot.hold(message);
        throw new MessageNotSentError(error instanceof Error ? error.message : String(error));
      }
    },
    onCancel: () => controller.stop(),
    ...(slot ? { queue: slot.adapter } : {}),
    ...(attachments ? { adapters: { attachments } } : {}),
  };
}
