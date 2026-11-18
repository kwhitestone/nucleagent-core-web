import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChatStrategy, initialChatModel, measurementHint, loadChatStrategy } from "../src/chat-react/chatStrategy.ts";

const choice = { providerId: 1, model: "candidate" };
const measurement = { ...choice, n: 6, medianMs: 1929.75, maxMs: 3104.5, date: "2026-11-15", versions: "Core v0.1.1 / Executor v1.2.3", quality: "仅短问和固定图片事实", thinking: null, vision: { n: 5, medianMs: 2584.8, source: "catalog snapshot and fixed image review" } };
const config = { scope: "test-react-ordinary", origin: "https://test.example.com", backend: "executor", candidate: choice, measurements: [measurement] };
const policy = () => parseChatStrategy(config, config.origin)!;
const catalog = [{ ...choice, type: "chat", capabilities: [] as string[] }];
const input = () => ({ strategy: policy(), conversationId: undefined as string | undefined, selected: null as typeof choice | null, explicit: false, backend: "executor", models: catalog, allowed: () => true });

test("strategy is opt-in and restricted to its exact TEST origin and schema", () => {
  assert.equal(parseChatStrategy(null, config.origin), null);
  assert.equal(parseChatStrategy(config, "https://prod.example.com"), null);
  assert.equal(parseChatStrategy({ ...config, scope: "all" }, config.origin), null);
  assert.equal(parseChatStrategy({ ...config, measurements: [{ ...measurement, n: -1 }] }, config.origin), null);
  assert.equal(parseChatStrategy({ ...config, measurements: [{ ...measurement, thinking: { supported: true } }] }, config.origin), null);
  assert.equal(parseChatStrategy(config, config.origin)?.candidate.model, "candidate");
});

test("default only selects an available compatible candidate for a fresh ordinary conversation", () => {
  assert.deepEqual(initialChatModel(input()), choice);
  assert.equal(initialChatModel({ ...input(), conversationId: "1243" }), null);
  assert.equal(initialChatModel({ ...input(), backend: "complex-task" }), null);
  assert.equal(initialChatModel({ ...input(), models: [] }), null);
  assert.equal(initialChatModel({ ...input(), allowed: () => false }), null);
  assert.equal(initialChatModel({ ...input(), strategy: null }), null);
});

test("explicit model and explicit server-default choices survive strategy loading", () => {
  const selected = { providerId: 2, model: "slow-choice" };
  assert.deepEqual(initialChatModel({ ...input(), selected }), selected);
  assert.equal(initialChatModel({ ...input(), explicit: true }), null);
});

test("small samples and slower p50 cannot qualify; thinking never inferred from latency", () => {
  for (const change of [{ n: 1 }, { medianMs: 2400 }]) {
    const strategy = parseChatStrategy({ ...config, measurements: [{ ...measurement, ...change }] }, config.origin)!;
    assert.equal(initialChatModel({ ...input(), strategy }), null);
    assert.doesNotMatch(measurementHint(strategy, choice), /文字p50≤2秒/);
  }
  const hint = measurementHint(policy(), choice);
  assert.match(hint, /n=6/);
  assert.match(hint, /2026-11-15/);
  assert.match(hint, /Core v0.1.1/);
  assert.match(hint, /思考能力未知/);
  assert.match(hint, /并非每次/);
  assert.match(measurementHint(policy(), { providerId: 2, model: "other" }), /n=0.*未知/);
});

test("missing, malformed and failed optional config safely retain existing defaults", async () => {
  for (const fetcher of [async () => new Response("", { status: 404 }), async () => new Response("bad json"), async () => { throw new Error("offline"); }]) {
    assert.equal(await loadChatStrategy(config.origin, fetcher), null);
  }
  assert.deepEqual(await loadChatStrategy(config.origin, async (url, options) => {
    assert.equal(String(url), `${config.origin}/chat-strategy.json`);
    assert.equal(options?.credentials, "omit");
    return Response.json(config);
  }), policy());
});

test("effort evidence is optional per measurement, validated, and only returned for that exact model", async () => {
  const { effortEvidence } = await import("../src/chat-react/chatStrategy.ts");
  assert.equal(effortEvidence(policy(), choice, config.backend), undefined, "no evidence = unverified");
  const effort = { levels: ["low", "medium"], effective: false, source: "TEST 2026-11-16 n=5" };
  const strategy = parseChatStrategy({ ...config, measurements: [{ ...measurement, effort }] }, config.origin)!;
  assert.deepEqual(effortEvidence(strategy, choice, config.backend), effort);
  assert.equal(effortEvidence(strategy, { providerId: 1, model: "other" }, config.backend), undefined);
  assert.equal(effortEvidence(strategy, { providerId: 2, model: choice.model }, config.backend), undefined);
  assert.equal(effortEvidence(strategy, choice, "codex"), undefined, "evidence from a different executor is not transferable");
  assert.equal(effortEvidence(strategy, choice, null), undefined);
  assert.equal(parseChatStrategy({ ...config, measurements: [{ ...measurement, effort: { ...effort, levels: ["minimal"] } }] }, config.origin), null);
});

test("explicit unsupported effort preserves the rest of the strategy instead of invalidating it", () => {
  const effort = { levels: [], effective: false, source: "catalog:unsupported" };
  const parsed = parseChatStrategy({ ...config, measurements: [{ ...measurement, effort }] }, config.origin);
  assert.ok(parsed);
  assert.deepEqual(parsed.measurements[0]?.effort, effort);
  assert.deepEqual(parsed.candidate, choice);
});

test("MUYU-418: the strategy default never lands on a model the catalog marks unavailable", async () => {
  const { availabilityOf } = await import("../src/chat-react/modelCaps.ts");
  const models = [{ ...catalog[0]!, available: false, unavailableReason: "capacity" }];
  assert.equal(initialChatModel({ ...input(), models: models.filter((m) => availabilityOf(m).state !== "unavailable") }), null);
});
