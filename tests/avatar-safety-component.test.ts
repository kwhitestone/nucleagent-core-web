import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRenderer, h, nextTick, ssrContextKey } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import type { Detail, Transport } from "../src/addons/administration/agents/definition/api.ts";

let vite: ViteDevServer, drawer: any, picker: any, createApi: any;
const image = () => new File(["synthetic-preview"], "synthetic.png", { type: "image/png" });
const detail = (): Detail => ({
  definition: { id: 4, name: "synthetic", slug: "synthetic", revision: "1", isActive: false, config: {} },
  capabilities: { read: true, write: true, writeIdentity: true, delete: false, restore: false,
    readSkills: true, writeSkillBindings: true, readTools: true, writeTools: true, writeToolBindings: true },
  fieldPolicy: { editablePaths: ["/config/description"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skills: [], tools: [], skillBindings: [], identity: { uid: 8, status: "ready" },
  effective: { revision: "1", definitionRevision: "1" }, etag: '"agent-4-1"',
});
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  drawer = (await vite.ssrLoadModule("/src/addons/administration/agents/definition/DefinitionDrawer.vue")).default;
  picker = (await vite.ssrLoadModule("/src/shared/AgentAvatarPicker.vue")).default;
  createApi = (await vite.ssrLoadModule("/src/addons/administration/agents/definition/api.ts")).createDefinitionApi;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "document"); Reflect.deleteProperty(globalThis, "window");
});
const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null,
});
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick(); };
function mount(transport: Transport, overrides = {}) {
  let state: any, preview: any;
  const created: string[] = [], revoked: string[] = [];
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => { const url = `blob:synthetic-${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  const api = { ...createApi(transport), models: async () => [{ providerId: 1, model: "synthetic" }],
    backends: async () => [{ id: "synthetic" }], genModels: async () => [{ model: "synthetic" }],
    toolCatalog: async () => [{ id: 1, name: "synthetic", skillIds: [] }], ...overrides };
  // Real drawer/picker setup, watchers and model binding; no browser rendering claimed.
  const component = { ...drawer, render(this: any) {
    const editor = this.$.setupState.editor;
    return h({ ...picker, render: () => null }, { modelValue: editor.avatar,
      "onUpdate:modelValue": (file: File | undefined) => { editor.avatar = file; },
      onVnodeMounted: (v: any) => { preview = v.component.setupState; } });
  } };
  const app = renderer.createApp({ render: () => h(component, { api, detail: detail(),
    onVnodeMounted: (v: any) => { state = v.component.setupState; } }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
  app.provide(ssrContextKey, {});
  app.mount({});
  return { state: () => state, preview: () => preview, api, created, revoked, close() {
    app.unmount(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  } };
}

for (const status of [401, 403]) test(`avatar safety: drawer clears readback ${status} without unmount or resend`, async () => {
  let posts = 0;
  const view = mount(async (_path, init) => {
    if (init?.method === "POST") {
      posts++;
      return { status: 200, headers: {}, body: { fileId: "synthetic", path: "/api/v1/avatars/synthetic" } };
    }
    return { status, headers: {}, body: { code: "forbidden" } };
  });
  try {
    await flush();
    const state = view.state();
    assert.ok(state.models.length && state.backends.length && state.toolCatalog.length && Object.keys(state.genModels).length);
    state.audits = [{ id: 1 }]; state.instances = [{ instanceId: 1 }]; state.total = 1;
    state.editor.avatar = image(); await nextTick();
    assert.ok(view.preview().preview);
    await state.editor.save(view.api); await flush();
    assert.equal(state.editor.record, null);
    assert.equal(state.editor.avatar, undefined);
    assert.equal(view.preview().preview, "");
    assert.deepEqual(view.revoked, view.created);
    assert.deepEqual(state.models, []); assert.deepEqual(state.backends, []);
    assert.deepEqual(state.genModels, {}); assert.equal(state.toolCatalog, null);
    assert.deepEqual(state.audits, []); assert.deepEqual(state.instances, []); assert.equal(state.total, 0);
    await state.editor.save(view.api);
    assert.equal(posts, 1);
  } finally { view.close(); }
});

test("avatar safety: write rejection retains readable content and text draft", async () => {
  let posts = 0;
  const view = mount(async () => { posts++; return { status: 403, headers: {}, body: { code: "forbidden" } }; });
  try {
    await flush();
    const state = view.state();
    state.editor.avatar = image(); await nextTick();
    await state.editor.save(view.api); await flush();
    assert.ok(state.editor.record);
    assert.ok(state.models.length && state.toolCatalog.length);
    assert.equal(state.editor.denied, true);
    await state.editor.save(view.api);
    assert.equal(posts, 1);
  } finally { view.close(); }
});

test("avatar safety: late catalogs cannot repopulate after read revocation", async () => {
  let resolveTools!: (v: any[]) => void, resolveModels!: (v: any[]) => void;
  const tools = new Promise<any[]>(resolve => { resolveTools = resolve; });
  const models = new Promise<any[]>(resolve => { resolveModels = resolve; });
  const view = mount(async () => { throw new Error("unexpected"); }, {
    toolCatalog: () => tools, genModels: () => models,
  });
  try {
    await flush();
    view.state().editor.revokeRead(); await nextTick();
    resolveTools([{ id: 1 }]); resolveModels([{ model: "synthetic" }]); await flush();
    assert.equal(view.state().toolCatalog, null);
    assert.deepEqual(view.state().genModels, {});
  } finally { view.close(); }
});
