import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFileSync } from "node:fs";
import { createSSRApp, h, nextTick, ref, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { compileScript, parse } from "@vue/compiler-sfc";
import { descendants, hostNode, renderer } from "./vueComponentHarness.ts";
import { definitionFields } from "../src/addons/administration/agents/definition/draft.ts";
import { groups, ownerGroups } from "../src/components/agent-edit/groups.ts";

let vite: ViteDevServer, Wizard: any, Fields: any, Skills: any, Avatar: any, zh: any;
before(async () => {
  vite = await createServer({
    configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  Wizard = (await vite.ssrLoadModule("/src/addons/conversation/components/UserAgentWizard.vue")).default;
  Fields = (await vite.ssrLoadModule("/src/addons/administration/agents/definition/DefinitionFields.vue")).default;
  Avatar = (await vite.ssrLoadModule("/src/shared/AgentAvatarPicker.vue")).default;
  // Inline client render permits actual button/checkbox interaction with the real component.
  const path = "/src/components/agent-edit/SkillPicker.vue";
  const source = readFileSync(new URL(`..${path}`, import.meta.url), "utf8");
  const { descriptor } = parse(source);
  const compiled = compileScript(descriptor, { id: "skill-test", inlineTemplate: true });
  const { transformWithEsbuild } = await import("vite");
  const js = await transformWithEsbuild(compiled.content, "SkillPicker.ts", { loader: "ts" });
  const transformed = await vite.ssrTransform(js.code, null, path);
  const exports: any = {};
  await new Function("__vite_ssr_exports__", "__vite_ssr_import__", `return (async () => {${transformed!.code}})()`)(
    exports, (id: string) => id.startsWith(".") ? vite.ssrLoadModule(new URL(id, `file://${path}`).pathname) : import(id));
  Skills = exports.default;
  zh = (await vite.ssrLoadModule("/src/i18n/zh.ts")).default;
});
after(async () => { await vite?.close(); });
const i18n = () => createI18n({ legacy: false, locale: "zh", messages: { zh }, missingWarn: false, fallbackWarn: false });
async function render(component: any, props: any) {
  const app = createSSRApp({ render: () => h(component, props) });
  app.use(i18n());
  return renderToString(app);
}

test("both user entry modes render the same ordered admin subset, never privileged fields", async () => {
  assert.deepEqual(ownerGroups, groups.slice(0, 4));
  for (const initial of [undefined, { id: 49, slug: "existing", name: "Example", model: "m" }]) {
    const html = await render(Wizard, { models: ["m"], genModels: { image: ["img"], video: ["vid"] }, busy: false, errors: {}, initial });
    assert.deepEqual([...html.matchAll(/data-group="([^"]+)"/g)].map(m => m[1]), ownerGroups);
    for (const group of ownerGroups) assert.ok(html.includes(`id="ua-group-${group}"`));
    for (const id of ["ua-name", "ua-desc", "ua-prompt", "ua-memory", "ua-backend", "ua-model", "ua-gen-image", "ua-gen-video"])
      assert.ok(html.includes(`id="${id}"`), id);
    assert.match(html, /只有你自己能看到和使用/);
    assert.doesNotMatch(html, /providerId|ua-group-visibility|ua-group-history|ua-group-advanced|ua-gen-music/);
    assert.equal(html.includes('id="ua-slug"'), !!initial);
    if (initial) assert.match(html, /id="ua-slug"[^>]*readonly/);
  }
});

test("admin renders every supported field and retains server-derived readonly policy", async () => {
  const html = await render(Fields, {
    baseline: { name: "Example", config: { defaults: { providerId: 1, model: "m" } } }, changes: {},
    editablePaths: ["/name"], readonlyFields: [], backends: [], providers: [{ value: 1, label: "Provider" }],
    models: [{ value: "m", label: "m" }],
  });
  assert.deepEqual([...html.matchAll(/data-path="([^"]+)"/g)].map(m => m[1]), definitionFields.map(f => f.path));
  assert.match(html, /id="definition-config-defaults-providerId"[^>]*disabled/);
  assert.doesNotMatch(html, /只有你自己能看到和使用/);
});

test("editor surfaces import one implementation of every shared control", () => {
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const user = source("addons/conversation/components/UserAgentWizard.vue");
  const admin = source("addons/administration/agents/definition/DefinitionDrawer.vue");
  for (const component of ["EditSidebar", "SkillPicker", "ToolBindings"]) {
    for (const consumer of [user, admin]) assert.ok(consumer.includes(`components/agent-edit/${component}.vue`));
  }
  for (const consumer of [user, source("addons/administration/agents/definition/DefinitionFields.vue")])
    assert.ok(consumer.includes("components/agent-edit/EditField.vue"));
});

test("shared skill picker preserves missing selected skills, permits removal and blocks additions", async () => {
  const root = hostNode("root"), toggles: unknown[] = [];
  const app = renderer.createApp(Skills, {
    skills: [{ id: 1, name: "Available", slug: "one", isActive: true }, { id: 2, name: "Disabled", slug: "two", isActive: false }],
    selected: [7], editable: true, onToggle: (id: number, checked: boolean) => toggles.push([id, checked]),
  });
  app.use(i18n()); app.provide(ssrContextKey, {}); app.mount(root);
  let nodes = descendants(root);
  assert.ok(nodes.some(n => n.text === "#7"));
  nodes.find(n => n.props.class === "chip-remove")!.props.onClick();
  assert.deepEqual(toggles, [[7, false]]);
  await nodes.find(n => n.props.class === "add-skill")!.props.onClick();
  await nextTick();
  nodes = descendants(root);
  const inputs = nodes.filter(n => n.props.type === "checkbox");
  assert.deepEqual(inputs.map(n => n.props.disabled), [false, true, false]);
  app.unmount();
});

test("reused avatar picker validates locally, resets preview and blocks disabled picks", async () => {
  const selected = ref<File>(), disabled = ref(false);
  let state: any;
  const component = { ...Avatar, render: () => null };
  const app = renderer.createApp({ render: () => h(component, {
    modelValue: selected.value, disabled: disabled.value,
    "onUpdate:modelValue": (file: File | undefined) => { selected.value = file; },
    onVnodeMounted: (v: any) => { state = v.component.setupState; },
  }) });
  app.use(i18n()); app.provide(ssrContextKey, {}); app.mount(hostNode("root"));
  const pick = (file: File) => state.pick({ target: { files: [file], value: "local" } });
  try {
    pick(new File(["x"], "invalid.svg", { type: "image/svg+xml" }));
    assert.equal(selected.value, undefined);
    assert.equal(state.invalid, "type");
    const valid = new File(["png"], "avatar.png", { type: "image/png" });
    pick(valid); await nextTick();
    assert.equal(selected.value, valid);
    assert.match(state.preview, /^blob:/);
    state.reset(); await nextTick();
    assert.equal(state.preview, "");
    assert.equal(selected.value, undefined);
    disabled.value = true; await nextTick();
    pick(valid);
    assert.equal(selected.value, undefined);
  } finally { app.unmount(); }
});
