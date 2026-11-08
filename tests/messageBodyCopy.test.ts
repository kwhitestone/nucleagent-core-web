import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp, defineComponent, h, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { hostNode, renderer } from "./vueComponentHarness.ts";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer, Message: any;
before(async () => {
  vite = await createServer({
    configFile: false, envFile: false, plugins: [vue()],
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  await initializeRuntimeFixture(vite);
  Message = (await vite.ssrLoadModule("/src/addons/conversation/components/conversation/MessageItem.vue")).default;
});
after(async () => { await vite?.close(); });

const i18n = () => createI18n({ legacy: false, locale: "en", missingWarn: false,
  fallbackWarn: false, messages: { en: { common: { copy: "Copy", copied: "Copied", operationFailed: "Operation failed" } } } });
const item = (content: string) => ({ id: "msg-test", content, role: "assistant", status: "complete", lane: "answer" });
function mount(content: string) {
  let state: any;
  const props = { item: item(content) };
  const app = renderer.createApp(defineComponent({
    setup() {
      state = Message.setup(props, { emit() {}, expose() {}, attrs: {}, slots: {} });
      return () => h("i");
    },
  }));
  app.provide(ssrContextKey, {});
  app.use(i18n()); app.mount(hostNode("root"));
  return { state, props, unmount: () => app.unmount() };
}
function clipboard(t: any, writeText: (value: string) => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText } } });
  t.after(() => original ? Object.defineProperty(globalThis, "navigator", original) : Reflect.deleteProperty(globalThis, "navigator"));
}

test("normal body copies raw Unicode, Markdown and whitespace exactly once", async t => {
  const raw = " \t\u539f\u6587 e\u0301 != \u00e9\n**body** <b>raw</b>\r\n ";
  const calls: string[] = [];
  clipboard(t, async value => { calls.push(value); });
  const vm = mount(raw); t.after(vm.unmount);
  await vm.state.copyBody();
  assert.deepEqual(calls, [raw]);
  assert.equal(vm.state.copyState.value, "copied");
});

test("empty body has no control and cannot invoke clipboard", async t => {
  const calls: string[] = []; clipboard(t, async value => { calls.push(value); });
  const vm = mount(""); t.after(vm.unmount);
  await vm.state.copyBody();
  assert.deepEqual(calls, []);
  const app = createSSRApp(Message, { item: { ...item(""), status: "running" } }); app.use(i18n());
  assert.doesNotMatch(await renderToString(app), /msg-copy/);
});

test("normal copy is a named native keyboard button with status feedback", async () => {
  const app = createSSRApp(Message, { item: { ...item("body"), status: "running" } }); app.use(i18n());
  const html = await renderToString(app);
  assert.match(html, /<button[^>]*type="button"[^>]*class="msg-copy"[^>]*aria-label="Copy"[^>]*title="Copy"/);
  assert.match(html, /role="status"/);
});

test("clipboard rejection is handled and a retry may succeed", async t => {
  let calls = 0;
  clipboard(t, async () => { if (++calls === 1) throw new Error("denied"); });
  const vm = mount("body"); t.after(vm.unmount);
  await vm.state.copyBody();
  assert.equal(vm.state.copyState.value, "error");
  assert.equal(vm.state.copying.value, false);
  await vm.state.copyBody();
  assert.equal(vm.state.copyState.value, "copied");
  assert.equal(calls, 2);
});

test("pending duplicate clicks and retired component cannot copy or report success", async t => {
  let finish!: () => void, calls = 0;
  clipboard(t, () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); });
  const vm = mount("body");
  const pending = vm.state.copyBody();
  await vm.state.copyBody();
  assert.equal(calls, 1);
  vm.unmount(); finish(); await pending;
  assert.notEqual(vm.state.copyState.value, "copied");
  await vm.state.copyBody();
  assert.equal(calls, 1);
});

test("session revalidation blocks copies and a retired business session suppresses late feedback", async t => {
  const auth = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedAuthorization.ts");
  const session = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedSession.ts");
  let finish!: () => void, calls = 0;
  clipboard(t, () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); });
  const vm = mount("body"); t.after(vm.unmount);
  auth.revalidating.value = true;
  await vm.state.copyBody();
  assert.equal(calls, 0);
  auth.revalidating.value = false;
  const pending = vm.state.copyBody();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const windowFixture = Object.assign(new EventTarget(), { parent: null as unknown });
  windowFixture.parent = windowFixture;
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowFixture });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { removeItem() {} } });
  try {
    session.handleEmbeddedUnauthorized("rejected");
    finish(); await pending;
    assert.notEqual(vm.state.copyState.value, "copied");
    assert.equal(calls, 1);
  } finally {
    auth.revalidating.value = false;
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
