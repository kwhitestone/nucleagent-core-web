import { computed, onBeforeUnmount, shallowRef } from "vue";

import {
  CONVERSATION_PROTOCOL_VERSION,
  createConversationState,
  createEventBatcher,
  DEFAULT_PAGE_SIZE,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  MAX_ID_LENGTH,
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_MESSAGE_CONTENT_BYTES,
  parseCommandResult,
  parseConversationAttachment,
  parseConversationEvent,
  parseConversationPage,
  parseConversationSnapshot,
  reduceConversation,
  selectTurns,
  type ConnectionStatus,
  type ConversationAdapter,
  type ConversationAttachment,
  type ConversationCommand,
  type ConversationEvent,
  type ConversationItem,
  type ConversationSnapshot,
  type ConversationState,
} from "../core";
import { isAuthenticationFailure, retryDelayMs } from "./retryPolicy";

const randomId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `atc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface ConversationControllerOptions {
  conversationKey: () => string;
  adapter: () => ConversationAdapter;
  onConnectionChange: (status: ConnectionStatus) => void;
  onStatusChange: (status: ConversationState["status"]) => void;
  onError: (error: Error) => void;
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export const useConversation = (options: ConversationControllerOptions) => {
  const state = shallowRef(createConversationState(options.conversationKey()));
  const snapshotStatus = shallowRef<"loading" | "ready" | "error">("loading");
  const authoritativeReady = shallowRef(false);
  let hasSnapshot = false;
  let currentAdapter: ConversationAdapter | undefined;
  let lifecycleController: AbortController | undefined;
  let snapshotInFlightGeneration: number | undefined;
  let subscriptionGeneration = 0;
  let lastReportedError = "";
  let subscription:
    | {
        controller: AbortController;
        generation: number;
        promise: Promise<void>;
      }
    | undefined;

  const reportError = (error: Error) => {
    const key = `${error.name}:${error.message}`;
    if (key === lastReportedError) return;
    lastReportedError = key;
    options.onError(error);
  };

  const clearReportedError = () => {
    lastReportedError = "";
  };

  const waitForRetry = (signal: AbortSignal, attempt: number) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, retryDelayMs(attempt));
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const dispatch = (action: Parameters<typeof reduceConversation>[1]) => {
    const previousConnection = state.value.connection.status;
    const previousStatus = state.value.status;
    state.value = reduceConversation(state.value, action);
    if (previousConnection !== state.value.connection.status) {
      options.onConnectionChange(state.value.connection.status);
    }
    if (previousStatus !== state.value.status)
      options.onStatusChange(state.value.status);
  };

  const applySnapshot = (snapshot: ConversationSnapshot, signal: AbortSignal, generation: number) => {
    if (signal.aborted || generation !== subscriptionGeneration) return;
    const newest = snapshot.items.at(-1);
    const event: ConversationEvent = {
      protocolVersion: CONVERSATION_PROTOCOL_VERSION,
      type: "snapshot",
      conversationKey: state.value.conversationKey,
      eventId: randomId(),
      cursor: snapshot.cursor ?? "",
      turnId: newest?.turnId ?? "snapshot",
      streamId: newest?.streamId ?? "snapshot",
      lane: newest?.lane ?? "system",
      revision: newest?.revision ?? 0,
      seq: newest?.seq ?? 0,
      timestamp: new Date().toISOString(),
      snapshot,
    };
    dispatch({ type: "event.received", event });
    hasSnapshot = true;
    snapshotStatus.value = "ready";
  };

  const saveSnapshot = () => {
    if (!hasSnapshot || !currentAdapter?.cacheSnapshot) return;
    const current = state.value;
    try {
      currentAdapter.cacheSnapshot({
        // order is only the render window; preserve the complete loaded set.
        items: current.loadedOrder.map((id) => current.items[id]),
        status: current.status,
        cursor: current.cursor,
        olderCursor: current.olderCursor,
        hasOlder: current.hasOlder,
      });
    } catch (error) { reportError(toError(error)); }
  };

  const retireUnauthorizedSnapshot = (error: unknown) => {
    if (!isAuthenticationFailure(error)) return;
    batcher.cancel();
    hasSnapshot = false;
    authoritativeReady.value = false;
    snapshotStatus.value = "error";
    state.value = createConversationState(state.value.conversationKey);
  };

  const loadSnapshot = async (signal: AbortSignal, generation: number) => {
    if (snapshotInFlightGeneration === generation || signal.aborted) return;
    snapshotInFlightGeneration = generation;
    dispatch({ type: "connection.changed", status: "connecting" });
    try {
      const snapshot = parseConversationSnapshot(
        await options.adapter().loadSnapshot({
          conversationKey: options.conversationKey(),
          limit: DEFAULT_PAGE_SIZE,
          signal,
        }),
      );
      if (signal.aborted || generation !== subscriptionGeneration) return;
      applySnapshot(snapshot, signal, generation);
      authoritativeReady.value = true;
      clearReportedError();
    } catch (error) {
      if (!signal.aborted && generation === subscriptionGeneration) {
        snapshotStatus.value = "error";
        retireUnauthorizedSnapshot(error);
      }
      throw error;
    } finally {
      if (snapshotInFlightGeneration === generation)
        snapshotInFlightGeneration = undefined;
    }
  };

  const batcher = createEventBatcher((events) => {
    let answerSettled = false;
    for (const event of events) {
      dispatch({ type: "event.received", event });
      if (state.value.connection.needsSnapshot) {
        restartSubscription(true);
        break;
      }
      // 答案终态（answer lane 的 complete item）后触发一次静默快照对账：
      // SSE fanout 在订阅者积压时会丢帧（broker 非阻塞 dispatch），live 状态
      // 可能残留服务端已删除的条目（重复思考气泡）。快照全量替换是最可靠
      // 的收敛手段——一轮结束时刻做，代价可控。
      if (
        event.type === "item.upsert" &&
        event.item.lane === "answer" &&
        event.item.status === "complete" &&
        event.item.kind !== "tool_call"
      ) {
        answerSettled = true;
      }
    }
    if (answerSettled && !state.value.connection.needsSnapshot) {
      // 快照会把 adapter 的 per-item revision 重置为 1，因此不能与原 SSE
      // generator 并行：否则快照请求期间到达的旧 epoch 帧会再次制造 gap。
      // 先中止旧订阅，再由新 generation 完成快照和带 cursor 的重连。
      restartSubscription(true);
    }
  });

  const subscribe = async (
    signal: AbortSignal,
    generation: number,
    refreshSnapshot: boolean,
  ) => {
    if (refreshSnapshot) {
      let snapshotLoaded = false;
      let retryAttempt = 0;
      while (!signal.aborted && !snapshotLoaded) {
        try {
          await loadSnapshot(signal, generation);
          snapshotLoaded = true;
        } catch (error) {
          if (signal.aborted) return;
          const normalized = toError(error);
          dispatch({
            type: "connection.changed",
            status: isAuthenticationFailure(error) ? "error" : "reconnecting",
            error: normalized.message,
          });
          reportError(normalized);
          if (isAuthenticationFailure(error)) return;
          await waitForRetry(signal, retryAttempt++);
        }
      }
    }
    if (signal.aborted || generation !== subscriptionGeneration) return;
    while (!signal.aborted) {
      try {
        const events = options.adapter().subscribe({
          conversationKey: options.conversationKey(),
          cursor: state.value.cursor,
          signal,
        });
        for await (const event of events) {
          if (signal.aborted) break;
          clearReportedError();
          batcher.push(parseConversationEvent(event));
        }
        batcher.flush();
        if (signal.aborted) return;
        if (["completed", "failed", "cancelled"].includes(state.value.status)) {
          dispatch({ type: "connection.changed", status: "disconnected" });
          if (subscription?.generation === generation) subscription = undefined;
          return;
        }
        throw new Error("Conversation stream disconnected");
      } catch (error) {
        if (signal.aborted) return;
        const normalized = toError(error);
        retireUnauthorizedSnapshot(error);
        dispatch({
          type: "connection.changed",
          status: isAuthenticationFailure(error) ? "error" : "reconnecting",
          error: normalized.message,
        });
        reportError(normalized);
        if (isAuthenticationFailure(error)) return;
      }

      let snapshotLoaded = false;
      let retryAttempt = 0;
      while (!signal.aborted && !snapshotLoaded) {
        await waitForRetry(signal, retryAttempt++);
        if (signal.aborted) return;
        try {
          await loadSnapshot(signal, generation);
          snapshotLoaded = true;
        } catch (error) {
          if (signal.aborted) return;
          const normalized = toError(error);
          dispatch({
            type: "connection.changed",
            status: isAuthenticationFailure(error) ? "error" : "reconnecting",
            error: normalized.message,
          });
          reportError(normalized);
          if (isAuthenticationFailure(error)) return;
        }
      }
    }
  };

  function ensureSubscription(refreshSnapshot = false): void {
    const lifecycle = lifecycleController;
    if (!lifecycle || lifecycle.signal.aborted || subscription) return;
    const controller = new AbortController();
    const generation = ++subscriptionGeneration;
    const abortSubscription = () => controller.abort();
    lifecycle.signal.addEventListener("abort", abortSubscription, {
      once: true,
    });
    const current = {
      controller,
      generation,
      promise: Promise.resolve(),
    };
    // 先登记 current，再启动可能同步推进到首帧的 adapter.subscribe。
    // 否则同步 scheduler/测试环境可在赋值前触发 restart，随后旧 current
    // 反向覆盖新订阅，造成“旧流已 abort、但新流从未启动”。
    subscription = current;
    current.promise = subscribe(
      controller.signal,
      generation,
      refreshSnapshot,
    ).finally(() => {
      lifecycle.signal.removeEventListener("abort", abortSubscription);
      if (subscription === current) subscription = undefined;
    });
  }

  function restartSubscription(refreshSnapshot: boolean): void {
    batcher.cancel();
    subscription?.controller.abort();
    subscription = undefined;
    ensureSubscription(refreshSnapshot);
  }

  const initialize = async () => {
    // props may already point at another conversation. The captured adapter
    // remains the only owner allowed to save the state we are leaving.
    saveSnapshot();
    lifecycleController?.abort();
    subscription?.controller.abort();
    subscription = undefined;
    batcher.cancel();
    const lifecycle = new AbortController();
    lifecycleController = lifecycle;
    const generation = ++subscriptionGeneration;
    currentAdapter = options.adapter();
    hasSnapshot = false;
    authoritativeReady.value = false;
    snapshotStatus.value = "loading";
    state.value = createConversationState(options.conversationKey());
    try {
      try {
        const cached = currentAdapter.readCachedSnapshot?.();
        if (cached) applySnapshot(parseConversationSnapshot(cached), lifecycle.signal, generation);
      } catch (error) {
        // Optional local state must never block the authoritative request.
        reportError(toError(error));
      }
      await loadSnapshot(lifecycle.signal, generation);
      if (
        lifecycleController === lifecycle &&
        !lifecycle.signal.aborted &&
        generation === subscriptionGeneration
      ) {
        ensureSubscription();
      }
    } catch (error) {
      if (
        lifecycleController !== lifecycle ||
        lifecycle.signal.aborted ||
        generation !== subscriptionGeneration
      ) return;
      const normalized = toError(error);
      snapshotStatus.value = "error";
      dispatch({
        type: "connection.changed",
        status: "error",
        error: normalized.message,
      });
      reportError(normalized);
    }
  };

  const loadOlder = async (): Promise<void> => {
    if (
      !state.value.hasOlder ||
      !authoritativeReady.value ||
      !lifecycleController ||
      lifecycleController.signal.aborted
    )
      return;
    try {
      const page = parseConversationPage(
        await options.adapter().loadOlder({
          conversationKey: options.conversationKey(),
          cursor: state.value.olderCursor,
          limit: DEFAULT_PAGE_SIZE,
          signal: lifecycleController.signal,
        }),
      );
      if (!lifecycleController.signal.aborted)
        dispatch({ type: "history.prepended", page });
    } catch (error) {
      reportError(toError(error));
    }
  };

  const requireAuthoritativeHistory = () => {
    if (authoritativeReady.value) return;
    const error = new Error("Conversation history is still loading");
    reportError(error);
    throw error;
  };

  const execute = async (command: ConversationCommand) => {
    requireAuthoritativeHistory();
    const controller = lifecycleController;
    if (!controller || controller.signal.aborted) return;
    try {
      const result = parseCommandResult(
        await options.adapter().execute(command, { signal: controller.signal }),
      );
      if (controller !== lifecycleController || controller.signal.aborted) return result;
      if (!result.accepted)
        throw new Error(result.message || "Command was not accepted");
      if (result.item && result.activeAccepted !== false)
        dispatch({ type: "item.optimistic", item: result.item });
      if (
        (command.type === "send" && result.activeAccepted !== false) ||
        command.type === "retry" ||
        command.type === "rerun" ||
        command.type === "interaction.respond"
      ) {
        ensureSubscription();
      }
      return result;
    } catch (error) {
      reportError(toError(error));
      throw error;
    }
  };

  const reconcileSkippedSend = async (
    itemId: string,
    beforeSend: ConversationState,
    lifecycle: AbortController | undefined,
  ) => {
    if (!lifecycle || lifecycle !== lifecycleController || lifecycle.signal.aborted) return;
    batcher.flush();
    dispatch({ type: "item.optimistic.removed", itemId });
    // Undo only the optimistic status; retain newer SSE status or active work.
    if (
      state.value.status === "running" &&
      state.value.statusVersion === beforeSend.statusVersion &&
      state.value.cursor === beforeSend.cursor &&
      !Object.values(state.value.items).some(item => item.status === "pending" || item.status === "streaming")
    ) {
      state.value = { ...state.value, status: beforeSend.status };
      if (beforeSend.status !== "running") options.onStatusChange(beforeSend.status);
    }
    batcher.cancel();
    subscription?.controller.abort();
    subscription = undefined;
    const generation = ++subscriptionGeneration;
    const isCurrent = () => lifecycle === lifecycleController &&
      !lifecycle.signal.aborted && generation === subscriptionGeneration;
    authoritativeReady.value = false;
    try {
      await loadSnapshot(lifecycle.signal, generation);
    } catch (error) {
      if (!isCurrent()) return;
      // Other members already accepted: reconciliation must not restore the draft.
      reportError(toError(error));
      if (!isAuthenticationFailure(error)) ensureSubscription(true);
      return;
    }
    if (isCurrent()) ensureSubscription();
  };

  const send = async (
    content: string,
    attachments: readonly ConversationAttachment[] = [],
  ) => {
    requireAuthoritativeHistory();
    if (!content.trim()) {
      const error = new Error("Message content is required");
      reportError(error);
      throw error;
    }
    if (
      Array.from(content).length > MAX_MESSAGE_CONTENT_LENGTH ||
      new TextEncoder().encode(content).byteLength > MAX_MESSAGE_CONTENT_BYTES
    ) {
      const error = new Error(
        `Message content exceeds ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
      );
      reportError(error);
      throw error;
    }
    if (attachments.length > MAX_ATTACHMENTS) {
      const error = new Error(
        `At most ${MAX_ATTACHMENTS} attachments are allowed`,
      );
      reportError(error);
      throw error;
    }
    const clientMessageId = randomId();
    const timestamp = new Date().toISOString();
    const optimistic: ConversationItem = {
      id: `optimistic-${clientMessageId}`,
      turnId: `turn-${clientMessageId}`,
      streamId: `optimistic-${clientMessageId}`,
      lane: "interaction",
      role: "user",
      kind: "message",
      content,
      attachments,
      clientMessageId,
      status: "pending",
      revision: 0,
      seq: 0,
      timestamp,
    };
    const lifecycle = lifecycleController;
    const beforeSend = state.value;
    dispatch({ type: "item.optimistic", item: optimistic });
    try {
      const result = await execute({ type: "send", content, clientMessageId, attachments });
      if (result?.accepted && result.activeAccepted === false) {
        await reconcileSkippedSend(optimistic.id, beforeSend, lifecycle);
      }
    } catch (error) {
      if (lifecycle === lifecycleController && !lifecycle?.signal.aborted)
        dispatch({ type: "item.optimistic.removed", itemId: optimistic.id });
      throw error;
    }
  };

  const uploadAttachment = async (
    file: File,
  ): Promise<ConversationAttachment> => {
    if (!lifecycleController || !options.adapter().uploadAttachment) {
      throw new Error("Attachment upload is not supported");
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      const error = new Error(
        `Attachment exceeds ${MAX_ATTACHMENT_SIZE_BYTES} bytes`,
      );
      reportError(error);
      throw error;
    }
    if (file.name.length > 512 || file.type.length > 128) {
      const error = new Error(
        "Attachment name or media type exceeds the supported limit",
      );
      reportError(error);
      throw error;
    }
    try {
      return parseConversationAttachment(
        await options.adapter().uploadAttachment!(file, {
          conversationKey: options.conversationKey(),
          signal: lifecycleController.signal,
        }),
      );
    } catch (error) {
      reportError(toError(error));
      throw error;
    }
  };

  const stop = async () => {
    const lifecycle = lifecycleController;
    if (!lifecycle || lifecycle.signal.aborted) return;
    const hasActiveItem = Object.values(state.value.items).some(
      (item) => item.status === "pending" || item.status === "streaming",
    );
    if (state.value.status !== "running" && !hasActiveItem) return;
    await execute({ type: "stop" });
    if (lifecycle !== lifecycleController || lifecycle.signal.aborted) return;
    batcher.cancel();
    subscription?.controller.abort();
    subscription = undefined;
    // A reconciliation from the aborted stream may still be in flight. Give
    // cancellation its own generation so that request cannot suppress this one.
    const generation = ++subscriptionGeneration;
    const isCurrent = () =>
      lifecycle === lifecycleController &&
      generation === subscriptionGeneration &&
      !lifecycle.signal.aborted;
    dispatch({ type: "conversation.cancelled" });
    // Read the persisted cancellation timestamp and terminal message. A local
    // stop alone has no historical endpoint and discards queued final SSE rows.
    try {
      await loadSnapshot(lifecycle.signal, generation);
    } catch (error) {
      if (isCurrent()) reportError(toError(error));
    }
    if (!isCurrent()) return;
    dispatch({ type: "connection.changed", status: "disconnected" });
  };
  const retry = (itemId?: string, turnId?: string) =>
    execute({ type: "retry", itemId, turnId });
  const rerun = (turnId?: string) => execute({ type: "rerun", turnId });
  const respond = (interactionId: string, value: unknown) => {
    if (interactionId.length === 0 || interactionId.length > MAX_ID_LENGTH) {
      const error = new Error("Interaction ID exceeds the supported limit");
      reportError(error);
      return Promise.reject(error);
    }
    return execute({ type: "interaction.respond", interactionId, value });
  };

  const dispose = () => {
    saveSnapshot();
    lifecycleController?.abort();
    subscription?.controller.abort();
    subscription = undefined;
    subscriptionGeneration += 1;
    batcher.cancel();
    currentAdapter = undefined;
    hasSnapshot = false;
    authoritativeReady.value = false;
    snapshotStatus.value = "loading";
    state.value = createConversationState(options.conversationKey());
  };
  onBeforeUnmount(dispose);

  return {
    state,
    snapshotStatus: computed(() => snapshotStatus.value),
    authoritativeReady: computed(() => authoritativeReady.value),
    turns: computed(() => selectTurns(state.value)),
    initialize,
    loadOlder,
    send,
    stop,
    retry,
    rerun,
    respond,
    execute,
    uploadAttachment,
    executeWindowLatest: () => dispatch({ type: "window.latest" }),
    dispose,
  };
};
