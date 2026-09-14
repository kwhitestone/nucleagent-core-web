import type { Conversation } from "@/addons/conversation/api/types";

type ConversationBackendFields = Pick<Conversation, "executionBackend">;

export function conversationExecutionBackend(
  conversation: ConversationBackendFields,
): string | null {
  const value = conversation.executionBackend?.trim() ?? "";
  return value || null;
}

export function createLatestConversationBackendLoader(
  loadConversation: (id: string) => Promise<ConversationBackendFields>,
) {
  let generation = 0;
  return {
    async load(id: string): Promise<string | null | undefined> {
      const requestGeneration = ++generation;
      try {
        const conversation = await loadConversation(id);
        if (requestGeneration !== generation) return undefined;
        return conversationExecutionBackend(conversation);
      } catch (error) {
        if (requestGeneration !== generation) return undefined;
        throw error;
      }
    },
    invalidate(): void { generation += 1; },
  };
}
