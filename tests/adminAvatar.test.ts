import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRenderer, h, nextTick, ref, ssrContextKey, type Component } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createDefinitionApi, DefinitionError, type DefinitionApi, type Detail } from "../src/addons/administration/agents/definition/api.ts";
import { DefinitionEditor } from "../src/addons/administration/agents/definition/state.ts";
import { USER_AVATAR_CONTRACT } from "../src/addons/conversation/api/userAvatar.ts";

const file = () => new File(["png"], "avatar.png", { type: "image/png" });
const detail = (revision = "1", avatar = ""): Detail => ({
  definition: { id: 4, name: "fixture", slug: "fixture", revision, isActive: false, config: { avatar } },
  capabilities: { read: true, write: true, writeIdentity: false, delete: false, restore: false,
    readSkills: false, writeSkillBindings: false, readTools: false, writeTools: false },
  fieldPolicy: { editablePaths: ["/config/description"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skills: [], tools: [], skillBindings: [], identity: { uid: 8, status: "ready" },
  effective: { revision, definitionRevision: revision }, etag: `"agent-4-${revision}"`,
});

test("admin upload uses multipart, CAS and user response fields, then reads back", async () => {
  const calls: string[] = [];
  const path = USER_AVATAR_CONTRACT.pathPrefix + "file-id";
  const api = createDefinitionApi(async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "POST") {
      assert.equal((init.headers as Record<string, string>)["If-Match"], '"agent-4-1"');
      assert.equal((init.headers as Record<string, string>)["Content-Type"], undefined);
      assert.ok(init.body instanceof FormData);
      assert.equal((init.body.get("file") as File).name, "avatar.png");
      return { status: 200, headers: {}, body: { fileId: "file-id", path } };
    }
    return { status: 200, headers: { etag: '"agent-4-2"' }, body: { code: 0, data: detail("2", path) } };
  });
  assert.equal((await api.uploadAvatar(detail(), file())).definition.config?.avatar, path);
  assert.deepEqual(calls, ["POST /api/v1/addons/admin/agents/4/avatar", "GET /api/v1/addons/admin/agents/4"]);
});

test("invalid files and read-only users never send uploads", async () => {
  let calls = 0;
  const api = createDefinitionApi(async () => { calls++; throw new Error("unexpected request"); });
  for (const invalid of [new File(["x"], "a.svg", { type: "image/svg+xml" }),
    new File([new Uint8Array(USER_AVATAR_CONTRACT.maxBytes + 1)], "a.png", { type: "image/png" })]) {
    await assert.rejects(api.uploadAvatar(detail(), invalid), (e: DefinitionError) => e.status === 422);
  }
  const denied = detail(); denied.capabilities.write = false;
  await assert.rejects(api.uploadAvatar(denied, file()), (e: DefinitionError) => e.status === 403);
  assert.equal(calls, 0);
});

test("pending avatar is dirty, cancel clears it without any request", () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = file();
  assert.equal(editor.dirty, true);
  editor.clear();
  assert.equal(editor.avatar, undefined);
  assert.equal(editor.dirty, false);
});

test("avatar-only save bypasses generic identity PATCH and clears pending file after readback", async () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = file();
  let uploads = 0;
  const saved = detail("2", "/api/v1/avatars/new");
  const api = { patch: async () => { assert.fail("avatar must not use generic identity PATCH"); },
    uploadAvatar: async (record: Detail) => { uploads++; assert.equal(record.etag, '"agent-4-1"'); return saved; } } as unknown as DefinitionApi;
  assert.equal(await editor.save(api), saved);
  assert.equal(editor.avatar, undefined);
  assert.equal(editor.dirty, false);
  assert.equal(await editor.save(api), null);
  assert.equal(uploads, 1);
});

test("partial save retains the avatar but does not replay committed field edits", async () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.change("/config/description", "updated"); editor.avatar = file();
  let patches = 0, uploads = 0;
  const api = { patch: async () => { patches++; return detail("2"); },
    uploadAvatar: async (record: Detail) => {
      assert.equal(record.etag, '"agent-4-2"');
      if (++uploads === 1) throw new DefinitionError(422, "invalid_avatar");
      return detail("3", "/api/v1/avatars/new");
    } } as unknown as DefinitionApi;
  assert.equal(await editor.save(api), null);
  assert.ok(editor.avatar);
  assert.deepEqual(editor.changes, {});
  assert.ok(await editor.save(api));
  assert.equal(patches, 1);
});

test("avatar conflicts and uncertain writes cannot be retried without reconciliation", async () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = file();
  let calls = 0;
  const api = { uploadAvatar: async () => { calls++; throw new Error("connection lost"); } } as unknown as DefinitionApi;
  await editor.save(api);
  assert.equal(editor.verificationRequired, true);
  await editor.save(api);
  assert.equal(calls, 1);
  editor.acceptRefresh(detail("2", "/api/v1/avatars/concurrent"));
  assert.ok(editor.current);
  await editor.save(api);
  assert.equal(calls, 1);
});

test("concurrent avatar changes require an explicit choice and can discard the pending file", () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = file();
  editor.acceptRefresh(detail("2", "/api/v1/avatars/concurrent"));
  assert.throws(() => editor.resolve({}), /avatar choice/);
  editor.resolve({ "/config/avatar": "current" });
  assert.equal(editor.avatar, undefined);
  assert.equal(editor.dirty, false);
  assert.equal(editor.record?.definition.revision, "2");
});

test("successful upload with failed readback is uncertain, never silently retried", async () => {
  let posts = 0;
  const api = createDefinitionApi(async (_url, init) => {
    if (init?.method === "POST") {
      posts++;
      return { status: 200, headers: {}, body: { fileId: "new", path: "/api/v1/avatars/new" } };
    }
    return { status: 404, headers: {}, body: { code: "not_found" } };
  });
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = file();
  await editor.save(api);
  assert.equal(editor.verificationRequired, true);
  await editor.save(api);
  assert.equal(posts, 1);
});

let vite: ViteDevServer, picker: any, wizard: any, drawer: any;
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  picker = (await vite.ssrLoadModule("/src/shared/AgentAvatarPicker.vue")).default;
  wizard = (await vite.ssrLoadModule("/src/addons/conversation/components/UserAgentWizard.vue")).default;
  drawer = (await vite.ssrLoadModule("/src/addons/administration/agents/definition/DefinitionDrawer.vue")).default;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});
const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null,
});
function mount(component: Component, props: () => Record<string, unknown>) {
  let instance: any;
  const mountedComponent = { ...component, render: () => null };
  const app = renderer.createApp({ render: () => h(mountedComponent, {
    ...props(), onVnodeMounted: (v: any) => { instance = v.component; },
  }) });
  app.use(createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: {} } }));
  app.provide(ssrContextKey, {});
  app.mount({});
  return { app, state: () => instance.setupState };
}

test("shared picker validates, previews locally, resets and releases object URLs", async () => {
  const selected = ref<File>();
  const { app, state } = mount(picker, () => ({ modelValue: selected.value,
    "onUpdate:modelValue": (value: File | undefined) => { selected.value = value; } }));
  const pick = (value: File) => state().pick({ target: { files: [value], value: "local" } });
  try {
    pick(new File(["x"], "a.svg", { type: "image/svg+xml" }));
    assert.equal(selected.value, undefined);
    assert.equal(state().invalid, "type");
    pick(file()); await nextTick();
    assert.ok(selected.value);
    assert.match(state().preview, /^blob:/);
    state().reset(); await nextTick();
    assert.equal(selected.value, undefined);
    assert.equal(state().preview, "");
  } finally { app.unmount(); }
});

test("wizard and drawer bind the exact same picker; pending avatar makes close ask to discard", async () => {
  const user = mount(wizard, () => ({ models: [], busy: false, errors: {} }));
  const admin = mount(drawer, () => ({ detail: detail(), api: {
    models: async () => [], backends: async () => [], genModels: async () => [],
  } }));
  try {
    assert.equal(user.state().AgentAvatarPicker, picker);
    assert.equal(admin.state().AgentAvatarPicker, picker);
    admin.state().editor.avatar = file();
    assert.equal(admin.state().canSave, true);
    assert.equal(admin.state().pending, 1);
    admin.state().close();
    assert.equal(admin.state().discard, true);
  } finally { user.app.unmount(); admin.app.unmount(); }
});
