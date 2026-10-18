import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { createRenderer, h, nextTick, ref, ssrContextKey, type Component } from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import { createI18n } from "vue-i18n";
import { routerKey, routeLocationKey } from "vue-router";
import { createServer, type ViteDevServer } from "vite";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import en from "../src/i18n/en.ts";
import zh from "../src/i18n/zh.ts";
import { countByGroup, debounce, filterOptions, highlight, skillSource, PAGE_SIZE } from "../src/addons/conversation/components/pickerSearch.ts";
import { toolOptions } from "../src/addons/conversation/api/toolCatalog.ts";
import type { Skill } from "../src/addons/conversation/api/types.ts";

// ---- pure search model ----

const skill = (id: number, extra: Partial<Skill> = {}): Skill => ({ id, name: `skill-${id}`, slug: `s${id}`, isActive: true, ...extra });

test("source: engine rows are imported, is_system rows system, the rest mine", () => {
  assert.equal(skillSource(skill(1, { sourceSystem: "agentia-engine", config: { is_system: true } })), "imported");
  assert.equal(skillSource(skill(2, { config: { is_system: true } })), "system");
  assert.equal(skillSource(skill(3, { config: { is_system: false } })), "mine");
  assert.equal(skillSource(skill(4)), "mine");
});

test("filter matches label, note and keywords case-insensitively, within a group", () => {
  const options = [
    { label: "智能占卜", note: "Tarot reading", keywords: "fortune", group: "imported" },
    { label: "PDF Tools", note: "merge files", keywords: "office", group: "system" },
    { label: "Notes", note: "", keywords: "", group: "mine" },
  ];
  assert.deepEqual(filterOptions(options, "占卜").map((o) => o.label), ["智能占卜"]);
  assert.deepEqual(filterOptions(options, "  pdf ").map((o) => o.label), ["PDF Tools"]);
  assert.deepEqual(filterOptions(options, "TAROT").map((o) => o.label), ["智能占卜"]);
  assert.deepEqual(filterOptions(options, "office").map((o) => o.label), ["PDF Tools"]);
  assert.equal(filterOptions(options, "").length, 3);
  assert.deepEqual(filterOptions(options, "", "mine").map((o) => o.label), ["Notes"]);
  assert.deepEqual(filterOptions(options, "pdf", "imported"), []);
  assert.deepEqual(countByGroup(options), { imported: 1, system: 1, mine: 1 });
});

test("highlight marks every case-insensitive hit and keeps the full text", () => {
  assert.deepEqual(highlight("Data data", "DATA"), [
    { text: "Data", hit: true }, { text: " ", hit: false }, { text: "data", hit: true },
  ]);
  assert.deepEqual(highlight("abc", "x"), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlight("abc", " "), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlight("xab", "ab"), [{ text: "x", hit: false }, { text: "ab", hit: true }]);
  // Lower-casing "İ" changes the length; no marks rather than shifted marks.
  assert.deepEqual(highlight("İstanbul", "stan"), [{ text: "İstanbul", hit: false }]);
});

test("debounce runs once with the last value and can be cancelled", async () => {
  const seen: string[] = [];
  const run = debounce((v: string) => seen.push(v), 20);
  run("a"); run("ab"); run("abc");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["abc"]);
  run("x"); run.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ["abc"]);
});

test("tool catalog placeholder maps safe fields only, localized, with import badge", () => {
  const options = toolOptions([
    { id: 7, name: "get_next_holiday", description: "holidays", i18n: { zh: { name: "节假日" } }, imported: true },
    { id: 8, name: "calc", i18n: { zh: "junk" } },
  ], "zh", "导入");
  assert.deepEqual(options, [
    { value: "7", label: "节假日", note: "holidays", keywords: "get_next_holiday", group: "imported", badges: ["导入"] },
    { value: "8", label: "calc", note: undefined, keywords: "calc", group: "system", badges: undefined },
  ]);
});

// ---- components through a minimal tree renderer (no DOM package) ----

interface N { tag: string; text?: string; value?: string; props: Record<string, unknown>; children: N[]; parent?: N; on: Record<string, (e: unknown) => void> }
const node = (tag: string, text?: string): N => ({ tag, text, props: {}, children: [], on: {} });
const body = node("body");
const detach = (child: N) => {
  const p = child.parent;
  if (p) { p.children.splice(p.children.indexOf(child), 1); child.parent = undefined; }
};
const renderer = createRenderer<N, N>({
  createElement: (tag) => Object.assign(node(tag), {
    style: {},
    addEventListener(this: N, event: string, fn: (e: unknown) => void) { this.on[event] = fn; },
    removeEventListener() {},
    querySelector: () => null,
  }),
  createText: (text) => node("#text", text),
  createComment: (text) => node("#comment", text),
  setText: (n, text) => { n.text = text; },
  setElementText: (n, text) => { n.children = [Object.assign(node("#text", text), { parent: n })]; },
  insert: (child, parent, anchor) => {
    detach(child); child.parent = parent;
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child);
  },
  remove: detach,
  patchProp: (n, key, _prev, next) => { n.props[key] = next; },
  parentNode: (n) => n.parent ?? null,
  nextSibling: (n) => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] ?? null : null),
  querySelector: () => body,
});
const textOf = (n: N): string => (n.tag === "#text" ? n.text ?? "" : n.tag === "#comment" ? "" : n.children.map(textOf).join(""));
const all = (n: N, cls: string): N[] => [
  ...(String(n.props.class ?? "").split(" ").includes(cls) ? [n] : []),
  ...n.children.flatMap((c) => all(c, cls)),
];
const click = (n: N) => (n.props.onClick as (e?: unknown) => void)();
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** vite's SSR build only renders to a string; attach a client render so clicks and inputs run. */
async function clientComponent(path: string, children: Record<string, Component> = {}): Promise<Component> {
  const loaded = (await vite.ssrLoadModule(path)).default;
  const { descriptor } = parse(readFileSync(new URL(`..${path}`, import.meta.url), "utf8"), { filename: path });
  const { bindings } = compileScript(descriptor, { id: path });
  const { code } = compileTemplate({ source: descriptor.template!.content, filename: path, id: path,
    compilerOptions: { mode: "function", bindingMetadata: bindings, prefixIdentifiers: true } });
  const setup = (props: unknown, ctx: unknown) => {
    const bindings = loaded.setup(props, ctx);
    return Object.defineProperty({ ...bindings, ...children }, "__isScriptSetup", { value: true });
  };
  return { ...loaded, setup, ssrRender: undefined, render: new Function("Vue", code)(Vue) };
}

let vite: ViteDevServer;
let sheet: Component;
let picker: Component;
let toolPicker: Component;
let bindingPickers: Component;
let editor: Component;
let conversation: Component;
let observePending = (_value: boolean) => {};
let streamMounts = 0;
let streamStops = 0;
let liveStatus = (_status: string) => {};
let capabilities: { send: boolean; stop: boolean };
const media = new EventTarget() as EventTarget & { matches: boolean };
media.matches = false;
function resize(narrow: boolean) {
  media.matches = narrow;
  media.dispatchEvent(Object.assign(new Event("change"), { matches: narrow }));
}
let unregister: () => void;
let respond: (config?: any) => Promise<unknown> = async () => ({ code: 0, data: [] });

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  const el = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null, documentElement: {}, createElement: el, body: el() } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime(platformRuntime);
  http.defaults.adapter = async (config: unknown) => ({ config, data: await respond(config), headers: {}, status: 200, statusText: "OK" });
  sheet = await clientComponent("/src/addons/conversation/components/OptionSheet.vue");
  picker = await clientComponent("/src/addons/conversation/components/SkillPicker.vue", { OptionSheet: sheet });
  toolPicker = await clientComponent("/src/addons/conversation/components/ToolPicker.vue", { OptionSheet: sheet });
  bindingPickers = await clientComponent("/src/addons/conversation/components/BindingPickers.vue", { SkillPicker: picker, ToolPicker: toolPicker });
  editor = await clientComponent("/src/addons/conversation/components/SessionBindingsEditor.vue", { BindingPickers: bindingPickers });
  const win = new EventTarget();
  Object.defineProperty(win, "parent", { value: win });
  Object.defineProperty(win, "matchMedia", { value: () => media });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  const empty = { render: () => null };
  const streamProbe = Vue.defineComponent({
    props: ["capabilities"],
    emits: ["status-change"],
    setup(props, { slots, emit }) {
      Vue.onMounted(() => { streamMounts++; });
      Vue.onBeforeUnmount(() => { streamStops++; });
      liveStatus = (status) => emit("status-change", status);
      Vue.watchEffect(() => {
        capabilities = props.capabilities;
        observePending(!capabilities.send);
      });
      return () => h("div", { class: "stream-probe" }, slots["composer-toolbar-leading"]?.({ status: "idle" }));
    },
  });
  const backend = {
    emits: ["validation-change"],
    setup(_props: unknown, { emit }: any) {
      Vue.onMounted(() => emit("validation-change", { allowed: true }));
      return () => null;
    },
  };
  conversation = await clientComponent("/src/addons/conversation/views/Conversation.vue", {
    SessionBindingsEditor: editor, TaskConversation: streamProbe, ModelPicker: empty,
    ExecutionBackendPicker: backend, ChatGenBar: empty,
  });
});

after(async () => {
  unregister();
  await vite.close();
  for (const key of ["localStorage", "document", "window"]) Reflect.deleteProperty(globalThis, key);
});

function mount(component: Component, props: () => Record<string, unknown>, locale = "en") {
  body.children = [];
  const root = node("root");
  const app = renderer.createApp({ render: () => h(component, props()) });
  app.use(createI18n({ legacy: false, locale, messages: { en, zh } }));
  app.provide(ssrContextKey, {});
  app.provide(routerKey, { replace: async () => {} } as any);
  app.provide(routeLocationKey, { query: {} } as any);
  app.mount(root);
  return { root, app };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => ({
  value: String(i + 1), label: `Skill ${i + 1}`, note: i === 41 ? "reads tarot cards" : "", keywords: `cat-${i % 3}`,
  group: ["system", "imported", "mine"][i % 3], badges: i % 3 === 1 ? ["Imported"] : undefined,
}));
const groups = [{ value: "system", label: "System" }, { value: "imported", label: "Imported" }, { value: "mine", label: "Mine" }];

test("600 options render one page, grow by page, and search narrows with highlight after debounce", async () => {
  const model = ref<string[]>(["2", "5"]);
  const { app } = mount(sheet, () => ({ open: true, title: "Skills", options: many(600), modelValue: model.value, multiple: true,
    searchable: true, groups, "onUpdate:modelValue": (v: string[]) => { model.value = v; } }));
  try {
    await flush();
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE);
    assert.match(textOf(all(body, "osheet-more")[0]), /550 left/);
    assert.deepEqual(all(body, "osheet-tab").map(textOf), ["All 600", "Selected 2", "System 200", "Imported 200", "Mine 200"]);
    assert.equal(all(body, "osheet-badge").length, 17, "imported rows on the first page carry the badge");
    click(all(body, "osheet-more")[0]); await nextTick();
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE * 2);

    click(all(body, "osheet-tab")[3]); await nextTick();
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE, "switching group resets paging");
    assert.ok(all(body, "osheet-row").every((r) => all(r, "osheet-badge").length === 1));
    click(all(body, "osheet-tab")[1]); await nextTick();
    assert.deepEqual(all(body, "osheet-row").map((r) => textOf(all(r, "osheet-label")[0])), ["Skill 2Imported", "Skill 5Imported"]);
    click(all(body, "osheet-row")[0]); await nextTick();
    assert.deepEqual(model.value, ["5"], "deselecting from the Selected tab removes it");
    click(all(body, "osheet-tab")[0]); await nextTick();

    const input = all(body, "osheet-search")[0];
    input.value = "TAROT"; input.on.input({ target: input });
    await nextTick();
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE, "no filtering before the debounce fires");
    await sleep(260);
    const rows = all(body, "osheet-row");
    assert.deepEqual(rows.map((r) => textOf(all(r, "osheet-label")[0])), ["Skill 42"]);
    const marks: string[] = [];
    const walk = (n: N) => { if (n.tag === "mark") marks.push(textOf(n)); n.children.forEach(walk); };
    walk(rows[0]);
    assert.deepEqual(marks, ["tarot"]);
    input.value = "cat-2"; input.on.input({ target: input }); await sleep(260);
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE, "keywords are searched");
    assert.match(textOf(all(body, "osheet-more")[0]), /150 left/);
  } finally { app.unmount(); }
});

test("sheet shows loading, error with retry, and the empty text", async () => {
  let retried = 0;
  const state = ref<Record<string, unknown>>({ loading: true });
  const { app } = mount(sheet, () => ({ open: true, title: "Skills", options: [], modelValue: [], multiple: true, emptyText: "No skills available",
    onRetry: () => { retried += 1; }, ...state.value }));
  try {
    await flush();
    assert.equal(all(body, "osheet-row").length, 0);
    assert.match(textOf(body), /Loading/);
    state.value = { error: "Failed to load skills" }; await nextTick();
    assert.match(textOf(body), /Failed to load skills/);
    click(all(body, "osheet-more")[0]);
    assert.equal(retried, 1);
    state.value = {}; await nextTick();
    assert.match(textOf(body), /No skills available/);
  } finally { app.unmount(); }
});

test("skill picker groups by source, badges imports, and flags selected-but-unavailable skills removable", async () => {
  const rows: Skill[] = [
    ...Array.from({ length: 500 }, (_, i) => skill(i + 1, { sourceSystem: "agentia-engine", config: { category: "fun" } })),
    skill(900, { config: { is_system: true, description: "built in" }, i18n: { zh: { name: "系统技能" } } }),
    skill(901),
  ];
  respond = async () => ({ code: 0, data: rows });
  const model = ref<number[]>([3, 900, 4242]);
  const { root, app } = mount(picker, () => ({ modelValue: model.value, "onUpdate:modelValue": (v: number[]) => { model.value = v; } }), "zh");
  try {
    await flush();
    const chips = all(root, "skill-chip");
    assert.deepEqual(chips.map((c) => textOf(all(c, "skill-chip-name")[0])), ["skill-3", "系统技能", "#4242"]);
    assert.equal(textOf(all(chips[0], "skill-chip-badge")[0]), "导入");
    assert.equal(textOf(all(chips[2], "skill-chip-badge")[0]), "需启用");
    assert.ok(String(chips[2].props.class).includes("missing"));
    assert.match(textOf(all(root, "skill-total")[0]), /502/);

    click(all(root, "skill-toggle")[0]); await nextTick();
    assert.deepEqual(all(body, "osheet-tab").map(textOf), ["全部 502", "已选 2", "系统 1", "导入 500", "我的 1"]);
    assert.equal(all(body, "osheet-row").length, PAGE_SIZE);
    assert.equal(textOf(all(all(body, "osheet-row")[0], "osheet-badge")[0]), "导入");
    assert.equal(all(body, "osheet-search")[0].props.placeholder, "搜索技能名称、描述、分类");

    click(all(chips[2], "skill-chip-remove")[0]);
    assert.deepEqual(model.value, [3, 900]);
    await nextTick();
    click(all(all(root, "skill-chip")[0], "skill-chip-remove")[0]);
    assert.deepEqual(model.value, [900]);
  } finally { app.unmount(); }
});

test("skill picker load failure shows a retryable error, then recovers", async () => {
  let fail = true;
  respond = async () => { if (fail) throw new Error("offline"); return { code: 0, data: [skill(1)] }; };
  const { root, app } = mount(picker, () => ({ modelValue: [] }));
  try {
    await flush();
    click(all(root, "skill-toggle")[0]); await nextTick();
    assert.match(textOf(body), /Failed to load skills/);
    assert.equal(all(body, "osheet-row").length, 0);
    fail = false;
    click(all(body, "osheet-more")[0]); await flush();
    assert.equal(all(body, "osheet-row").length, 1);
  } finally { app.unmount(); }
});

for (const kind of ["skill", "tool"] as const) {
  test(`${kind} picker caps additions at 50 but permits removal`, async () => {
    respond = async () => ({ data: Array.from({ length: 51 }, (_, i) => skill(i + 1)) });
    const selected = ref(Array.from({ length: 50 }, (_, i) => i + 1));
    const tools = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, name: `t${i + 1}` }));
    const { root, app } = mount(kind === "skill" ? picker : toolPicker, () => ({
      modelValue: selected.value, ...(kind === "tool" ? { tools } : {}), "onUpdate:modelValue": (ids: number[]) => { selected.value = ids; },
    }));
    try {
      await flush();
      assert.match(textOf(root), /Maximum 50/);
      click(all(root, `${kind}-toggle`)[0]); await nextTick();
      click(all(body, "osheet-more")[0]); await nextTick();
      assert.equal(all(body, "osheet-row").at(-1)?.props.disabled, true);
      assert.equal(all(body, "osheet-row")[0].props.disabled, false);
      click(all(root, `${kind}-chip-remove`)[0]); await nextTick();
      assert.equal(selected.value.length, 49);
      assert.equal(all(body, "osheet-row").at(-1)?.props.disabled, false);
    } finally { app.unmount(); }
  });
}

const sessionResponse = (config: any) => /\/conversation\/\d+$/.test(config.url)
  ? { data: { id: Number(config.url.split("/").at(-1)), title: "synthetic", status: "completed", mode: "a2a_agent", providerId: 1, model: "synthetic", executionBackend: "codex" } }
  : config.url.includes("/messages") || config.url.includes("/generations")
  ? { data: [] }
  : config.url.endsWith("/bindings")
  ? { data: { skillIds: [1], toolIds: [2], editable: true } }
  : { data: config.url.endsWith("/catalog") ? [{ id: 2, name: "tool-2" }] : [skill(1), skill(3)] };

test("session editor reads chips, applies [] to clear, then uses server readback", async () => {
  const writes: any[] = [];
  const pending: boolean[] = [];
  respond = async (config) => {
    if (config.method === "put") {
      writes.push(JSON.parse(config.data));
      return { data: { ...writes.at(-1), editable: true } };
    }
    return sessionResponse(config);
  };
  const { root, app } = mount(editor, () => ({ id: "11", onPending: (v: boolean) => pending.push(v) }));
  try {
    await flush();
    assert.equal(all(root, "skill-chip").length, 1);
    assert.equal(all(root, "tool-chip").length, 1);
    click(all(root, "skill-chip-remove")[0]);
    click(all(root, "tool-chip-remove")[0]); await nextTick();
    assert.equal(pending.at(-1), true);
    const actions = all(root, "conversation-settings-actions")[0];
    click(actions.children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    assert.deepEqual(writes, [{ skillIds: [], toolIds: [] }]);
    assert.equal(pending.at(-1), false);
    assert.equal(all(root, "skill-chip").length + all(root, "tool-chip").length, 0);
  } finally { app.unmount(); }
});

test("session save refusal keeps draft; discard restores persisted selection", async () => {
  respond = async (config) => {
    if (config.method === "put") throw new Error("busy");
    return sessionResponse(config);
  };
  const { root, app } = mount(editor, () => ({ id: "11" }));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    assert.match(textOf(root), /Could not save/);
    assert.equal(all(root, "skill-chip").length, 0);
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-discard")!);
    await nextTick();
    assert.equal(all(root, "skill-chip").length, 1);
    assert.doesNotMatch(textOf(root), /Could not save/);
  } finally { app.unmount(); }
});

test("session id change retires an earlier read; ineligible session has no controls", async () => {
  let resolveOld!: (value: unknown) => void;
  respond = async (config) => {
    if (config.url.includes("/11/bindings")) return new Promise((resolve) => { resolveOld = resolve; });
    if (config.url.endsWith("/bindings")) return { data: { skillIds: [], toolIds: [], editable: false } };
    return sessionResponse(config);
  };
  const id = ref("11");
  const { root, app } = mount(editor, () => ({ id: id.value }));
  try {
    await flush();
    id.value = "12"; await flush();
    resolveOld({ data: { skillIds: [1], toolIds: [2], editable: true } }); await flush();
    assert.equal(all(root, "binding-pickers").length, 0);
    assert.equal(all(root, "skill-chip").length, 0);
  } finally { app.unmount(); }
});

test("session id change retires a pending save", async () => {
  let resolveSave!: (value: unknown) => void;
  respond = async (config) => {
    if (config.method === "put") return new Promise((resolve) => { resolveSave = resolve; });
    if (config.url.includes("/12/bindings")) return { data: { skillIds: [3], toolIds: [], editable: true } };
    return sessionResponse(config);
  };
  const id = ref("11");
  const { root, app } = mount(editor, () => ({ id: id.value }));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    id.value = "12"; await flush();
    resolveSave({ data: { skillIds: [], toolIds: [2], editable: true } }); await flush();
    assert.deepEqual(all(root, "skill-chip-name").map(textOf), ["skill-3"]);
    assert.equal(all(root, "tool-chip").length, 0);
  } finally { app.unmount(); }
});

test("session editor shows 409 and keeps the draft for a later retry", async () => {
  respond = async (config) => {
    if (config.method === "put") throw {
      isAxiosError: true, config, message: "busy",
      response: { status: 409, data: { detail: "conversation_busy" } },
    };
    return sessionResponse(config);
  };
  const { root, app } = mount(editor, () => ({ id: "11" }));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    assert.match(textOf(root), /conversation is busy/);
    assert.equal(all(root, "skill-chip").length, 0);
    assert.equal(all(root, "tool-chip").length, 1);
  } finally { app.unmount(); }
});

test("session editor drops tools covered by the newly selected skill on save", async () => {
  const writes: any[] = [];
  respond = async (config) => {
    if (config.method === "put") {
      writes.push(JSON.parse(config.data));
      return { data: { ...writes.at(-1), editable: true } };
    }
    if (config.url.endsWith("/catalog")) return { data: [{ id: 2, name: "tool-2", skillIds: [3] }] };
    return sessionResponse(config);
  };
  const { root, app } = mount(editor, () => ({ id: "11" }));
  try {
    await flush();
    click(all(root, "skill-toggle")[0]); await nextTick();
    click(all(body, "osheet-row").find((n) => textOf(n).includes("skill-3"))!); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    assert.deepEqual(writes, [{ skillIds: [1, 3], toolIds: [] }]);
    assert.equal(all(root, "tool-chip").length, 0);
  } finally { app.unmount(); }
});

test("session editor disables changing and applying selections during a turn", async () => {
  let writes = 0;
  respond = async (config) => {
    if (config.method === "put") writes++;
    return sessionResponse(config);
  };
  const disabled = ref(false);
  const { root, app } = mount(editor, () => ({ id: "11", disabled: disabled.value }));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    disabled.value = true; await nextTick();
    assert.equal(all(root, "skill-toggle")[0].props.disabled, true);
    assert.equal(all(root, "tool-toggle")[0].props.disabled, true);
    const save = all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!;
    assert.equal(save.props.disabled, true);
    click(save); await flush();
    assert.equal(writes, 0, "handler also guards programmatic submission");
  } finally { app.unmount(); }
});

test("account switch clears old chips and ignores the former account's pending save", async () => {
  let resolveSave!: (value: unknown) => void;
  let switched = false;
  respond = async (config) => {
    if (config.method === "put") return new Promise((resolve) => { resolveSave = resolve; });
    if (switched && config.url.endsWith("/bindings")) return { data: { skillIds: [3], toolIds: [], editable: true } };
    return sessionResponse(config);
  };
  const { root, app } = mount(editor, () => ({ id: "11" }));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    window.dispatchEvent(new CustomEvent("nucleagent:session-change", { detail: { authenticated: false } }));
    await nextTick();
    assert.equal(all(root, "binding-pickers").length, 0);
    switched = true;
    window.dispatchEvent(new CustomEvent("nucleagent:session-change", { detail: { authenticated: true } }));
    await flush();
    resolveSave({ data: { skillIds: [1], toolIds: [2], editable: true } }); await flush();
    assert.deepEqual(all(root, "skill-chip-name").map(textOf), ["skill-3"]);
    assert.equal(all(root, "tool-chip").length, 0);
  } finally { app.unmount(); }
});

// Mount the real page setup/template and editor; only unrelated controls and
// the stream view are probes. Breakpoints use the real useNarrow media listener.
function responsiveEditor(narrow: ReturnType<typeof ref<boolean>>, pending: (value: boolean) => void, id = ref("11")) {
  resize(narrow.value);
  observePending = pending;
  streamMounts = 0;
  streamStops = 0;
  return {
    setup() {
      Vue.watch(narrow, resize, { flush: "sync" });
      return () => h(conversation, { id: id.value });
    },
  };
}

test("INDEPENDENT: breakpoint change must preserve unsaved selection", async () => {
  respond = async (config) => sessionResponse(config);
  const narrow = ref(false);
  const { root, app } = mount(responsiveEditor(narrow, () => {}), () => ({}));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    assert.equal(all(root, "skill-chip").length, 0);
    narrow.value = true; await flush();
    assert.equal(all(root, "skill-chip").length, 0, "breakpoint remount discarded the user's draft");
  } finally { app.unmount(); }
});

for (const change of ["add", "remove", "clear"] as const) {
  test(`SAFETY: real Conversation retains ${change} draft through repeated breakpoints`, async () => {
    let reads = 0;
    respond = async (config) => {
      if (config.url.endsWith("/bindings")) reads++;
      return sessionResponse(config);
    };
    const narrow = ref(false);
    let pending = false;
    const { root, app } = mount(responsiveEditor(narrow, (value) => { pending = value; }), () => ({}));
    try {
      await flush();
      if (change === "add") {
        click(all(root, "skill-toggle")[0]); await nextTick();
        click(all(body, "osheet-row").find((n) => textOf(n).includes("skill-3"))!); await nextTick();
      } else {
        click(all(root, "skill-chip-remove")[0]); await nextTick();
        if (change === "clear") { click(all(root, "tool-chip-remove")[0]); await nextTick(); }
      }
      const skills = all(root, "skill-chip-name").map(textOf);
      const tools = all(root, "tool-chip-name").map(textOf);
      for (let i = 0; i < 6; i++) {
        narrow.value = !narrow.value; await flush();
        assert.deepEqual(all(root, "skill-chip-name").map(textOf), skills);
        assert.deepEqual(all(root, "tool-chip-name").map(textOf), tools);
        assert.equal(all(root, "session-bindings").length, 1);
        assert.equal(pending, true);
        assert.equal(capabilities.stop, true);
      }
      assert.equal(reads, 1, "layout changes must not reload bindings");
      assert.equal(streamMounts, 1);
      assert.equal(streamStops, 0);
    } finally { app.unmount(); }
  });
}

for (const result of ["success", "failure"] as const) {
  test(`SAFETY: real Conversation keeps PUT busy across breakpoints and handles ${result}`, async () => {
    let finish!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    respond = async (config) => config.method === "put"
      ? new Promise((resolve, fail) => { finish = resolve; reject = fail; })
      : sessionResponse(config);
    const narrow = ref(false);
    let pending = false;
    const { root, app } = mount(responsiveEditor(narrow, (value) => { pending = value; }), () => ({}));
    try {
      await flush();
      click(all(root, "skill-chip-remove")[0]); await nextTick();
      click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
      await flush();
      for (let i = 0; i < 4; i++) {
        narrow.value = !narrow.value; await flush();
        assert.equal(pending, true);
        const control = narrow.value ? all(root, "picker-row").find((n) => n.props["data-testid"] === "row-skills")! : all(root, "skill-toggle")[0];
        assert.equal(control.props.disabled, true);
      }
      if (result === "success") finish({ data: { skillIds: [], toolIds: [2], editable: true } });
      else reject(new Error("synthetic failure"));
      await flush();
      assert.equal(all(root, "skill-chip").length, 0);
      assert.equal(pending, result === "failure");
      if (result === "failure") assert.match(textOf(root), /Could not save/);
      assert.equal(streamMounts, 1);
      assert.equal(streamStops, 0);
    } finally { app.unmount(); }
  });
}

for (const scope of ["conversation", "account"] as const) {
  for (const result of ["success", "failure"] as const) {
    test(`SAFETY: ${scope} return waits for retired PUT ${result} then reads final state`, async () => {
      let finish!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      let stored = { skillIds: [1], toolIds: [2], editable: true };
      let reads = 0;
      respond = async (config) => {
        if (config.method === "put") return new Promise((resolve, fail) => { finish = resolve; reject = fail; });
        if (config.url.endsWith("/11/bindings")) { reads++; return { data: stored }; }
        if (config.url.endsWith("/12/bindings")) return { data: { skillIds: [3], toolIds: [], editable: true } };
        return sessionResponse(config);
      };
      const id = ref("11"), narrow = ref(false);
      let pending = false;
      const { root, app } = mount(responsiveEditor(narrow, (value) => { pending = value; }, id), () => ({}));
      try {
        await flush();
        click(all(root, "skill-chip-remove")[0]); await nextTick();
        click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
        await flush();
        if (scope === "conversation") {
          id.value = "12"; await flush();
          assert.deepEqual(all(root, "skill-chip-name").map(textOf), ["skill-3"]);
          id.value = "11";
        } else {
          window.dispatchEvent(new CustomEvent("nucleagent:session-change", { detail: { authenticated: false } }));
          await flush();
          assert.equal(all(root, "skill-chip").length, 0);
          assert.equal(pending, true);
          window.dispatchEvent(new CustomEvent("nucleagent:session-change", { detail: { authenticated: true } }));
        }
        await flush();
        narrow.value = true; await flush();
        assert.equal(pending, true);
        assert.equal(reads, 1, "GET must not race the retired write");
        if (result === "success") {
          stored = { skillIds: [], toolIds: [2], editable: true };
          finish({ data: stored });
        } else reject(new Error("synthetic failure"));
        await flush();
        assert.equal(reads, 2);
        assert.equal(pending, false);
        assert.deepEqual(all(root, "skill-chip-name").map(textOf), result === "success" ? [] : ["skill-1"]);
      } finally { app.unmount(); }
    });
  }
}

test("SAFETY: breakpoint changes during a live turn keep the stream mounted and stop enabled", async () => {
  let writes = 0;
  respond = async (config) => {
    if (config.method === "put") writes++;
    return sessionResponse(config);
  };
  const narrow = ref(false);
  const { root, app } = mount(responsiveEditor(narrow, () => {}), () => ({}));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    liveStatus("running"); await nextTick();
    for (let i = 0; i < 4; i++) {
      narrow.value = !narrow.value; await flush();
      const save = all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!;
      assert.equal(save.props.disabled, true);
      click(save); await flush();
      assert.equal(capabilities.send, false);
      assert.equal(capabilities.stop, true);
    }
    assert.equal(writes, 0);
    assert.equal(streamMounts, 1);
    assert.equal(streamStops, 0);
  } finally { app.unmount(); }
});

test("INDEPENDENT: breakpoint change must not unblock sends while PUT is in flight", async () => {
  let finish!: (value: unknown) => void;
  respond = async (config) => {
    if (config.method === "put") return new Promise((resolve) => { finish = resolve; });
    return sessionResponse(config);
  };
  const narrow = ref(false);
  let pending = false;
  const { root, app } = mount(responsiveEditor(narrow, (value) => { pending = value; }), () => ({}));
  try {
    await flush();
    click(all(root, "skill-chip-remove")[0]); await nextTick();
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-save")!);
    await flush();
    assert.equal(pending, true);
    narrow.value = true; await flush();
    assert.equal(pending, true, "new editor GET clears pending although old editor PUT is unresolved");
  } finally {
    finish({ data: { skillIds: [], toolIds: [2], editable: true } });
    await flush();
    app.unmount();
  }
});
