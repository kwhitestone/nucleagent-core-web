import { MessageNotSentError, type AppendMessage, type AttachmentAdapter, type ExternalStoreAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationAttachment, ConversationState } from "@/addons/conversation/task-conversation/core";
import { isRunning, toThreadMessages, type ThreadOptions } from "./threadMessages";
import { toConversationAttachments } from "./attachments";

/** The two controller calls the composer needs (useConversation's send/stop). */
export interface ChatController {
  send(content: string, attachments?: readonly ConversationAttachment[]): Promise<void>;
  stop(): Promise<void>;
}

export const appendText = (message: AppendMessage): string =>
  message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();

/**
 * ExternalStoreRuntime adapter (plan §2): Core + the existing reducer own history and run
 * state; assistant-ui only renders and forwards send/cancel. A failed send hands the draft
 * back to the composer (MessageNotSentError), like the Vue view keeps the input.
 */
export function externalStore(
  state: ConversationState, controller: ChatController, options?: ThreadOptions, attachments?: AttachmentAdapter,
): ExternalStoreAdapter<ThreadMessageLike> {
  return {
    messages: toThreadMessages(state, options),
    convertMessage: (message) => message,
    isRunning: isRunning(state),
    async onNew(message) {
      const text = appendText(message);
      if (!text) return;
      try {
        await controller.send(text, toConversationAttachments(message.attachments));
      } catch (error) {
        throw new MessageNotSentError(error instanceof Error ? error.message : String(error));
      }
    },
    onCancel: () => controller.stop(),
    ...(attachments ? { adapters: { attachments } } : {}),
  };
}
