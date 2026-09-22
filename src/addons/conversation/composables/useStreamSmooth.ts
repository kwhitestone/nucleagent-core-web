import { computed, onScopeDispose, ref, watch, type ComputedRef } from "vue";

export interface StreamSmoothState {
  /** Characters currently revealed. */
  displayed: number;
  /** Target length observed on the previous frame, for the arrival estimate. */
  target: number;
  /** Sliding estimate of characters arriving per frame. */
  rate: number;
}

/** Weight of the newest frame in the arrival-rate estimate (~10 frame window). */
const RATE_SMOOTHING = 0.2;
/** Never trail the real content by more than this; dump the excess instead. */
const MAX_LAG_CHARS = 240;

export const initialStreamSmoothState: StreamSmoothState = { displayed: 0, target: 0, rate: 0 };

/**
 * One catch-up frame. `complete` jumps straight to the full content so the
 * final answer is never withheld by the animation, and the displayed length is
 * clamped to the target so a truncated or rewritten stream cannot slice past
 * the end.
 */
export function nextStreamSmoothState(
  prev: StreamSmoothState,
  targetLen: number,
  complete: boolean,
): StreamSmoothState {
  const target = Math.max(0, targetLen);
  const displayed = Math.min(prev.displayed, target);
  if (complete) return { displayed: target, target, rate: 0 };
  const arrived = target - Math.min(prev.target, target);
  const rate = prev.rate + (arrived - prev.rate) * RATE_SMOOTHING;
  const step = Math.max(1, Math.ceil(rate), target - displayed - MAX_LAG_CHARS);
  return { displayed: Math.min(target, displayed + step), target, rate };
}

/**
 * Reveal streaming text at the rate it arrives instead of in 20Hz jumps.
 * Without animation frames (SSR) the content passes through unsmoothed.
 */
export function useStreamSmooth(
  content: () => string,
  complete: () => boolean,
  schedule?: (callback: () => void) => number,
  cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
): ComputedRef<string> {
  const target = computed(content);
  if (!schedule && typeof requestAnimationFrame !== "function") return target;
  const scheduleFrame = schedule ?? ((callback: () => void) => requestAnimationFrame(callback));
  const done = computed(complete);
  const state = ref(initialStreamSmoothState);
  let frame: number | undefined;

  const advance = () => {
    frame = undefined;
    state.value = nextStreamSmoothState(state.value, target.value.length, done.value);
    if (state.value.displayed < target.value.length) start();
  };
  const start = () => {
    if (frame === undefined) frame = scheduleFrame(advance);
  };
  const stop = () => {
    if (frame !== undefined) cancel(frame);
    frame = undefined;
  };

  watch([target, done], () => (done.value ? (stop(), advance()) : start()), {
    immediate: true,
    flush: "sync",
  });
  onScopeDispose(stop, true);

  return computed(() => target.value.slice(0, state.value.displayed));
}
