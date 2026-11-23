import { useEffect, useMemo, useReducer, useRef } from "react";
import type { AppendMessage, ExternalThreadQueueAdapter, QueueItemState } from "@assistant-ui/react";

/** The server still runs a turn (Core thought it was idle): keep the message for the run's end. */
export const isConflict = (error: unknown) => (error as { status?: unknown } | null)?.status === 409;

/** Text of one composer message (text parts joined by newlines, trimmed). */
export const textOf = (message: AppendMessage) =>
  message.content.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();

export type SingleSlot = ReturnType<typeof createSingleSlot>;

/** MUYU-365 fix-video-swallow: why the pending message has not gone out. retry: auto = a timer/run end retries it. */
export interface SlotFailure { status: number; code: string; message: string; retryAfterMs?: number; retry: "auto" | "manual"; attempt: number; at?: number }

/** status/code/message (+ Retry-After seconds in the problem body) of an ApiError-like error; 0 = no HTTP answer. */
export function failureOf(error: unknown): Omit<SlotFailure, "retry" | "attempt"> {
  const e = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown; problem?: { retryAfter?: unknown } };
  const after = Number(e.problem?.retryAfter);
  return {
    status: typeof e.status === "number" ? e.status : 0, code: typeof e.code === "string" ? e.code : "",
    message: typeof e.message === "string" ? e.message : String(error),
    ...(after > 0 ? { retryAfterMs: after * 1000 } : {}),
  };
}

export interface SlotOptions {
  /** Called once per refusal (toast); the slot keeps the reason in `failure` for the composer. */
  onFailure?(failure: SlotFailure): void;
  retryMs?: number; maxRetries?: number;
  setTimer?(run: () => void, ms: number): unknown; clearTimer?(id: unknown): void;
}

/**
 * 325 §B.6: at most one pending message while a run is active; a new send replaces it.
 * Not aui's createMessageQueue: that is a multi-item FIFO whose steer cancels the live run.
 * enqueue and steer both "replace or create"; cancel pauses (the slot stays, no auto-send);
 * flush() is called on the run's end and sends the slot once.
 */
export function createSingleSlot(send: (message: AppendMessage) => Promise<void>, isRunning: () => boolean, onChange: () => void, options: SlotOptions = {}) {
  const { retryMs = 10_000, maxRetries = 3, setTimer = (run, ms) => setTimeout(run, ms), clearTimer = (id) => clearTimeout(id as never) } = options;
  let slot: (QueueItemState & { message: AppendMessage }) | null = null;
  let items: readonly QueueItemState[] = []; // stable reference: aui reads it from a store snapshot
  let paused = false;
  let failure: SlotFailure | null = null;
  let timer: unknown;
  let n = 0;
  const stopTimer = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
  const set = (message: AppendMessage | null, reason: SlotFailure | null = null) => {
    stopTimer();
    failure = message ? reason : null;
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
      const base = failureOf(error);
      const { status } = base;
      // 409 (a turn still runs): the next run end retries; 429 (media_busy): a timer retries, at most maxRetries times.
      // 4xx: permanent, dropped. No HTTP answer (0) or 5xx: may have been accepted (paid) → only the user retries.
      const auto = status === 409 || (status === 429 && attempt <= maxRetries);
      const next: SlotFailure = { ...base, retry: auto ? "auto" : "manual", attempt };
      const permanent = status >= 400 && status < 500 && status !== 409 && status !== 429;
      if (!slot && !permanent) {
        set(message, next); // never drop a retryable one; a newer queued message wins
        paused = !auto || status === 429;
        if (status === 429 && auto) {
          const ms = base.retryAfterMs ?? retryMs;
          failure = { ...next, at: Date.now() + ms };
          const id = timer = setTimer(() => { if (timer !== id) return; timer = undefined; paused = false; attempt += 1; void flush(); }, ms);
        }
      }
      options.onFailure?.(next);
    }
  }
  let attempt = 1;
  const put = (message: AppendMessage) => {
    paused = false;
    attempt = 1;
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
    __internal_notifyCancelled: () => {
      paused = true;
      if (slot) { stopTimer(); failure = { status: 0, code: "paused", message: "", retry: "manual", attempt }; onChange(); }
    },
  };
  return {
    adapter,
    get size() { return slot ? 1 : 0; },
    /** Why the pending message waits; null while it simply waits for the run's end. */
    get failure() { return failure; },
    /** 「立即重试」: send it now (still not during a run). */
    retryNow() { paused = false; attempt = 1; return flush(); },
    /** onNew got 409: hold the message instead of handing it back as MessageNotSentError. */
    hold(message: AppendMessage) { paused = false; set(message, { status: 409, code: "", message: "", retry: "auto", attempt }); },
    flush,
  };
}

/** One slot per conversation; sends it when isRunning falls from true to false (unless cancelled). */
export function useSingleSlotQueue(key: string | undefined, running: boolean, send: (message: AppendMessage) => Promise<void>, onFailure?: (failure: SlotFailure) => void) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const live = useRef({ running, send, onFailure });
  live.current = { running, send, onFailure };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const slot = useMemo(() => createSingleSlot((m) => live.current.send(m), () => live.current.running, bump, { onFailure: (f) => live.current.onFailure?.(f) }), [key]);
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) void slot.flush();
    was.current = running;
  }, [running, slot]);
  return slot;
}

type Say = (key: string) => string;
const fill = (text: string, values: Record<string, unknown>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/** User text for a refused send (zh/en via t): media_busy names the kind's concurrency limit; never empty. */
export function slotReason(failure: SlotFailure, t: Say, media?: { kind: "image" | "video"; limit: number }) {
  const { status, code } = failure;
  if (code === "paused") return t("chatReact.queuePaused");
  if (status === 429 || code === "media_busy") return media ? fill(t(`chatReact.queueBusy_${media.kind}`), { n: media.limit }) : t("chatReact.queueBusy");
  if (status === 409) return t("chatReact.queueConflict");
  if (!status || status >= 500) return t("chatReact.queueNetwork");
  return fill(t("chatReact.queueDropped"), { reason: failure.message || code || status });
}
