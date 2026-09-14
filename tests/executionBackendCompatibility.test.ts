import assert from "node:assert/strict";
import test from "node:test";

import { executionBackendCompatibility } from "../src/addons/conversation/composables/executionBackendCompatibility.ts";
import type { Provider } from "../src/contracts/model-catalog.ts";
import type { ExecutionBackendOption } from "../src/addons/conversation/api/types.ts";

const providers: Provider[] = [
  { id: 2, name: "OpenAI compatible", isActive: true, config: { apiFormat: "openai", messagesMode: "translate", models: ["glm-5.2"] } },
  { id: 3, name: "Anthropic", isActive: true, config: { apiFormat: "anthropic", models: ["claude-sonnet"] } },
  { id: 4, name: "Gemini", isActive: true, config: { apiFormat: "gemini", models: ["gemini-2.5-pro"] } },
  { id: 5, name: "Plain OpenAI", isActive: true, config: { apiFormat: "openai", models: ["model-c"] } },
];

function option(overrides: Partial<ExecutionBackendOption>): ExecutionBackendOption {
  return {
    id: "codex",
    type: "codex",
    displayName: "Codex",
    streaming: true,
    default: false,
    requiredApiFormat: "openai",
    requiresExplicitModel: false,
    ...overrides,
  };
}

test("explicit native backends reject the default model", () => {
  const result = executionBackendCompatibility(
    option({ id: "opencode", requiresExplicitModel: true }),
    null,
    providers,
  );
  assert.deepEqual(result, { allowed: false, reason: "model_required" });
});

test("Claude Code accepts native and translated Messages providers", () => {
  const claude = option({ id: "claude-code", requiredApiFormat: "", requiresExplicitModel: false });
  assert.deepEqual(
    executionBackendCompatibility(claude, { providerId: 2, model: "glm-5.2" }, providers),
    { allowed: true, reason: "" },
  );
  assert.deepEqual(
    executionBackendCompatibility(claude, { providerId: 3, model: "claude-sonnet" }, providers),
    { allowed: true, reason: "" },
  );
  assert.deepEqual(
    executionBackendCompatibility(claude, { providerId: 4, model: "gemini-2.5-pro" }, providers),
    { allowed: false, reason: "protocol_incompatible" },
  );
  assert.deepEqual(
    executionBackendCompatibility(claude, { providerId: 5, model: "model-c" }, providers),
    { allowed: false, reason: "protocol_incompatible" },
  );
});

test("Claude Code can use the executor default model", () => {
  assert.deepEqual(
    executionBackendCompatibility(option({ id: "claude-code", requiredApiFormat: "", requiresExplicitModel: false }), null, providers),
    { allowed: true, reason: "" },
  );
});

test("default-capable backends remain available without a provider selection", () => {
  assert.deepEqual(
    executionBackendCompatibility(option({ id: "hermes" }), null, providers),
    { allowed: true, reason: "" },
  );
});

test("ACP backends use their native wire format even without optional descriptor metadata", () => {
  for (const id of ["gemini-cli", "deepseek-harness"] as const) {
    const backend = option({ id, requiredApiFormat: undefined, requiresExplicitModel: undefined });
    assert.deepEqual(executionBackendCompatibility(backend, null, providers), { allowed: false, reason: "model_required" });
    assert.deepEqual(executionBackendCompatibility({ ...backend, requiresExplicitModel: false }, null, providers), { allowed: true, reason: "" });
    for (const selection of [{ providerId: 2, model: "glm-5.2" }, { providerId: 3, model: "claude-sonnet" }, { providerId: 4, model: "gemini-2.5-pro" }]) {
      const allowed = id === "gemini-cli" ? selection.providerId === 4 : selection.providerId === 2;
      assert.deepEqual(executionBackendCompatibility(backend, selection, providers), { allowed, reason: allowed ? "" : "protocol_incompatible" });
    }
  }
});

test("per-model native Gemini capability preserves the provider OpenAI default", () => {
  const mixed = [{ id: 8, name: "Mixed provider", isActive: true, config: { apiFormat: "openai",
    modelApiFormats: { "gemini-3.8-flash": ["gemini"] } } }];
  const gemini = option({ id: "gemini-cli", requiredApiFormat: "gemini" });
  assert.equal(executionBackendCompatibility(gemini, { providerId: 8, model: "gemini-3.8-flash" }, mixed).allowed, true);
  assert.equal(executionBackendCompatibility(gemini, { providerId: 8, model: "gemini-unlisted" }, mixed).allowed, false);
  assert.equal(executionBackendCompatibility(option({ id: "deepseek-harness" }), { providerId: 8, model: "gemini-3.8-flash" }, mixed).allowed, true);
  assert.equal(executionBackendCompatibility(gemini, { providerId: 5, model: "gemini-3.8-flash" }, providers).allowed, false);
});

test("Gemini accepts Chat providers only when Core advertises translation", () => {
  const backend = option({ id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"] });
  for (const [providerId, model, allowed] of [[2, "glm-5.2", true], [4, "gemini-2.5-pro", true], [3, "claude-sonnet", false]] as const) {
    assert.equal(executionBackendCompatibility(backend, { providerId, model }, providers).allowed, allowed);
  }
  const legacy = { ...backend, supportedApiFormats: undefined };
  assert.equal(executionBackendCompatibility(legacy, { providerId: 2, model: "glm-5.2" }, providers).allowed, false);
  assert.equal(executionBackendCompatibility({ ...backend, supportedApiFormats: [] }, { providerId: 2, model: "glm-5.2" }, providers).allowed, false);
});

test("advertised Gemini capabilities match exact per-model native endpoints", () => {
  const backend = option({ id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"] });
  const mixed = [{ id: 9, name: "Mixed", isActive: true, config: { apiFormat: "anthropic", modelApiFormats: {
    "model-a": ["openai"], "model-b": ["gemini"], "model-c": ["anthropic"],
  } } }];
  for (const [model, allowed] of [["model-a", true], ["model-b", true], ["model-c", false], ["model", false]] as const) {
    assert.equal(executionBackendCompatibility(backend, { providerId: 9, model }, mixed).allowed, allowed);
  }
});

test("missing and inactive providers do not become compatible through model-name inference", () => {
  const backend = option({ id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"] });
  assert.equal(executionBackendCompatibility(backend, { providerId: 99, model: "gemini-2.5-pro" }, providers).allowed, false);
  assert.equal(executionBackendCompatibility(backend, { providerId: 4, model: "gemini-2.5-pro" }, providers.map((provider) => ({ ...provider, isActive: false }))).allowed, false);
});

test("Gemini only routes safe native IDs and gates namespace aliases on advertised Chat translation", () => {
  const backend = option({ id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"] });
  const legacy = { ...backend, supportedApiFormats: undefined };
  const native = [{ id: 10, name: "Native", isActive: true, config: { apiFormat: "gemini", models: ["vendor/model:variant"] } }];
  const chat = [{ id: 11, name: "Chat", isActive: true, config: { apiFormat: "openai", models: ["vendor/model:variant"], modelApiFormats: { "vendor/model:variant": ["gemini"] } } }];
  const mixed = [{ id: 12, name: "Mixed", isActive: true, config: { apiFormat: "gemini", models: ["vendor/model:variant"], modelApiFormats: { "vendor/model:variant": ["openai"] } } }];
  assert.equal(executionBackendCompatibility(backend, { providerId: 10, model: "vendor/model:variant" }, native).allowed, false);
  for (const providers of [chat, mixed]) {
    const choice = { providerId: providers[0]!.id, model: "vendor/model:variant" };
    assert.equal(executionBackendCompatibility(backend, choice, providers).allowed, true);
    assert.equal(executionBackendCompatibility(legacy, choice, providers).allowed, false);
  }
  const unsafeNames = ["a".repeat(201), "model:variant", "provider/model", "_model"];
  for (const model of unsafeNames) {
    assert.equal(executionBackendCompatibility(backend, { providerId: 10, model }, [{ ...native[0]!, config: { apiFormat: "gemini", models: [model] } }]).allowed, false);
  }
});

test("Gemini requires the exact listed model while preserving providers without a whitelist", () => {
  const backend = option({ id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"] });
  assert.equal(executionBackendCompatibility(backend, { providerId: 2, model: "GLM-5.2" }, providers).allowed, false);
  assert.equal(executionBackendCompatibility(backend, { providerId: 2, model: "glm-5.2-other" }, providers).allowed, false);
  assert.equal(executionBackendCompatibility(backend, { providerId: 2, model: " glm-5.2 " }, providers).allowed, true);
  assert.equal(executionBackendCompatibility(backend, { providerId: 2, model: "custom-model" }, [{ ...providers[0]!, config: { apiFormat: "openai", models: [] } }]).allowed, true);
});
