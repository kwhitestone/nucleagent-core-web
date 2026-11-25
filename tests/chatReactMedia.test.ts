import assert from "node:assert/strict";
import { test } from "node:test";
import { guardMediaSend, mediaTaskView } from "../src/chat-react/mediaPolicy.ts";
import { modelGroups } from "../src/chat-react/modelGroups.ts";

test("media selection rejects before any new or existing chat write; chat still sends", async () => {
  let calls = 0;
  const send = async () => { calls++; };
  for (const kind of ["image", "video"] as const) {
    await assert.rejects(guardMediaSend({ kind }, send, "尚未接通")(), /尚未接通/);
  }
  assert.equal(calls, 0);
  await guardMediaSend(null, send, "尚未接通")();
  assert.equal(calls, 1);
});

test("history states never turn unknown, cancelled, failed or missing signed output into success", () => {
  for (const status of ["queued", "submitting", "running", "ingesting"]) {
    assert.equal(mediaTaskView({ status }).pending, true);
    assert.equal(mediaTaskView({ status }).url, undefined);
  }
  for (const status of ["unknown", "cancelled", "failed", "unexpected", "succeeded"]) {
    assert.equal(mediaTaskView({ status }).pending, false);
    assert.equal(mediaTaskView({ status }).url, undefined);
  }
  assert.equal(mediaTaskView({ status: "succeeded", downloadUrl: "https://cdn.example/file?token=ephemeral" }).url, "https://cdn.example/file?token=ephemeral");
  assert.throws(() => mediaTaskView({ status: "succeeded", downloadUrl: "javascript:alert(1)" }));
  assert.equal(mediaTaskView({ status: "failed", downloadUrl: "https://cdn.example/file" }).url, undefined);
});

test("missing catalog types never infer chat/image/video from provider config or model names", () => {
  const providers = [{ id: 1, name: "P", isActive: true, config: { models: ["image-looking-name"] } }];
  assert.deepEqual(modelGroups(providers as never, null, []), []);
  const typed = { image: [{ providerId: 1, model: "ordinary-name", type: "image", capabilities: ["t2i"] }], chat: [], video: [] };
  assert.deepEqual(modelGroups(providers as never, typed, []).map((group) => group.kind), ["image"]);
});
