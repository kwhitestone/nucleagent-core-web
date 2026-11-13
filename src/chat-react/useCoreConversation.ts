import { useEffect, useState } from "react";
import { effectScope, watch } from "vue";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createConversationAdapter } from "@/addons/conversation/composables/useConversationAdapter";
import { useConversation } from "@/addons/conversation/task-conversation/vue/useConversation";
import type { ConversationState } from "@/addons/conversation/task-conversation/core";

type Controller = ReturnType<typeof useConversation>;

/**
 * The existing controller (snapshot → SSE → reducer, retry, optimistic send) runs unchanged
 * inside a detached Vue effect scope; React only mirrors its state. One adapter per id
 * (plan §3 risk: the adapter keeps per-conversation module state).
 */
export function useCoreConversation(id: string | undefined, onError: (error: Error) => void) {
  const [core, setCore] = useState<{ state: ConversationState; controller: Controller } | null>(null);
  useEffect(() => {
    if (!id) { setCore(null); return; }
    const scope = effectScope(true);
    const controller = scope.run(() => {
      const adapter = createConversationAdapter(() => id);
      const c = useConversation({
        conversationKey: () => id, adapter: () => adapter,
        onConnectionChange() {}, onStatusChange() {}, onError,
      });
      watch(c.state, (state) => setCore({ state, controller: c }), { immediate: true, flush: "sync" });
      return c;
    })!;
    void controller.initialize();
    // Same policy as TaskConversation: renewal keeps a ready history, sign-out drops it.
    const onSession = (event: Event) => {
      if ((event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated !== true) controller.dispose();
      else if (!controller.authoritativeReady.value) void controller.initialize();
    };
    window.addEventListener(SESSION_CHANGE_EVENT, onSession);
    return () => { window.removeEventListener(SESSION_CHANGE_EVENT, onSession); controller.dispose(); scope.stop(); };
    // onError is a stable module-level function in ChatApp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return core;
}
