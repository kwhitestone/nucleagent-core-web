import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createRenderer, h, ssrContextKey, type Component, type ComponentInternalInstance } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import type { DefinitionEditor } from "../src/addons/administration/agents/definition/state.ts";
import { DefinitionError, type Detail } from "../src/addons/administration/agents/definition/api.ts";
import { errorKey, text } from "../src/addons/administration/agents/definition/messages.ts";

// MUYU-342 fix1102c: the admin drawer follows the user wizard on tools a selected skill brings.
let vite: ViteDevServer;
let drawer: Component;
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { default: loaded } = await vite.ssrLoadModule("/src/addons/administration/agents/definition/DefinitionDrawer.vue");
  drawer = { ...loaded, render: () => null };
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null } });
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "window"); Reflect.deleteProperty(globalThis, "document");
});

test("422 tool_covered_by_skill shows the wizard's product text, not a generic error", () => {
  const key = errorKey(new DefinitionError(422, "tool_covered_by_skill"));
  assert.equal(text(key, "zh-CN"), "该工具已随所选技能提供，请取消其一");
  assert.equal(text("toolCovered", "zh-CN"), "已随所选技能提供");
});

test("drawer locks covered tools like the wizard (omit-covered)", () => {
  const source = readFileSync(new URL("../src/addons/administration/agents/definition/DefinitionDrawer.vue", import.meta.url), "utf8");
  const tag = source.slice(source.indexOf("<ToolBindings"), source.indexOf("/>", source.indexOf("<ToolBindings")));
  assert.match(tag, /\somit-covered[\s>]/);
});

const renderer = createRenderer<object, object>({
  patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  parentNode: () => null, nextSibling: () => null,
});
function legacy(): Detail {
  return {
    definition: { id: 1, name: "one", slug: "one", revision: "1", isActive: false, config: {} },
    capabilities: { read: true, write: true, writeIdentity: true, delete: true, restore: true, readSkills: true,
      writeSkillBindings: true, readTools: true, writeTools: true, writeToolBindings: true },
    fieldPolicy: { editablePaths: ["/name"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
    skills: [{ id: 5, name: "S", slug: "s", isActive: true }, { id: 6, name: "T", slug: "t", isActive: true }], tools: [],
    // Legacy: tool 7 is stored next to skill 5, which already brings it.
    skillBindings: [{ skillId: 5, installPath: "" }], toolBindings: [7, 8],
    identity: { uid: 8, status: "ready" }, effective: { revision: "e1", definitionRevision: "1" }, etag: '"agent-1-1"',
  } as Detail;
}

test("legacy covered pair loads; any binding edit strips the covered tool, as the wizard does on save", async () => {
  let instance: ComponentInternalInstance | null = null;
  const props = { detail: legacy(), catalog: { skills: [{ id: 6, name: "T", slug: "t", isActive: true }] },
    api: { models: async () => [], backends: async () => [], genModels: async () => [] } };
  const app = renderer.createApp({ render: () => h(drawer, { ...props,
    onVnodeMounted: (vnode: { component: ComponentInternalInstance | null }) => { instance = vnode.component; } }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
  app.provide(ssrContextKey, {}); app.mount({});
  try {
    const state = instance!.setupState as unknown as {
      editor: DefinitionEditor; toolMetadata: { id: number; name: string; skillIds: number[] }[];
      selectSkill(id: number, checked: boolean): void; selectTool(id: number, checked: boolean): void;
    };
    assert.equal(state.editor.tools, undefined, "loading alone changes nothing");
    state.toolMetadata = [{ id: 7, name: "seven", skillIds: [5] }, { id: 8, name: "eight", skillIds: [] }, { id: 9, name: "nine", skillIds: [6] }];
    state.selectTool(8, false);
    assert.deepEqual(state.editor.tools, [], "covered 7 dropped along with the untick");
    state.editor.tools = undefined;
    state.selectSkill(6, true);
    assert.deepEqual(state.editor.tools, [8], "adding a skill strips the stored covered tool");
    state.selectTool(9, true);
    assert.deepEqual(state.editor.tools, [8], "a tool the new skill brings cannot be picked");
    state.selectSkill(6, false);
    state.selectTool(9, true);
    assert.deepEqual(state.editor.tools, [8, 9], "after the skill is removed the tool is pickable");
  } finally { app.unmount(); }
});
