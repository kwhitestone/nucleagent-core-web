import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { createRenderer, h, nextTick, ref, ssrContextKey, type Component } from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import { createI18n } from "vue-i18n";
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
let unregister: () => void;
let respond: () => Promise<unknown> = async () => ({ code: 0, data: [] });

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  const el = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null, createElement: el, body: el() } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime(platformRuntime);
  http.defaults.adapter = async (config: unknown) => ({ config, data: await respond(), headers: {}, status: 200, statusText: "OK" });
  sheet = await clientComponent("/src/addons/conversation/components/OptionSheet.vue");
  picker = await clientComponent("/src/addons/conversation/components/SkillPicker.vue", { OptionSheet: sheet });
  const win = new EventTarget();
  Object.defineProperty(win, "parent", { value: win });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
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
