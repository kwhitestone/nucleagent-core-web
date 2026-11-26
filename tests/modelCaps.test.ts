import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityOf, imageGate, visionOf } from "../src/chat-react/modelCaps.ts";

// MUYU-418 contract v1 (toolgate f5234a9 docs/muyu418-model-catalog-contract.md §1/§5).
const m = (model: string, over: Record<string, unknown> = {}) => ({ providerId: 1, model, type: "chat", capabilities: [] as string[], ...over });
const seen = m("seen", { available: true, vision_in: "supported", capabilities: ["vision_in"], visionEvidence: { source: "measured", ref: "MUYU-365", testedAt: "2026-11-15T01:46:17Z" } });
const blind = m("blind", { available: true, vision_in: "unsupported", visionEvidence: { source: "measured", ref: "x", testedAt: null } });
const unknown = m("unknown", { available: null, vision_in: "unverified", visionEvidence: null });
const down = m("down", { available: false, unavailableReason: "capacity", vision_in: "supported", capabilities: ["vision_in"] });

test("vision comes only from the catalog field; an old Core falls back to capabilities, never to the model name", () => {
  assert.equal(visionOf(seen), "supported");
  assert.equal(visionOf(blind), "unsupported");
  assert.equal(visionOf(unknown), "unverified");
  assert.equal(visionOf(m("gpt-vision-4o")), "unverified", "name never implies support");
  assert.equal(visionOf(m("old", { capabilities: ["vision_in"] })), "supported", "old Core: capabilities is the same fact (contract §1 compat)");
  assert.equal(visionOf(m("odd", { vision_in: "maybe" })), "unverified", "unknown enum = no evidence");
  assert.equal(visionOf(undefined), "unverified");
});

test("availability: false needs a reason, null is 未探测, an absent field (old Core) is not labelled", () => {
  assert.deepEqual(availabilityOf(down), { state: "unavailable", reason: "capacity" });
  assert.deepEqual(availabilityOf(m("x", { available: false })), { state: "unavailable", reason: "unknown" });
  assert.deepEqual(availabilityOf(m("x", { available: false, unavailableReason: "weird" })), { state: "unavailable", reason: "unknown" });
  assert.deepEqual(availabilityOf(unknown), { state: "unprobed" });
  assert.deepEqual(availabilityOf(seen), { state: "available" });
  assert.deepEqual(availabilityOf(m("legacy")), { state: "available" }, "old Core sends no field: no grey-out, no label");
});

test("image gate: supported sends silently, unsupported blocks with available alternatives, unverified warns deterministically", () => {
  const models = [seen, blind, unknown, down];
  assert.deepEqual(imageGate({ providerId: 1, model: "seen" }, models), { state: "supported", block: false, model: "seen", alternatives: [] });
  assert.deepEqual(imageGate({ providerId: 1, model: "blind" }, models), { state: "unsupported", block: true, model: "blind", alternatives: ["seen"] },
    "unavailable vision models are not offered");
  assert.deepEqual(imageGate({ providerId: 1, model: "unknown" }, models), { state: "unverified", block: false, model: "unknown", alternatives: ["seen"] });
  assert.deepEqual(imageGate(null, models), { state: "unverified", block: false, model: null, alternatives: ["seen"] }, "server default model has no evidence here");
  assert.equal(imageGate({ providerId: 2, model: "seen" }, models).state, "unverified", "provider must match");
});

test("upload hint text is deterministic per field: none for supported, block+switch for unsupported, 未验证 (never 支持) without evidence", async () => {
  const { imageHint } = await import("../src/chat-react/modelCaps.ts");
  const { ZH_STRINGS } = await import("../src/chat-react/islandStringsZh.ts");
  const zh = (key: string) => (ZH_STRINGS as Record<string, string>)[key.replace(/^chatReact\./, "")] ?? key;
  assert.equal(imageHint({ state: "supported", block: false, model: "seen", alternatives: [] }, zh), undefined, "supported: no prompt at all");
  const blocked = imageHint({ state: "unsupported", block: true, model: "blind", alternatives: ["seen", "s2"] }, zh)!;
  assert.match(blocked, /blind 不支持图片输入/);
  assert.match(blocked, /seen、s2/);
  const none = imageHint({ state: "unsupported", block: true, model: "blind", alternatives: [] }, zh)!;
  assert.match(none, /暂无已验证支持图片的可用模型/);
  const unverified = imageHint({ state: "unverified", block: false, model: "unknown", alternatives: ["seen"] }, zh)!;
  assert.match(unverified, /该模型暂未验证识图（unknown）/);
  assert.match(unverified, /seen/);
  for (const text of [blocked, none, unverified]) {
    assert.doesNotMatch(text, /能力未知|视觉延迟|实测通过不等于/, "the old ambiguous prompt is gone");
  }
});
