import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRenderer, h, nextTick, reactive, ref, ssrContextKey, type Component } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import type { ModelChoice } from "../src/addons/conversation/api/types.ts";

let vite: ViteDevServer;
let picker: Component;
let unregisterPlatform: () => void;
let unregisterCatalog: () => void;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  unregisterPlatform = registerPlatformRuntime(platformRuntime);
  unregisterCatalog = registerModelCatalog({ async listProviders() { return []; }, async fetchVisibleModels() { return []; } });
  http.defaults.adapter = async (config: unknown) => ({ config, data: { code: 0, data: [
    { id: "codex", displayName: "Codex", default: true, requiresExplicitModel: false },
  ] }, headers: {}, status: 200, statusText: "OK" });
  const { default: loaded } = await vite.ssrLoadModule("/src/addons/conversation/components/ExecutionBackendPicker.vue");
  // Run the actual component setup, mounted hooks, computed values and watchers.
  // Only rendering is replaced, so the fixture needs no browser or DOM package.
  picker = { ...loaded, render: () => null };
  const fixtureWindow = new EventTarget();
  Object.defineProperty(fixtureWindow, "parent", { value: fixtureWindow });
  Object.defineProperty(globalThis, "window", { configurable: true, value: fixtureWindow });
});

after(async () => {
  unregisterCatalog();
  unregisterPlatform();
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "window");
});

const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  parentNode: () => null, nextSibling: () => null,
});

test("restoring the same default backend revalidates the new conversation", async () => {
  const props = reactive({ modelValue: "codex" as string | null, modelChoice: null as ModelChoice | null });
  const allowed = ref(false);
  const validations: boolean[] = [];
  const app = renderer.createApp({ render: () => h(picker, { ...props, autoSelect: false,
    "onValidation-change": (value: { allowed: boolean }) => { allowed.value = value.allowed; validations.push(value.allowed); },
  }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
  app.provide(ssrContextKey, {});
  app.mount({});
  try {
    for (let attempt = 0; attempt < 20 && !allowed.value; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(allowed.value, true, "backend catalogue must finish loading");
    const initialValidations = validations.length;

    // Conversation.vue clears these on every route change. The displayed
    // backend remains Codex because it is also the fallback option.
    allowed.value = false;
    props.modelValue = null;
    await nextTick();
    assert.ok(validations.length > initialValidations, "reset selection must notify the new parent state");
    assert.equal(allowed.value, true);

    allowed.value = false;
    props.modelValue = "codex";
    await nextTick();
    assert.equal(allowed.value, true, "restored identical selection must re-enable sending");

    props.modelChoice = { providerId: 1, model: "claude-sonnet" };
    await nextTick();
    assert.equal(allowed.value, false, "revalidation must preserve protocol rejection");
    props.modelChoice = null;
    await nextTick();
    assert.equal(allowed.value, true);
  } finally { app.unmount(); }
});
