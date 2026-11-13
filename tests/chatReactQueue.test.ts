import assert from "node:assert/strict";
import { test } from "node:test";
import { createSingleSlot } from "../src/chat-react/singleSlotQueue.ts";

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
