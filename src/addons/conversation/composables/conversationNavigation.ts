import { getPlatformRuntime } from "@/contracts/platform-runtime";
import type { Conversation, CreateConversationRequest } from "../api/types";
import { createConversationNavigationCache } from "./conversationNavigationCache";
import { snapshotTiming } from "./conversationTiming";

export const conversationNavigation = createConversationNavigationCache(() => ({
  token: getPlatformRuntime().getAccessToken(),
  version: getPlatformRuntime().getSessionVersion(),
}));

/** The create response confirms this input was accepted. Show it immediately
 * while the first authoritative message snapshot supplies persisted IDs. */
export function seedCreatedConversation(conversation: Conversation, payload: CreateConversationRequest): void {
  const id = `created-user-${conversation.id}`;
  conversationNavigation.forConversation(String(conversation.id)).write({
    status: snapshotTiming(conversation).status,
    hasOlder: false,
    items: [{
      id, turnId: "main", streamId: id, lane: "answer", role: "user", kind: "text",
      content: payload.input, status: "complete", revision: 1, seq: 1,
      timestamp: conversation.createdAt,
      attachments: payload.attachments?.map((file) => ({
        id: file.fileId, name: file.name || file.fileId,
      })),
    }],
  });
}
