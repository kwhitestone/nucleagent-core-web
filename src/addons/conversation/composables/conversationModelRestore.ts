import type { Conversation, ModelChoice } from "@/addons/conversation/api/types";

type ConversationModelFields = Pick<Conversation, "providerId" | "model">;

/** Map a persisted conversation selection to the picker contract. */
export function conversationModelChoice(
  conversation: ConversationModelFields,
): ModelChoice | null {
  const providerId = conversation.providerId;
  const model = conversation.model?.trim() ?? "";
  if (!Number.isInteger(providerId) || Number(providerId) <= 0 || !model) return null;
  return { providerId: Number(providerId), model };
}

/**
 * Only the newest route-detail request may update the picker. Vue reuses the
 * Conversation view while /chat/:id changes, so an older response can arrive
 * after the newly selected conversation without this generation guard.
 */
export function createLatestConversationModelLoader(
  loadConversation: (id: string) => Promise<ConversationModelFields>,
) {
  let generation = 0;
  return {
    async load(id: string): Promise<ModelChoice | null | undefined> {
      const requestGeneration = ++generation;
      try {
        const conversation = await loadConversation(id);
        if (requestGeneration !== generation) return undefined;
        return conversationModelChoice(conversation);
      } catch (error) {
        if (requestGeneration !== generation) return undefined;
        throw error;
      }
    },
    invalidate(): void {
      generation += 1;
    },
  };
}
