import assert from "node:assert/strict";
import { test } from "node:test";
import { createSingleSlot, failureOf } from "../src/chat-react/singleSlotQueue.ts";

// MUYU-365 / 325 §B.6: one replaceable pending message while a run is active.
const msg = (text: string) => ({ role: "user", content: [{ type: "text", text }] }) as never;
const conflict = () => Object.assign(new Error("busy"), { status: 409 });

function harness(fail?: () => unknown) {
  const sent: string[] = [];
  const h = { running: true, sent, changes: 0 };
  const slot = createSingleSlot(async (m) => {
    const text = (m as { content: { text: string }[] }).content[0]!.text;
    const error = fail?.();
    if (error) throw error;
    sent.push(text);
  }, () => h.running, () => { h.changes += 1; });
  const prompt = () => slot.adapter.items.map((i) => i.prompt);
  return { h, slot, prompt };
}

test("queue: enqueue and steer replace the one slot (same id), never send while running", async () => {
  const { h, slot, prompt } = harness();
  slot.adapter.enqueue(msg("a"));
  const id = slot.adapter.items[0]!.id;
  slot.adapter.steer(msg("b"));
  slot.adapter.enqueue(msg("c"));
  assert.deepEqual(prompt(), ["c"]);
  assert.equal(slot.adapter.items[0]!.id, id);
  assert.deepEqual(slot.adapter.steerItems, []);
  assert.equal(slot.adapter.items, slot.adapter.items, "stable snapshot reference");
  await slot.flush();
  assert.deepEqual(h.sent, []);
});

test("queue: remove clears the slot; run end then sends nothing", async () => {
  const { h, slot } = harness();
  slot.adapter.enqueue(msg("a"));
  slot.adapter.remove(slot.adapter.items[0]!.id);
  assert.equal(slot.size, 0);
  h.running = false;
  await slot.flush();
  assert.deepEqual(h.sent, []);
});

test("queue: run end flushes exactly once", async () => {
  const { h, slot } = harness();
  slot.adapter.enqueue(msg("a"));
  h.running = false;
  await Promise.all([slot.flush(), slot.flush()]);
  await slot.flush();
  assert.deepEqual(h.sent, ["a"]);
  assert.equal(slot.size, 0);
});

test("queue: cancel keeps the slot and does not auto-send; a new send re-arms", async () => {
  const { h, slot, prompt } = harness();
  slot.adapter.enqueue(msg("a"));
  slot.adapter.__internal_notifyCancelled!();
  h.running = false;
  await slot.flush();
  assert.deepEqual(h.sent, []);
  assert.deepEqual(prompt(), ["a"]);
  slot.adapter.enqueue(msg("b")); // idle send replaces and goes out
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(h.sent, ["b"]);
});

test("queue: 409 on flush puts the message back for the next run end", async () => {
  let fail = true;
  const { h, slot, prompt } = harness(() => (fail ? conflict() : undefined));
  slot.adapter.enqueue(msg("a"));
  h.running = false;
  await slot.flush();
  assert.deepEqual(prompt(), ["a"]);
  fail = false;
  await slot.flush();
  assert.deepEqual(h.sent, ["a"]);
});

// MUYU-365 fix-video-swallow: a refused send is never parked silently.
const refused = (status: number, code = "", message = code) => Object.assign(new Error(message), { status, code });

function failing(errors: unknown[]) {
  const shown: unknown[] = [];
  const timers: { ms: number; run: () => void }[] = [];
  const sent: string[] = [];
  const h = { running: false };
  const slot = createSingleSlot(async (m) => {
    const error = errors.shift();
    if (error) throw error;
    sent.push((m as { content: { text: string }[] }).content[0]!.text);
  }, () => h.running, () => {}, {
    onFailure: (failure) => shown.push(failure),
    retryMs: 10_000, maxRetries: 3,
    setTimer: (run, ms) => { timers.push({ ms, run }); return timers.length; }, clearTimer: () => {},
  });
  return { h, slot, shown, timers, sent };
}

test("queue: 429 media_busy keeps the message with its reason, reports it, and retries every 10 s up to N times", async () => {
  const { slot, shown, timers, sent } = failing([refused(429, "media_busy"), refused(429, "media_busy")]);
  slot.adapter.enqueue(msg("一只猫"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slot.size, 1);
  assert.equal(slot.failure?.status, 429);
  assert.equal(slot.failure?.code, "media_busy");
  assert.equal(slot.failure?.retry, "auto");
  assert.equal(shown.length, 1, "the refusal is reported once, never swallowed");
  assert.equal(timers.at(-1)?.ms, 10_000);
  timers.at(-1)!.run();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(slot.failure?.attempt, 2);
  timers.at(-1)!.run();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, ["一只猫"]);
  assert.equal(slot.size, 0);
  assert.equal(slot.failure, null);
});

test("queue: auto retry stops after maxRetries and waits for the user (reason kept)", async () => {
  const busy = () => refused(429, "media_busy");
  const { slot, timers } = failing([busy(), busy(), busy(), busy(), busy()]);
  slot.adapter.enqueue(msg("a"));
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); timers.at(-1)?.run(); }
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(timers.length, 3, "no 4th timer");
  assert.equal(slot.size, 1);
  assert.equal(slot.failure?.retry, "manual");
});

test("queue: retryNow sends at once; remove (×) drops the message and its reason", async () => {
  const { slot, timers, sent } = failing([refused(429, "media_busy")]);
  slot.adapter.enqueue(msg("a"));
  await new Promise((r) => setTimeout(r, 0));
  await slot.retryNow();
  assert.deepEqual(sent, ["a"]);
  const again = failing([refused(429, "media_busy")]);
  again.slot.adapter.enqueue(msg("b"));
  await new Promise((r) => setTimeout(r, 0));
  again.slot.adapter.remove(again.slot.adapter.items[0]!.id);
  assert.equal(again.slot.size, 0);
  assert.equal(again.slot.failure, null);
  again.timers.at(-1)!.run();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(again.sent, [], "a cancelled message is never sent by a stale timer");
  void timers;
});

test("queue: 400/403/422 are permanent — reported and dropped, no retry", async () => {
  for (const status of [400, 403, 422]) {
    const { slot, shown, timers } = failing([refused(status, "invalid_params", "bad")]);
    slot.adapter.enqueue(msg("a"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(slot.size, 0, `${status} drops`);
    assert.equal((shown[0] as { status: number }).status, status);
    assert.equal(timers.length, 0);
  }
});

test("queue: 409 conversation_busy keeps it for the run end with a reason; a network error keeps it for the user", async () => {
  const c = failing([refused(409, "conversation_busy")]);
  c.slot.adapter.enqueue(msg("a"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.slot.size, 1);
  assert.equal(c.slot.failure?.code, "conversation_busy");
  assert.equal(c.slot.failure?.retry, "auto");
  assert.equal(c.shown.length, 1);
  const n = failing([refused(0, "NETWORK_ERROR", "Network Error")]);
  n.slot.adapter.enqueue(msg("a"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(n.slot.size, 1);
  assert.equal(n.slot.failure?.retry, "manual", "an unconfirmed (possibly paid) send is never replayed by itself");
  assert.equal(n.timers.length, 0);
  assert.equal(n.shown.length, 1);
});

test("queue: a paused slot (stopped run) always carries a reason", async () => {
  const { slot, h } = failing([]);
  h.running = true;
  slot.adapter.enqueue(msg("a"));
  slot.adapter.__internal_notifyCancelled!();
  assert.equal(slot.failure?.code, "paused");
  assert.equal(slot.failure?.retry, "manual");
});

test("failureOf keeps status, code and Retry-After from an ApiError-like error", () => {
  const f = failureOf(Object.assign(new Error("too many"), { status: 429, code: "media_busy", problem: { retryAfter: 7 } }));
  assert.deepEqual({ status: f.status, code: f.code, message: f.message, retryAfterMs: f.retryAfterMs }, { status: 429, code: "media_busy", message: "too many", retryAfterMs: 7000 });
  assert.equal(failureOf(new Error("x")).status, 0);
});
