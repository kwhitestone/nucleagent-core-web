import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

let vite: ViteDevServer;
let currentToken = "";
let runtime: any;
let http: any;
let unregister: () => void;
before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => currentToken, setItem: () => undefined, removeItem: () => undefined,
  } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ platformRuntime: runtime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts"));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime(runtime);
  http = runtime.http;
});
after(async () => { unregister(); await vite.close(); Reflect.deleteProperty(globalThis, "localStorage"); });

test("business setup is not executed before auth and becomes available after auth", async () => {
  let setups = 0;
  const view = defineComponent({ setup() { setups++; return () => h("span", "authenticated-business"); } });
  const render = async () => {
    const app = createSSRApp(runtime.authenticatedView(view));
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: { common: { signInRequired: "Please sign in" } } } }));
    return renderToString(app);
  };
  currentToken = "";
  assert.match(await render(), /Please sign in/);
  assert.equal(setups, 0);
  currentToken = "fixture-session";
  assert.match(await render(), /authenticated-business/);
  assert.equal(setups, 1);
});

test("a completed request from before session reset cannot repopulate conversation history", async () => {
  setActivePinia(createPinia());
  currentToken = "old-session";
  const { useConversationStore } = await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts");
  const store = useConversationStore();
  let finish: (value: unknown) => void;
  let started: () => void;
  const requested = new Promise<void>(resolve => { started = resolve; });
  http.defaults.adapter = async (config: unknown) => {
    started();
    return new Promise(resolve => { finish = () => resolve({ config, data: { code: 0, data: [{ id: 7, title: "old-account-history" }], hasMore: false }, headers: {}, status: 200, statusText: "OK" }); });
  };
  const pending = store.load();
  await requested;
  store.reset();
  currentToken = "new-session";
  finish!(undefined);
  await pending;
  assert.deepEqual(store.conversations, []);
  assert.equal(store.loaded, false);
  assert.equal(store.loading, false);
});

test("a failed history request from a retired session is settled without leaking an error", async () => {
  setActivePinia(createPinia());
  currentToken = "retired-session";
  const { useConversationStore } = await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts");
  const store = useConversationStore();
  let reject!: (error: Error) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  http.defaults.adapter = () => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; started(); });
  const pending = store.load();
  await ready;
  store.reset();
  currentToken = "replacement-session";
  reject(new Error("retired request"));
  await assert.doesNotReject(pending);
  assert.deepEqual(store.conversations, []);
  assert.equal(store.loading, false);
  http.defaults.adapter = async () => { throw new Error("current request failed"); };
  await assert.rejects(store.load(), /current request failed/);
});
