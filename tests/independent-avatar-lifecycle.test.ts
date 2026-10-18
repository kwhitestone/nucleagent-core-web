import assert from "node:assert/strict";
import { test } from "node:test";
import { createRenderer, h, nextTick, ref, ssrContextKey } from "vue";
import { createI18n } from "vue-i18n";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createDefinitionApi, type Detail } from "../src/addons/administration/agents/definition/api.ts";
import { DefinitionEditor } from "../src/addons/administration/agents/definition/state.ts";

const image = () => new File(["synthetic-picker-only"], "synthetic.png", { type: "image/png" });
const detail = (revision = "1"): Detail => ({
  definition: { id: 4, name: "synthetic", slug: "synthetic", revision, isActive: false, config: {} },
  capabilities: { read: true, write: true, writeIdentity: false, delete: false, restore: false,
    readSkills: false, writeSkillBindings: false, readTools: false, writeTools: false },
  fieldPolicy: { editablePaths: ["/config/description"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skills: [], tools: [], skillBindings: [], identity: { uid: 8, status: "ready" },
  effective: { revision, definitionRevision: revision }, etag: `"agent-4-${revision}"`,
});

test("independent: object URLs are revoked on replace, cancel and unmount", async () => {
  const vite = await createServer({ configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const created: string[] = [], revoked: string[] = [];
  URL.createObjectURL = () => { const url = `blob:synthetic-${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  let app: ReturnType<ReturnType<typeof createRenderer>["createApp"]> | undefined;
  try {
    const picker = (await vite.ssrLoadModule("/src/shared/AgentAvatarPicker.vue")).default;
    const renderer = createRenderer<object, object>({
      patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null,
    });
    const selected = ref<File | undefined>(image());
    let state: any;
    app = renderer.createApp({ render: () => h({ ...picker, render: () => null }, {
      modelValue: selected.value,
      "onUpdate:modelValue": (value: File | undefined) => { selected.value = value; },
      onVnodeMounted: (v: any) => { state = v.component.setupState; },
    }) });
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
    app.provide(ssrContextKey, {});
    app.mount({});
    selected.value = image(); await nextTick();
    assert.deepEqual(revoked, [created[0]]);
    state.reset(); await nextTick();
    assert.equal(selected.value, undefined);
    assert.deepEqual(revoked, created);
    selected.value = image(); await nextTick();
    app.unmount(); app = undefined;
    assert.equal(created.length, 3);
    assert.deepEqual(revoked, created);
  } finally {
    app?.unmount();
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    await vite.close();
  }
});

test("independent: real API adapter keeps committed fields when the avatar request fails", async () => {
  const calls: string[] = [];
  const saved = detail("2"); saved.definition.config = { description: "committed" };
  const api = createDefinitionApi(async (_url, init) => {
    calls.push(init?.method ?? "GET");
    if (init?.method === "PATCH") return { status: 200, headers: { etag: saved.etag }, body: { code: 0, data: saved } };
    if (init?.method === "POST") {
      assert.equal((init.headers as Record<string, string>)["If-Match"], saved.etag);
      return { status: 422, headers: {}, body: { code: "invalid_avatar" } };
    }
    assert.fail("unexpected request");
  });
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.change("/config/description", "committed"); editor.avatar = image();
  assert.equal(await editor.save(api), null);
  assert.equal(editor.record?.definition.config?.description, "committed");
  assert.deepEqual(editor.changes, {});
  assert.ok(editor.avatar);
  assert.equal(editor.error, "error");
  await editor.save(api);
  assert.deepEqual(calls, ["PATCH", "POST", "POST"]);
});
