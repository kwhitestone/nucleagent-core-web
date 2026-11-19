import { useEffect, useState, useSyncExternalStore } from "react";
import { SESSION_CHANGE_EVENT } from "@/contracts/platform-runtime";
import { createConversationAdapter } from "@/addons/conversation/composables/useConversationAdapter";
import { followUp } from "@/addons/conversation/api/conversation";
import type { EffortChoice } from "./requestEffort";
import { createConversationController } from "@/addons/conversation/task-conversation/conversationController";
import { observableBoxes } from "./observableBox";

type Controller = ReturnType<typeof createConversationController> & { subscribe: (l: () => void) => () => void };
const noop = () => () => {};

/**
 * The framework-free controller (snapshot → SSE → reducer, retry, optimistic send) is
 * subscribed with useSyncExternalStore; no Vue reactivity in the island. One adapter per id
 * (plan §3 risk: the adapter keeps per-conversation module state).
 */
export function useCoreConversation(id: string | undefined, onError: (error: Error) => void, turn: () => EffortChoice | Parameters<typeof followUp>[5] = () => "", defaultModel: () => Parameters<typeof followUp>[3] = () => undefined) {
  const [controller, setController] = useState<Controller | null>(null);
  useEffect(() => {
    if (!id) { setController(null); return; }
    // Same follow-up as the adapter's default, plus this turn's effort (gap2) or profile (MUYU-408), never both.
    const adapter = createConversationAdapter(() => id, {
      send: async (input, attachments) => { await followUp(id, input, attachments, defaultModel(), undefined, turn() || undefined); return { accepted: true }; },
    });
    const { box, subscribe } = observableBoxes();
    const c = { ...createConversationController({
      conversationKey: () => id, adapter: () => adapter,
      onConnectionChange() {}, onStatusChange() {}, onError,
    }, box), subscribe };
    setController(c);
    void c.initialize();
    // Same policy as TaskConversation: renewal keeps a ready history, sign-out drops it.
    const onSession = (event: Event) => {
      if ((event as CustomEvent<{ authenticated?: unknown }>).detail?.authenticated !== true) c.dispose();
      else if (!c.authoritativeReady.value) void c.initialize();
    };
    window.addEventListener(SESSION_CHANGE_EVENT, onSession);
    return () => { window.removeEventListener(SESSION_CHANGE_EVENT, onSession); c.dispose(); };
    // onError is a stable module-level function in ChatApp; turn reads a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const state = useSyncExternalStore(controller?.subscribe ?? noop, () => controller?.state.value ?? null);
  return controller && state ? { state, controller } : null;
}
