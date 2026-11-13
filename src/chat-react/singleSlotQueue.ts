import { useEffect, useMemo, useReducer, useRef } from "react";
import type { AppendMessage, ExternalThreadQueueAdapter, QueueItemState } from "@assistant-ui/react";

/** The server still runs a turn (Core thought it was idle): keep the message for the run's end. */
export const isConflict = (error: unknown) => (error as { status?: unknown } | null)?.status === 409;

const textOf = (message: AppendMessage) =>
  message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();

export type SingleSlot = ReturnType<typeof createSingleSlot>;

/**
 * 325 §B.6: at most one pending message while a run is active; a new send replaces it.
 * Not aui's createMessageQueue: that is a multi-item FIFO whose steer cancels the live run.
 * enqueue and steer both "replace or create"; cancel pauses (the slot stays, no auto-send);
 * flush() is called on the run's end and sends the slot once.
 */
export function createSingleSlot(send: (message: AppendMessage) => Promise<void>, isRunning: () => boolean, onChange: () => void) {
  let slot: (QueueItemState & { message: AppendMessage }) | null = null;
  let items: readonly QueueItemState[] = []; // stable reference: aui reads it from a store snapshot
  let paused = false;
  let n = 0;
  const set = (message: AppendMessage | null) => {
    slot = message && {
      id: slot?.id ?? `slot-${++n}`, message, prompt: textOf(message),
      parts: message.content.filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text"),
    };
    items = slot ? [slot] : [];
    onChange();
  };
  async function flush() {
    if (paused || !slot || isRunning()) return;
    const { message } = slot;
    set(null);
    try {
      await send(message);
    } catch (error) {
      if (!slot) set(message); // never drop it; a newer queued message wins
      paused = !isConflict(error); // 409: retry at the next run's end; other errors wait for the user
    }
  }
  const put = (message: AppendMessage) => {
    paused = false;
    set(message);
    // shortcut: an idle send while a (cancelled) slot is shown replaces it and goes out now; no "send queued as is" button.
    if (!isRunning()) void flush();
  };
  const adapter: ExternalThreadQueueAdapter = {
    get items() { return items; },
    steerItems: [],
    enqueue: put,
    steer: put,
    move() {},
    edit: (_id, message) => set(message),
    remove: () => set(null),
    __internal_notifyCancelled: () => { paused = true; },
  };
  return {
    adapter,
    get size() { return slot ? 1 : 0; },
    /** onNew got 409: hold the message instead of handing it back as MessageNotSentError. */
    hold(message: AppendMessage) { paused = false; set(message); },
    flush,
  };
}

/** One slot per conversation; sends it when isRunning falls from true to false (unless cancelled). */
export function useSingleSlotQueue(key: string | undefined, running: boolean, send: (message: AppendMessage) => Promise<void>) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const live = useRef({ running, send });
  live.current = { running, send };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slot = useMemo(() => createSingleSlot((m) => live.current.send(m), () => live.current.running, bump), [key]);
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) void slot.flush();
    was.current = running;
  }, [running, slot]);
  return slot;
}
