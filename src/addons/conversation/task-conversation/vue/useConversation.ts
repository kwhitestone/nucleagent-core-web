import { computed, getCurrentInstance, onBeforeUnmount, shallowRef } from "vue";
import { selectTurns } from "../core";
import { createConversationController, type ConversationControllerOptions } from "../conversationController";

/** Vue view of the framework-free controller, boxes backed by shallowRef. */
export const useConversation = (options: ConversationControllerOptions) => {
  const c = createConversationController(options, shallowRef);
  if (getCurrentInstance()) onBeforeUnmount(c.dispose);
  return {
    ...c,
    snapshotStatus: computed(() => c.snapshotStatus.value),
    authoritativeReady: computed(() => c.authoritativeReady.value),
    turns: computed(() => selectTurns(c.state.value)),
  };
};
