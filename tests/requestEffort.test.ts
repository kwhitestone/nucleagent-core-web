import assert from "node:assert/strict";
import { test } from "node:test";
import { effortExperimentEnabled, withRequestEffort } from "../src/chat-react/requestEffort.ts";

// MUYU-365 D18: TEST-only explicit low-effort experiment entry; never a silent default.
test("experiment control shows only on explicit ?chatEffort=low opt-in (search or shell hash)", () => {
  assert.equal(effortExperimentEnabled("", ""), false);
  assert.equal(effortExperimentEnabled("?chatUi=react", "#/chat"), false);
  assert.equal(effortExperimentEnabled("?chatEffort=medium", ""), false);
  assert.equal(effortExperimentEnabled("?chatEffort=LOW", ""), false);
  assert.equal(effortExperimentEnabled("?chatEffort=low", ""), true);
  assert.equal(effortExperimentEnabled("", "#/chat?chatUi=react&chatEffort=low"), true);
});

test("reasoningEffort is added only when chosen and the backend is codex", () => {
  const base = { mode: "a2a_agent" as const, input: "请描述这张图", model: "m", providerId: 1, executionBackend: "codex" };
  assert.deepEqual(withRequestEffort(base, false), base, "default request is unchanged");
  assert.equal("reasoningEffort" in withRequestEffort(base, false), false);
  assert.deepEqual(withRequestEffort(base, true), { ...base, reasoningEffort: "low" });
  assert.deepEqual(withRequestEffort({ ...base, executionBackend: "hermes" }, true), { ...base, executionBackend: "hermes" });
  assert.deepEqual(withRequestEffort({ ...base, executionBackend: undefined }, true), { ...base, executionBackend: undefined });
});
