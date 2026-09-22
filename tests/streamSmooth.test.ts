import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import {
  initialStreamSmoothState,
  nextStreamSmoothState,
  useStreamSmooth,
} from "../src/addons/conversation/composables/useStreamSmooth.ts";

/** Run `frames` catch-up frames against a fixed target. */
const settle = (targetLen: number, frames: number, complete = false) => {
  let state = initialStreamSmoothState;
  for (let i = 0; i < frames; i += 1) state = nextStreamSmoothState(state, targetLen, complete);
  return state;
};

test("the reveal chases the content instead of jumping a whole chunk", () => {
  // A single 50-char chunk is revealed over several frames, not all at once.
  const first = nextStreamSmoothState(initialStreamSmoothState, 50, false);
  assert.ok(first.displayed > 0 && first.displayed < 50, `got ${first.displayed}`);
  // The rate estimate rises with sustained arrivals, so a fast stream reveals faster.
  let fast = initialStreamSmoothState;
  for (let i = 1; i <= 10; i += 1) fast = nextStreamSmoothState(fast, i * 40, false);
  let slow = initialStreamSmoothState;
  for (let i = 1; i <= 10; i += 1) slow = nextStreamSmoothState(slow, i * 2, false);
  assert.ok(fast.rate > slow.rate);
  // It always converges on a static target and never overshoots it.
  assert.equal(settle(50, 200).displayed, 50);
  assert.equal(settle(0, 5).displayed, 0);
});

test("a stalled reveal never trails the live content by more than the lag cap", () => {
  // 5000 chars arrive at once: the next frame dumps everything beyond the cap.
  const jump = nextStreamSmoothState(initialStreamSmoothState, 5000, false);
  assert.equal(jump.displayed, 5000 - 240);
});

test("complete jumps straight to the full content", () => {
  assert.equal(nextStreamSmoothState(initialStreamSmoothState, 4000, true).displayed, 4000);
  const midway = nextStreamSmoothState(initialStreamSmoothState, 100, false);
  assert.equal(nextStreamSmoothState(midway, 100, true).displayed, 100);
});

test("truncated or rewritten content cannot slice past the end", () => {
  const ahead = settle(500, 200);
  assert.equal(ahead.displayed, 500);
  // Content shrinks (stream rewrite): displayed clamps to the new length.
  assert.equal(nextStreamSmoothState(ahead, 12, false).displayed, 12);
  assert.equal(nextStreamSmoothState(ahead, 0, false).displayed, 0);
  assert.equal(nextStreamSmoothState(ahead, -5, false).displayed, 0);
  // Growing again after a rewrite resumes from the shorter length, not the stale one.
  const shrunk = nextStreamSmoothState(ahead, 12, false);
  assert.ok(nextStreamSmoothState(shrunk, 40, false).displayed <= 40);
});

test("the composable drives the slice off animation frames and stops when settled", () => {
  const frames: Array<() => void> = [];
  const cancelled: number[] = [];
  const content = ref("");
  const complete = ref(false);
  const scope = effectScope();
  const text = scope.run(() =>
    useStreamSmooth(
      () => content.value,
      () => complete.value,
      (callback) => frames.push(callback),
      (handle) => cancelled.push(handle),
    ),
  )!;

  assert.equal(text.value, "");
  content.value = "hello world, this is a streamed sentence";
  assert.equal(text.value, "", "no reveal before a frame runs");
  frames.shift()!();
  assert.ok(text.value.length > 0 && text.value.length < content.value.length);
  assert.ok(content.value.startsWith(text.value));
  while (frames.length) frames.shift()!();
  assert.equal(text.value, content.value, "settles on the full content");
  assert.equal(frames.length, 0, "no frame is scheduled once settled");

  // Completing mid-animation reveals everything immediately, without a frame.
  content.value = `${content.value} plus a long tail `.repeat(30);
  frames.length = 0;
  complete.value = true;
  assert.equal(text.value, content.value);

  // A pending frame is cancelled when the owning scope is disposed.
  complete.value = false;
  content.value = `${content.value} and more`;
  assert.equal(frames.length, 1);
  const cancelledBefore = cancelled.length;
  scope.stop();
  assert.equal(cancelled.length, cancelledBefore + 1);
});

test("the default scheduler is the browser animation frame, and SSR passes content through", () => {
  const pending: Array<() => void> = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const install = (value: unknown) =>
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value });
  const restore = () =>
    previous
      ? Object.defineProperty(globalThis, "requestAnimationFrame", previous)
      : Reflect.deleteProperty(globalThis, "requestAnimationFrame");

  try {
    install((callback: () => void) => pending.push(callback));
    const content = ref("streamed by rAF");
    const scope = effectScope();
    const text = scope.run(() => useStreamSmooth(() => content.value, () => false))!;
    assert.equal(pending.length, 1, "the default scheduler queued a frame");
    assert.equal(text.value, "");
    while (pending.length) pending.shift()!();
    assert.equal(text.value, content.value);
    scope.stop();

    // No animation frames at all (server render): content is returned verbatim.
    install(undefined);
    const ssr = effectScope();
    const plain = ssr.run(() => useStreamSmooth(() => "rendered on the server", () => false))!;
    assert.equal(plain.value, "rendered on the server");
    ssr.stop();
  } finally {
    restore();
  }
});
