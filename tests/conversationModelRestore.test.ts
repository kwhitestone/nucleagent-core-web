import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";

import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h, type Component } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import {
  conversationModelChoice,
  createLatestConversationModelLoader,
} from "../src/addons/conversation/composables/conversationModelRestore.ts";

type ConversationAPI = {
  getConversation: (id: number | string) => Promise<Record<string, unknown>>;
};

let vite: ViteDevServer;
let http: any;
let api: ConversationAPI;
let ModelPicker: Component;
let unregisterPlatform: () => void;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  ({ default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregisterPlatform = registerPlatformRuntime(platformRuntime);
  api = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts") as ConversationAPI;
  ({ default: ModelPicker } = await vite.ssrLoadModule(
    "/src/addons/conversation/components/ModelPicker.vue",
  ));
});

after(async () => {
  unregisterPlatform();
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("getConversation unwraps the persisted provider and model", async () => {
  http.defaults.adapter = async (config: any) => {
    assert.equal(config.method, "get");
    assert.equal(config.url, "/api/v1/addons/conversation/360");
    return {
      config,
      data: {
        code: 0,
        data: { id: 360, providerId: 4, model: "kimi-k2.6" },
      },
      headers: {},
      status: 200,
      statusText: "OK",
    };
  };

  const conversation = await api.getConversation(360);
  assert.equal(conversation.providerId, 4);
  assert.equal(conversation.model, "kimi-k2.6");
});

test("conversation model choice requires a complete persisted selection", () => {
  assert.deepEqual(
    conversationModelChoice({ providerId: 4, model: " kimi-k2.6 " }),
    { providerId: 4, model: "kimi-k2.6" },
  );
  assert.equal(conversationModelChoice({ providerId: 4 }), null);
  assert.equal(conversationModelChoice({ model: "kimi-k2.6" }), null);
  assert.equal(conversationModelChoice({ providerId: 0, model: "kimi-k2.6" }), null);
});

test("late detail responses cannot overwrite the newly selected conversation", async () => {
  const releases = new Map<string, (value: Record<string, unknown>) => void>();
  const loader = createLatestConversationModelLoader(
    (id) => new Promise((resolve) => releases.set(id, resolve)),
  );

  const oldLoad = loader.load("360");
  const currentLoad = loader.load("361");
  releases.get("361")?.({ providerId: 2, model: "glm-5.2" });
  assert.deepEqual(await currentLoad, { providerId: 2, model: "glm-5.2" });
  releases.get("360")?.({ providerId: 4, model: "kimi-k2.6" });
  assert.equal(await oldLoad, undefined);
});

test("an A-B-A route race keeps only the final A detail response", async () => {
  const releases: Array<(value: Record<string, unknown>) => void> = [];
  const loader = createLatestConversationModelLoader(
    () => new Promise((resolve) => releases.push(resolve)),
  );

  const firstA = loader.load("360");
  const middleB = loader.load("361");
  const finalA = loader.load("360");
  releases[0]?.({ providerId: 4, model: "old-a" });
  releases[1]?.({ providerId: 2, model: "middle-b" });
  releases[2]?.({ providerId: 4, model: "kimi-k2.6" });

  assert.equal(await firstA, undefined);
  assert.equal(await middleB, undefined);
  assert.deepEqual(await finalA, { providerId: 4, model: "kimi-k2.6" });
});

test("invalidating a pending detail request suppresses its value and error", async () => {
  let resolveValue!: (value: Record<string, unknown>) => void;
  const valueLoader = createLatestConversationModelLoader(
    () => new Promise((resolve) => { resolveValue = resolve; }),
  );
  const pendingValue = valueLoader.load("360");
  valueLoader.invalidate();
  resolveValue({ providerId: 4, model: "kimi-k2.6" });
  assert.equal(await pendingValue, undefined);

  let rejectError!: (error: Error) => void;
  const errorLoader = createLatestConversationModelLoader(
    () => new Promise((_resolve, reject) => { rejectError = reject; }),
  );
  const pendingError = errorLoader.load("360");
  errorLoader.invalidate();
  rejectError(new Error("stale"));
  assert.equal(await pendingError, undefined);
});

test("conversation view binds loading and atomic settings saves to current lifecycles", () => {
  const source = readFileSync(
    new URL("../src/addons/conversation/views/Conversation.vue", import.meta.url),
    "utf8",
  );
  assert.match(source, /async \(conversationId, _previousId, onCleanup\)/);
  assert.match(source, /onCleanup\(\(\) => \{ active = false; \}\)/);
  assert.match(source, /if \(active\) \{[\s\S]*modelLoading\.value = false;[\s\S]*backendLoading\.value = false;/);
  assert.match(source, /updateConversationSettings\(conversationId, nextModel, nextBackend\)/);
  assert.match(source, /settingsSaving\.value = true/);
  assert.match(source, /:disabled="modelLoading \|\| settingsSaving \|\| status === 'running'"/);
  assert.match(source, /send: !modelLoading && !backendLoading && !settingsSaving && !settingsDirty/);
});

test("an unavailable persisted model remains visible as the current selection", async () => {
  const app = createSSRApp({
    render: () => h(ModelPicker, {
      modelValue: { providerId: 4, model: "kimi-k2.6" },
      compact: true,
    }),
  });
  app.use(createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      "zh-CN": {
        common: {
          model: "模型",
          modelDefault: "默认模型",
          modelCurrentUnavailable: "{model}（当前）",
        },
      },
    },
  }));

  const html = await renderToString(app);
  assert.match(html, /value="4:kimi-k2\.6"[^>]*selected/);
  assert.match(html, /kimi-k2\.6（当前）/);
  assert.doesNotMatch(html, /value=""[^>]*selected/);
});
