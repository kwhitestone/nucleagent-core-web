import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";
import { createRenderer, defineComponent, h, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { resolve } from "node:path";
import { initializeRuntimeFixture } from "../fixtures/runtimeConfig.ts";

// Run explicitly against an OWNED tree containing PR16 + this candidate.
test("real mounted bindings composable keeps unknown writes fenced across renewal and principal switches", async () => {
  assert.ok(process.env.FENCE_ROOT, "FENCE_ROOT must name the owned combined verification tree");
  const window = Object.assign(new EventTarget(), { parent: {} });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => null, setItem() {}, removeItem() {},
  } });
  const vite = await createServer({ root: process.env.FENCE_ROOT, configFile: false, appType: "custom",
    resolve: { alias: { "@": resolve(process.env.FENCE_ROOT, "src") } },
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  let app: any;
  let off: (() => void) | undefined;
  try {
    await initializeRuntimeFixture(vite);
    const { platformRuntime: runtime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
    const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
    const { useSessionBindings } = await vite.ssrLoadModule("/src/addons/conversation/composables/useSessionBindings.ts");
    const coordinator = await vite.ssrLoadModule("/src/addons/conversation/composables/bindingWriteCoordinator.ts");
    const session = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedSession.ts");
    off = registerPlatformRuntime(runtime);
    let principal = "41", revision = "1", writes = 0, syncs = 0;
    let finish!: () => void;
    const snapshot = () => ({ principal, revision, skillIds: [], toolIds: [], editable: true });
    runtime.http.defaults.adapter = async (config: any) => {
      const data = snapshot();
      if (config.method === "put") {
        writes++;
        await new Promise<void>(resolve => { finish = resolve; });
      }
      if (config.url.endsWith("/bindings/sync")) syncs++;
      return { config, data: { data: config.url.includes("/bindings") ? data : [] },
        status: 200, statusText: "Synthetic", headers: {} };
    };
    let state: any, mounts = 0;
    const component = defineComponent({ setup() {
      mounts++;
      state = useSessionBindings(() => "9001", () => false);
      return () => h("span", state.error.value || String(state.pending.value));
    } });
    const renderer = createRenderer<any, any>({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
      parentNode: () => null, nextSibling: () => null,
    });
    runtime.applyShellSession("synthetic-a", 1, [], { id: principal });
    app = renderer.createApp(runtime.authenticatedView(component));
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
    app.mount({});
    const settle = async () => { for (let n = 0; n < 8; n++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } };
    await settle();
    assert.equal(state.saved.value.principal, "41");
    state.skillIds.value = [7];
    const saving = state.save();
    await settle();
    assert.equal(writes, 1);
    const oldSignal = session.sessionRequestSignal();
    runtime.applyShellSession("synthetic-a-renewed", 2, [], { id: "41" });
    await settle();
    assert.equal(mounts, 1, "Natural renewal must not remount the bindings owner");
    assert.equal(oldSignal.aborted, true);
    assert.equal(state.saved.value, null, "Same-revision sync cannot clear an unknown write barrier");
    assert.equal(state.pending.value, true);
    assert.ok(state.error.value);
    assert.ok(syncs >= 2, "Renewal still emits the session event needed for fence/sync");
    await state.save();
    assert.equal(writes, 1, "Unknown write blocks a second write even after transport cancellation");
    finish();
    await saving;
    await settle();
    assert.equal(state.saved.value, null, "Late old write response cannot restore protected selection");
    assert.equal(coordinator.bindingSnapshotCurrent("9001", snapshot()), false);
    principal = "42";
    runtime.applyShellSession("synthetic-b", 3, [], { id: principal });
    await settle();
    assert.equal(mounts, 2);
    assert.equal(state.saved.value.principal, "42");
    assert.deepEqual(state.skillIds.value, []);
    assert.equal(state.uncertain.value, false, "A's unknown barrier must not contaminate B");
    principal = "41";
    runtime.applyShellSession("synthetic-a-return", 4, [], { id: principal });
    await settle();
    assert.equal(state.saved.value, null, "A's barrier survives destruction and returning to A");
    revision = "2";
    await state.load();
    await settle();
    assert.equal(state.saved.value.revision, "2");
    assert.equal(state.pending.value, false, "Only a newer authoritative fence snapshot recovers");
  } finally {
    app?.unmount();
    off?.();
    await vite.close();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
