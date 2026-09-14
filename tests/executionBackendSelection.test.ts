import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";

import { createServer, type ViteDevServer } from "vite";
import { conversationExecutionBackend } from "../src/addons/conversation/composables/conversationBackendRestore.ts";
import { buildProviderConfig, providerConfigToForm } from "../src/addons/administration/provider/providerConfig.ts";

let vite: ViteDevServer;
let http: any;
let api: any;
let unregisterPlatform: () => void;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregisterPlatform = registerPlatformRuntime(platformRuntime);
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
});

after(async () => {
  unregisterPlatform();
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("backend API uses the executionBackend contract", async () => {
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.method, "patch");
    assert.equal(config.url, "/api/v1/addons/conversation/42");
    assert.deepEqual(JSON.parse(config.data), { executionBackend: "claude-code" });
    return { config, data: { code: 0, data: { id: 42, executionBackend: "claude-code" } }, headers: {}, status: 200, statusText: "OK" };
  };
  const conversation = await api.updateConversationBackend(42, "claude-code");
  assert.equal(conversation.executionBackend, "claude-code");
});

test("execution backend metadata preserves Gemini native wire and supported upstream formats", async () => {
  const backend = { id: "gemini-cli", requiredApiFormat: "gemini", supportedApiFormats: ["gemini", "openai"], requiresExplicitModel: true };
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.url, "/api/v1/addons/conversation/execution-backends");
    return { config, data: { code: 0, data: [backend] }, headers: {}, status: 200, statusText: "OK" };
  };
  assert.deepEqual(await api.listExecutionBackends(), [backend]);
});

test("provider updates send exact model budgets while preserving existing capabilities", async () => {
  const existing = { baseUrl: "https://provider.example/v1", apiFormat: "openai", models: ["model-a"],
    modelApiFormats: { "model-a": ["gemini"] }, vendorOption: { enabled: true } };
  const form = providerConfigToForm(existing);
  form.modelLimits = { "model-a": { contextWindow: "65536", maxOutputTokens: "8192" } };
  http.defaults.adapter = async (request: any) => {
    assert.equal(request.method, "patch");
    assert.equal(request.url, "/api/v1/addons/provider/9");
    const body = JSON.parse(request.data);
    assert.deepEqual(body.config.modelLimits, { "model-a": { contextWindow: 65536, maxOutputTokens: 8192 } });
    assert.deepEqual(body.config.modelApiFormats, existing.modelApiFormats);
    assert.deepEqual(body.config.vendorOption, existing.vendorOption);
    assert.equal(body.apiKey, undefined);
    return { config: request, data: { code: 0, data: { id: 9, config: body.config } }, headers: {}, status: 200, statusText: "OK" };
  };
  const { updateProvider } = await vite.ssrLoadModule("/src/addons/administration/api/provider.ts");
  const updated = await updateProvider(9, { config: buildProviderConfig(form, existing) });
  assert.deepEqual(updated.config.modelLimits, { "model-a": { contextWindow: 65536, maxOutputTokens: 8192 } });
});

test("cross-protocol settings are submitted atomically", async () => {
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.method, "patch");
    assert.equal(config.url, "/api/v1/addons/conversation/42");
    assert.deepEqual(JSON.parse(config.data), {
      providerId: 7,
      model: "claude-model",
      executionBackend: "claude-code",
    });
    return { config, data: { code: 0, data: { id: 42, providerId: 7, model: "claude-model", executionBackend: "claude-code" } }, headers: {}, status: 200, statusText: "OK" };
  };
  const conversation = await api.updateConversationSettings(42, { providerId: 7, model: "claude-model" }, "claude-code");
  assert.equal(conversation.executionBackend, "claude-code");
  assert.equal(conversation.providerId, 7);
});

test("selecting Default model explicitly clears a persisted model", async () => {
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.method, "patch");
    assert.equal(config.url, "/api/v1/addons/conversation/42");
    assert.deepEqual(JSON.parse(config.data), { executionBackend: "hermes", clearModel: true });
    return { config, data: { code: 0, data: { id: 42, providerId: null, model: "", executionBackend: "hermes" } }, headers: {}, status: 200, statusText: "OK" };
  };
  const conversation = await api.updateConversationSettings(42, null, "hermes");
  assert.equal(conversation.executionBackend, "hermes");
  assert.equal(conversation.providerId, null);
  assert.equal(conversation.model, "");
});

test("persisted backend is restored without guessing a different backend", () => {
  assert.equal(conversationExecutionBackend({ executionBackend: " opencode " }), "opencode");
  assert.equal(conversationExecutionBackend({ executionBackend: "" }), null);
});

test("create views and conversation toolbar wire the backend picker", () => {
  for (const file of ["Home.vue", "TaskSetup.vue"]) {
    const source = readFileSync(new URL(`../src/addons/conversation/views/${file}`, import.meta.url), "utf8");
    assert.match(source, /ExecutionBackendPicker/);
    assert.match(source, /executionBackend:/);
  }
  const conversation = readFileSync(new URL("../src/addons/conversation/views/Conversation.vue", import.meta.url), "utf8");
  assert.match(conversation, /ExecutionBackendPicker/);
  assert.match(conversation, /status === 'running'/);
  assert.match(conversation, /updateConversationSettings/);
  assert.match(conversation, /settingsDirty/);
  assert.match(conversation, /:allow-default="true"/);
  assert.doesNotMatch(conversation, /!modelChoice\s*\|\|\s*!executionBackend/);
});

test("model and backend pickers clear authenticated data on logout", () => {
  for (const file of ["ModelPicker.vue", "ExecutionBackendPicker.vue"]) {
    const source = readFileSync(new URL(`../src/addons/conversation/components/${file}`, import.meta.url), "utf8");
    assert.match(source, /if \(!authenticated\)/);
  }
});

test("provider catalog and edits preserve exact-model native capabilities", async () => {
  const config = { baseUrl: "https://provider.example/v1", apiFormat: "openai", models: ["gemini-3.8-flash", "other-model"],
    geminiBaseUrl: "https://provider.example", modelApiFormats: { "gemini-3.8-flash": ["gemini"] } };
  http.defaults.adapter = async (request: any) => {
    assert.equal(request.url, "/api/v1/addons/provider");
    return { config: request, data: { code: 0, data: [{ id: 9, isActive: true, config }] }, headers: {}, status: 200, statusText: "OK" };
  };
  const { modelCatalog } = await vite.ssrLoadModule("/src/addons/model-catalog/api/catalog.ts");
  const [provider] = await modelCatalog.listProviders();
  assert.deepEqual(provider.config, config);
  const saved = buildProviderConfig(providerConfigToForm(provider.config), provider.config);
  assert.equal(saved.apiFormat, "openai");
  assert.equal(saved.geminiBaseUrl, config.geminiBaseUrl);
  assert.deepEqual(saved.modelApiFormats, config.modelApiFormats);
  assert.deepEqual(saved.models, config.models);
});
