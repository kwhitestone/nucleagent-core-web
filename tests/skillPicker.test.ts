import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { createRenderer, h, nextTick, ref, ssrContextKey, type Component } from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import { createI18n } from "vue-i18n";
import { createPinia } from "pinia";
import { routerKey, routeLocationKey } from "vue-router";
import { createServer, transformWithEsbuild, type ViteDevServer } from "vite";
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
    focus() {},
    addEventListener(this: N, event: string, fn: (e: unknown) => void) { this.on[event] = fn; },
    removeEventListener() {},
    querySelector: () => null,
    getRootNode: () => document,
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
  const compiled = await transformWithEsbuild(code, `${path}.ts`, { loader: "ts" });
  return { ...loaded, setup, ssrRender: undefined, render: new Function("Vue", compiled.code)(Vue) };
}

let vite: ViteDevServer;
let sheet: Component;
let picker: Component;
let toolPicker: Component;
let bindingPickers: Component;
let editor: Component;
let conversation: Component;
let home: Component;
let agentSkillPicker: Component;
let agentToolPicker: Component;
let relations: Component;
let createSkill: Component;
let navigations: unknown[] = [];
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
let fixtureRevision = 0;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
  const el = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { activeElement: null, documentElement: {}, createElement: el, body: el() } });
  for (const name of ["Document", "ShadowRoot"]) Object.defineProperty(globalThis, name, { configurable: true, value: class {} });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts");
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime(platformRuntime);
  http.defaults.adapter = async (config: any) => {
    const data: any = await respond(config);
    // Synthetic server contract: filter before counting and paging. Dedicated
    // protocol fixtures can return metadata directly to control response order.
    if (config.params?.page && Array.isArray(data?.data) && data.total === undefined) {
      const p = config.params;
      const ids = p.ids ? String(p.ids).split(",").map(Number) : undefined;
      const rows = data.data.filter((row: any) => (!ids || ids.includes(row.id))
        && (!p.search || JSON.stringify(row).toLowerCase().includes(p.search.toLowerCase()))
        && (!p.group || p.group === "all" || skillSource(row) === p.group));
      Object.assign(data, { total: rows.length, page: p.page, pageSize: p.pageSize,
        hasMore: p.page * p.pageSize < rows.length,
        data: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize) });
    }
    // Old presentation fixtures do not model concurrency; protocol tests below
    // supply their own principal/revision and are never rewritten here.
    if (config.url.includes("/bindings") && data?.data && !data.data.principal) {
      data.data = { ...data.data, principal: "71", revision: String(++fixtureRevision) };
    }
    return { config, data, headers: data?.fixtureHeaders ?? {}, status: 200, statusText: "OK" };
  };
  const pager = await clientComponent("/src/components/CollectionPager.vue");
  agentSkillPicker = await clientComponent("/src/components/agent-edit/SkillPicker.vue", { CollectionPager: pager });
  agentToolPicker = await clientComponent("/src/components/agent-edit/ToolBindings.vue", { CollectionPager: pager });
  relations = await clientComponent("/src/addons/administration/views/admin/ResourceRelations.vue", { CollectionPager: pager });
  createSkill = await clientComponent("/src/addons/administration/views/admin/CreateSkill.vue", { CollectionPager: pager });
  sheet = await clientComponent("/src/addons/conversation/components/OptionSheet.vue", { CollectionPager: pager });
  picker = await clientComponent("/src/addons/conversation/components/SkillPicker.vue", { OptionSheet: sheet, CollectionPager: pager });
  toolPicker = await clientComponent("/src/addons/conversation/components/ToolPicker.vue", { OptionSheet: sheet, CollectionPager: pager });
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
  home = await clientComponent("/src/addons/conversation/views/Home.vue", {
    BindingPickers: bindingPickers, ModelPicker: empty, ExecutionBackendPicker: backend,
    AttachmentPicker: empty, AttachmentChips: empty, BroadcastOptions: empty,
    ChatGenBar: empty, VideoConfirm: empty, SuggestionChip: empty,
  });
});

after(async () => {
  unregister();
  await vite.close();
  for (const key of ["localStorage", "document", "window", "Document", "ShadowRoot"]) Reflect.deleteProperty(globalThis, key);
});

function mount(component: Component, props: () => Record<string, unknown>, locale = "en") {
  body.children = [];
  const root = node("root");
  const app = renderer.createApp({ render: () => h(component, props()) });
  app.use(createI18n({ legacy: false, locale, messages: { en, zh } }));
  app.use(createPinia());
  app.provide(ssrContextKey, {});
  app.provide(routerKey, { replace: async () => {}, push: async (to: unknown) => { navigations.push(to); } } as any);
  app.provide(routeLocationKey, { query: {} } as any);
  app.mount(root);
  return { root, app };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => ({
  value: String(i + 1), label: `Skill ${i + 1}`, note: i === 41 ? "reads tarot cards" : "", keywords: `cat-${i % 3}`,
  group: ["system", "imported", "mine"][i % 3], badges: i % 3 === 1 ? ["Imported"] : undefined,
}));
const groups = [{ value: "system", label: "System" }, { value: "imported", label: "Imported" }, { value: "mine", label: "Mine" }];

const descendants = (n: N, tag: string): N[] => [...(n.tag === tag ? [n] : []), ...n.children.flatMap(c => descendants(c, tag))];
const pageNext = (root: N) => all(root, "collection-pager")[0].children.find(n => n.props["aria-label"] === "Next page")!;
const changeCheck = (n: N, checked: boolean) => (n.props.onChange as Function)({ target: { checked } });

for (const kind of ["skill", "tool", "agent-skill"] as const) {
  test(`REMOTE: ${kind} selected resources use three backend pages`, async () => {
    const requests: any[] = [];
    respond = async config => { requests.push(config.params); return { data: Array.from({length:65}, (_,i) => skill(i+1)) }; };
    const selected = Array.from({length:45}, (_,i) => i+1);
    const { root, app } = mount(kind === "agent-skill" ? agentSkillPicker : kind === "skill" ? picker : toolPicker, () =>
      kind === "agent-skill" ? { skills: [], selected, editable: true } : { modelValue: selected, tools: [] });
    try {
      await flush();
      const chips = () => all(root, kind === "tool" ? "tool-chip" : "skill-chip");
      assert.equal(chips().length, 20);
      click(pageNext(root)); await flush(); click(pageNext(root)); await flush();
      assert.equal(chips().length, 5);
      assert.ok(requests.some(p => p?.ids === selected.join(",") && p.page === 3 && p.pageSize === 20));
      assert.match(textOf(chips()[0]), /skill-41/);
    } finally { app.unmount(); }
  });
}

for (const kind of ["skill", "tool"] as const) {
  test(`REMOTE: existing agent ${kind} selector searches and retains choices across three pages`, async () => {
    const requests: any[] = [];
    respond = async config => { requests.push(config.params); return { data: Array.from({length:65}, (_,i) => skill(i+1)) }; };
    const selected = ref<number[]>([]);
    const { root, app } = mount(kind === "skill" ? agentSkillPicker : agentToolPicker, () => ({
      skills: [], rows: [], selected: selected.value, editable: true, coveredLabel: "Covered", unavailableLabel: "Unavailable",
      onToggle: (id: number, checked: boolean) => { selected.value = checked ? [...selected.value,id] : selected.value.filter(v=>v!==id); },
    }));
    try {
      await flush();
      if (kind === "skill") { click(all(root,"add-skill")[0]); await flush(); }
      const choices = () => kind === "skill" ? all(root,"skill-option") : descendants(all(root,"tool-bindings")[0],"label");
      changeCheck(descendants(choices()[0],"input")[0],true); await flush();
      click(pageNext(root)); await flush(); click(pageNext(root)); await flush();
      changeCheck(descendants(choices()[0],"input")[0],true); await flush();
      assert.deepEqual(selected.value,[1,41]);
      assert.ok(requests.some(p=>p?.page===3 && p.pageSize===20));
      const input = descendants(root,"input").find(n=>n.props.type==="search")!;
      input.value="skill-6"; input.on.input({target:input}); await sleep(240); await flush();
      assert.equal(choices().length,7);
      assert.ok(requests.some(p=>p?.page===1 && p.search==="skill-6"));
      assert.deepEqual(selected.value,[1,41]);
    } finally { app.unmount(); }
  });
}

test("REMOTE: inline relation delta preserves cross-page selection and retains failed saves", async () => {
  let writes = 0;
  const bodies: any[] = [];
  const versions: string[] = [];
  respond = async config => {
    if (config.method === "patch") {
      writes++; bodies.push(JSON.parse(config.data));
      versions.push(config.headers["If-Match"]);
      if (writes === 1) throw new Error("synthetic failure");
      return { data: {}, fixtureHeaders: { etag: '"skill-1-3"' } };
    }
    return { data: Array.from({length:65}, (_,i) => ({...skill(i+1), revision:"2"})) };
  };
  const { root, app } = mount(relations, () => ({ kind:"skill", id:1, revision:"1" }));
  try {
    await flush();
    changeCheck(descendants(root,"input").find(n=>n.props.type==="checkbox")!,false); await flush();
    click(pageNext(root)); await flush(); click(pageNext(root)); await flush();
    changeCheck(descendants(root,"input").find(n=>n.props.type==="checkbox")!,false); await flush();
    const save = () => descendants(root,"button").find(n=>n.props["aria-label"]==="Save")!;
    click(save()); await flush();
    assert.match(textOf(root),/Selections retained/);
    click(descendants(root,"button").find(n=>n.props["aria-label"]==="Reload")!); await flush();
    assert.match(textOf(root),/Pending 2/);
    click(save()); await flush();
    assert.deepEqual(bodies,[{add:[],remove:[1,41]},{add:[],remove:[1,41]}]);
    assert.match(textOf(root),/Pending 0/);
    changeCheck(descendants(root,"input").find(n=>n.props.type==="checkbox")!,false); await flush();
    click(save()); await flush();
    assert.deepEqual(versions,['"skill-1-1"','"skill-1-2"','"skill-1-3"']);
    changeCheck(descendants(root,"input").find(n=>n.props.type==="checkbox")!,false); await flush();
    click(descendants(root,"button").find(n=>n.props["aria-label"]==="Discard changes")!); await flush();
    assert.match(textOf(root),/Pending 0/);
    assert.equal(writes,3,"discard never writes the draft");
  } finally { app.unmount(); }
});

test("REMOTE: skill creation retains created id and off-page picks when binding fails", async () => {
  let creates=0, binds=0;
  respond = async config => {
    if (config.method==="post") { creates++; return {data:{...skill(99),revision:"1"}}; }
    if (config.method==="patch") {
      binds++; assert.deepEqual(JSON.parse(config.data),{add:[1,41],remove:[]});
      if (binds===1) throw new Error("synthetic binding failure");
      return {data:{}};
    }
    return {data:Array.from({length:65},(_,i)=>skill(i+1))};
  };
  let saved=0;
  const {root,app}=mount(createSkill,()=>({onCreated:()=>saved++}));
  try {
    await flush();
    const picks=()=>all(root,"check").filter(n=>descendants(n,"input")[0]?.props["onChange"]);
    changeCheck(descendants(picks()[0],"input")[0],true); await flush();
    click(pageNext(root)); await flush(); click(pageNext(root)); await flush();
    changeCheck(descendants(picks()[0],"input")[0],true); await flush();
    const submit=()=> (descendants(root,"form")[0].props.onSubmit as Function)({preventDefault(){}});
    await submit(); await flush(); assert.match(textOf(root),/Skill created; binding failed/);
    await submit(); await flush(); assert.equal(creates,1); assert.equal(binds,2); assert.equal(saved,1);
  } finally { app.unmount(); }
});

for (const kind of ["skill", "tool"] as const) {
  test(`REMOTE: ${kind} picker pages/searches on server and retains off-page selection`, async () => {
    const requests: any[] = [];
    respond = async config => {
      requests.push(config.params);
      return { data: Array.from({ length: 65 }, (_, i) => skill(i + 1)) };
    };
    const selected = ref<number[]>([64]);
    const { root, app } = mount(kind === "skill" ? picker : toolPicker, () => ({
      modelValue: selected.value, ...(kind === "tool" ? { tools: [] } : {}), "onUpdate:modelValue": (ids: number[]) => { selected.value = ids; },
    }));
    try {
      await flush();
      assert.ok(requests.some(p => p?.page === 1 && p.pageSize === 20));
      assert.ok(requests.some(p => p?.ids === "64"), "off-page labels require bounded ID hydration");
      assert.match(textOf(all(root, `${kind}-chip-name`)[0]), /skill-64/);
      click(all(root, `${kind}-toggle`)[0]); await flush();
      assert.equal(all(body, "osheet-row").length, 20);
      click(all(body, "osheet-row")[0]); await flush();
      const next = () => all(body, "collection-pager")[0].children.find(n => n.props["aria-label"] === "Next page")!;
      click(next()); await flush();
      assert.ok(requests.some(p => p?.page === 2));
      click(next()); await flush();
      click(all(body, "osheet-row")[0]); await flush();
      assert.deepEqual(selected.value, [64, 1, 41]);
      const input = all(body, "osheet-search")[0];
      input.value = "skill-6"; input.on.input({ target: input });
      await sleep(240); await flush();
      assert.ok(requests.some(p => p?.search === "skill-6" && p.page === 1));
      assert.deepEqual(selected.value, [64, 1, 41]);
      assert.equal(all(body, "osheet-row").length, 7);
    } finally { app.unmount(); }
  });
}

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
    assert.deepEqual(all(body, "osheet-tab").map(n => textOf(n).trim()), ["全部", "已选 3", "系统", "导入", "我的"]);
    assert.equal(all(body, "osheet-row").length, 20);
    assert.equal(textOf(all(all(body, "osheet-row")[0], "osheet-badge")[0]), "导入");
    assert.equal(all(body, "osheet-search")[0].props.placeholder, "搜索技能名称、描述、分类");

    click(all(chips[2], "skill-chip-remove")[0]);
    assert.deepEqual(model.value, [3, 900]);
    await flush();
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
      for (let i = 0; i < 2; i++) {
        click(all(body, "collection-pager")[0].children.find(n => n.props["aria-label"] === "Next page")!);
        await flush();
      }
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
  : config.url.endsWith("/bindings/sync")
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
    assert.deepEqual(writes.map(({ revision, ...selection }) => selection), [{ skillIds: [], toolIds: [] }]);
    assert.match(writes[0].revision, /^[0-9]+$/);
    assert.equal(pending.at(-1), false);
    assert.equal(all(root, "skill-chip").length + all(root, "tool-chip").length, 0);
  } finally { app.unmount(); }
});

test("session unknown save keeps draft blocked; explicit sync restores persisted selection", async () => {
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
    assert.match(textOf(root), /Save outcome unknown/);
    assert.equal(all(root, "skill-chip").length, 0);
    click(all(root, "conversation-settings-actions")[0].children.find((n) => n.props["data-testid"] === "bindings-sync")!);
    await flush();
    assert.equal(all(root, "skill-chip").length, 1);
    assert.doesNotMatch(textOf(root), /Save outcome unknown/);
  } finally { app.unmount(); }
});

test("session id change retires an earlier read; ineligible session has no controls", async () => {
  let resolveOld!: (value: unknown) => void;
  respond = async (config) => {
    if (config.url.includes("/11/bindings")) return new Promise((resolve) => { resolveOld = resolve; });
    if (config.url.endsWith("/bindings/sync")) return { data: { skillIds: [], toolIds: [], editable: false } };
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
    assert.deepEqual(writes.map(({ revision, ...selection }) => selection), [{ skillIds: [1, 3], toolIds: [] }]);
    assert.match(writes[0].revision, /^[0-9]+$/);
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
    assert.equal(all(root, "skill-chip").length, 0, "busy must retain the removed-skill draft");
    assert.equal(all(root, "tool-chip").length, 1);
    disabled.value = false; await nextTick();
    assert.equal(bindingAction(root, "save").props.disabled, false);
    click(bindingAction(root, "discard")); await flush();
    assert.deepEqual(all(root, "skill-chip-name").map(textOf), ["skill-1"]);
    assert.equal(writes, 0, "discard restores saved selection without a write");
  } finally { app.unmount(); }
});

test("account switch clears old chips and ignores the former account's pending save", async () => {
  let resolveSave!: (value: unknown) => void;
  let switched = false;
  respond = async (config) => {
    if (config.method === "put") return new Promise((resolve) => { resolveSave = resolve; });
    if (switched && config.url.endsWith("/bindings/sync")) return { data: { skillIds: [3], toolIds: [], editable: true } };
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
      if (config.url.endsWith("/bindings/sync")) reads++;
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
      await flush();
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
      if (result === "failure") assert.match(textOf(root), /Save outcome unknown/);
      assert.equal(streamMounts, 1);
      assert.equal(streamStops, 0);
    } finally { app.unmount(); }
  });
}

for (const scope of ["conversation", "account"] as const) {
  for (const result of ["success", "failure"] as const) {
    test(`SAFETY: ${scope} return fences retired PUT before its ${result} transport settles`, async () => {
      let finish!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      let stored = { skillIds: [1], toolIds: [2], editable: true };
      let reads = 0;
      respond = async (config) => {
        if (config.method === "put") return new Promise((resolve, fail) => { finish = resolve; reject = fail; });
        if (config.url.endsWith("/11/bindings/sync")) { reads++; return { data: stored }; }
        if (config.url.endsWith("/12/bindings/sync")) return { data: { skillIds: [3], toolIds: [], editable: true } };
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
        assert.equal(pending, false);
        assert.equal(reads, 2, "return must complete a new sync fence, not wait for transport");
        if (result === "success") {
          finish({ data: { skillIds: [], toolIds: [2], editable: true } });
        } else reject(new Error("synthetic failure"));
        await flush();
        assert.equal(reads, 2);
        assert.equal(pending, false);
        assert.deepEqual(all(root, "skill-chip-name").map(textOf), ["skill-1"], "retired response cannot replace the fenced snapshot");
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
      assert.ok(save, "the live turn must not discard the binding draft on resize");
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

function bindingAction(root: N, name: string): N {
  const action = all(root, "conversation-settings-actions").flatMap((n) => n.children)
    .find((n) => n.props["data-testid"] === `bindings-${name}`);
  assert.ok(action, `missing ${name} control`);
  return action;
}

let principalCounter = 1000;

for (const narrow of [false, true]) {
  for (const clear of [false, true]) {
    test(`INTEGRATE: actual Home create projects skills/tools; narrow=${narrow} clear=${clear}`, async () => {
      const writes: any[] = [];
      navigations = [];
      respond = async (config) => {
        if (config.method === "post") {
          assert.equal(config.url, "/api/v1/addons/conversation");
          writes.push(JSON.parse(config.data));
          return { data: { id: 9001, status: "completed", mode: "a2a_agent" } };
        }
        if (config.url.endsWith("/catalog")) return { data: [
          { id: 2, name: "tool-2", skillIds: [3] }, { id: 4, name: "manual-4" },
        ] };
        if (config.url.endsWith("/skill")) return { data: [skill(1), skill(3)] };
        return { data: [] };
      };
      resize(false);
      const { root, app } = mount(home, () => ({}));
      try {
        await flush();
        click(all(root, "tool-toggle")[0]); await nextTick();
        for (const name of ["tool-2", "manual-4"]) {
          const row = all(body, "osheet-row").find((n) => textOf(n).includes(name));
          assert.ok(row, name); click(row); await nextTick();
        }
        click(all(root, "tool-toggle")[0]); await nextTick();
        click(all(root, "skill-toggle")[0]); await nextTick();
        const row = all(body, "osheet-row").find((n) => textOf(n).includes("skill-3"));
        assert.ok(row); click(row); await nextTick();
        click(all(root, "skill-toggle")[0]); await nextTick();
        assert.equal(writes.length, 0, "selection alone cannot create or execute a turn");
        if (clear) {
          await flush();
          click(all(root, "skill-chip-remove")[0]); await flush();
          while (all(root, "tool-chip-remove").length) {
            click(all(root, "tool-chip-remove")[0]); await flush();
          }
        }
        resize(narrow); await flush();
        const textarea = narrow ? all(root, "desk-input")[0] : all(root, "home-composer")[0].children.find((n) => n.tag === "textarea");
        assert.ok(textarea);
        textarea.value = "synthetic offline prompt";
        textarea.on.input({ target: textarea }); await nextTick();
        const send = all(root, narrow ? "desk-send" : "send")[0];
        assert.equal(send.props.disabled, false);
        click(send); await flush();
        assert.equal(writes.length, 1);
        assert.deepEqual(writes[0].skillIds, clear ? undefined : [3]);
        assert.deepEqual(writes[0].toolIds, clear ? undefined : [4]);
        assert.deepEqual(navigations, [{ path: "/c/9001" }]);
      } finally { app.unmount(); resize(false); }
    });
  }
}

function protocolFixture() {
  const principal = String(++principalCounter);
  let revision = 0;
  let selected = { skillIds: [1], toolIds: [2] };
  const snapshot = () => ({ data: { ...structuredClone(selected), editable: true, principal, revision: String(revision) } });
  return {
    snapshot,
    sync() { revision++; return snapshot(); },
    commit(payload: any) {
      if (payload.revision !== String(revision)) throw new Error("bindings_revision_conflict");
      revision++;
      selected = { skillIds: [...payload.skillIds], toolIds: [...payload.toolIds] };
      return snapshot();
    },
  };
}

async function realAuth() {
  const previousWindow = window;
  const win = new EventTarget();
  Object.defineProperty(win, "parent", { value: {} });
  Object.defineProperty(win, "matchMedia", { value: () => media });
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  const auth = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedSession.ts");
  const { authenticatedView } = await vite.ssrLoadModule("/src/addons/platform-api/session/authenticatedView.ts");
  let version = auth.sessionVersion();
  const change = (account: string | null) => auth.applyShellSession(account, ++version, [],
    account ? { id: account === "synthetic-account-a" ? "41" : "42" } : undefined);
  change("synthetic-account-a");
  resize(false);
  observePending = () => {};
  streamMounts = 0;
  streamStops = 0;
  const mounted = mount(authenticatedView(conversation), () => ({ id: "11" }));
  return {
    ...mounted, change,
    pending() {
      const previousVersion = version;
      auth.applyShellSession(null, ++version, [], null, { previousVersion });
    },
    resume(account: string) {
      auth.applyShellSession(account, version, [], { id: account === "synthetic-account-a" ? "41" : "42" });
    },
    close() {
      mounted.app.unmount();
      change(null);
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    },
  };
}

for (const resumeAs of ["synthetic-account-a", "synthetic-account-b"]) {
  test(`INTEGRATE: pending revalidation unmounts chat and fences held PUT; resume=${resumeAs}`, async () => {
    const a = protocolFixture(), b = protocolFixture();
    let current = a, stale = false, writes = 0;
    let finish!: (value: unknown) => void;
    let payload: any;
    respond = async (config) => {
      if (config.method === "put") {
        writes++;
        payload = JSON.parse(config.data);
        return new Promise((resolve) => { finish = resolve; });
      }
      if (config.url.endsWith("/bindings/sync")) return stale ? current.snapshot() : current.sync();
      return sessionResponse(config);
    };
    const auth = await realAuth();
    try {
      await flush();
      click(all(auth.root, "skill-chip-remove")[0]); await nextTick();
      const savedControl = bindingAction(auth.root, "save");
      click(savedControl); await flush();
      assert.equal(writes, 1);
      auth.pending(); await flush();
      assert.equal(streamStops, 1, "chat is not a suspension-allowlisted editor");
      assert.equal(all(auth.root, "session-bindings").length, 0);
      assert.equal(all(body, "osheet-row").length, 0, "protected teleports must be gone");
      stale = true;
      current = resumeAs === "synthetic-account-a" ? a : b;
      auth.resume(resumeAs); await flush();
      assert.equal(streamMounts, 2);
      if (current === a) {
        assert.equal(capabilities.send, false, "same revision cannot clear the unknown-write fence");
        assert.equal(all(auth.root, "binding-pickers").length, 0);
        finish({ data: { ...payload, editable: true, principal: a.snapshot().data.principal, revision: "2" } });
        await flush();
        assert.equal(capabilities.send, false, "a retired PUT cannot recover the new component");
        stale = false;
        const retry = all(auth.root, "conversation-settings-actions").flatMap(n => n.children).find(n => n.tag === "button");
        assert.ok(retry); click(retry); await flush();
      } else {
        assert.equal(capabilities.send, true, "another principal has an independent revision fence");
        finish({ data: { ...payload, editable: true, principal: a.snapshot().data.principal, revision: "2" } });
        await flush();
      }
      assert.equal(capabilities.send, true);
      assert.deepEqual(all(auth.root, "skill-chip-name").map(textOf), ["skill-1"]);
      assert.equal(writes, 1);
    } finally {
      finish?.({ data: { ...payload, editable: true, principal: a.snapshot().data.principal, revision: "2" } });
      auth.close();
    }
  });
}

for (const abort of [false, true]) {
  test(`CONCURRENCY R1: actual auth remount fences unresolved PUT; transport abort=${abort}`, async () => {
    const server = protocolFixture();
    let syncs = 0, writes = 0;
    let oldPayload: any;
    let releaseSync!: () => void;
    let finish!: (value: unknown) => void;
    respond = async (config) => {
      if (config.method === "put") {
        writes++;
        oldPayload = JSON.parse(config.data);
        return new Promise((resolve, reject) => {
          finish = resolve;
          if (abort) config.signal.addEventListener("abort", () => reject({ __CANCEL__: true }), { once: true });
        });
      }
      if (config.url.endsWith("/bindings/sync")) {
        syncs++;
        if (syncs > 1) await new Promise<void>((resolve) => { releaseSync = resolve; });
        return server.sync();
      }
      assert.ok(!config.url.endsWith("/bindings"), "plain GET cannot establish an outcome");
      return sessionResponse(config);
    };
    const auth = await realAuth();
    try {
      await flush();
      click(all(auth.root, "skill-chip-remove")[0]); await nextTick();
      const save = bindingAction(auth.root, "save");
      click(save); click(save); await flush();
      assert.equal(writes, 1);
      auth.change(null); await flush();
      assert.equal(all(auth.root, "conv-head").length, 0);
      assert.equal(all(auth.root, "skill-chip").length + all(auth.root, "tool-chip").length, 0);
      assert.equal(streamStops, 1, "old protected Conversation really unmounted");
      auth.change("synthetic-account-a"); await flush();
      assert.equal(streamMounts, 2);
      assert.equal(syncs, 2);
      assert.equal(capabilities.send, false, "new page must await the fence");
      assert.equal(all(auth.root, "skill-chip").length, 0);
      releaseSync(); await flush();
      assert.equal(capabilities.send, true, "a confirmed fence recovers without the old transport");
      assert.throws(() => server.commit(oldPayload), /revision_conflict/);
      finish({ data: { ...oldPayload, principal: server.snapshot().data.principal, editable: true } });
      await flush();
      assert.deepEqual(all(auth.root, "skill-chip-name").map(textOf), ["skill-1"]);
      assert.equal(capabilities.send, true);
    } finally { auth.close(); }
  });
}

for (const failure of ["timeout", "abort", "never-settle"] as const) {
  test(`CONCURRENCY R2: ${failure} has bounded recovery and fences late first before second save`, async (t) => {
    const server = protocolFixture();
    let writes = 0, failSync = false;
    let oldPayload: any, fail!: () => void;
    respond = async (config) => {
      if (config.method === "put") {
        writes++;
        const payload = JSON.parse(config.data);
        if (writes === 1) {
          oldPayload = payload;
          return new Promise((_resolve, reject) => {
            fail = () => reject(failure === "abort" ? { __CANCEL__: true } : {
              isAxiosError: true, config, code: "ECONNABORTED", message: "synthetic timeout",
            });
          });
        }
        return server.commit(payload);
      }
      if (config.url.endsWith("/bindings/sync")) {
        if (failSync) throw new Error("synthetic unavailable");
        return server.sync();
      }
      return sessionResponse(config);
    };
    const auth = await realAuth();
    try {
      await flush();
      t.mock.timers.enable({ apis: ["setTimeout"] });
      click(all(auth.root, "skill-chip-remove")[0]); await nextTick();
      const save = bindingAction(auth.root, "save");
      click(save); await flush();
      if (failure === "never-settle") t.mock.timers.tick(15001);
      else fail();
      await flush();
      assert.equal(capabilities.send, false);
      assert.match(textOf(auth.root), /Save outcome unknown/);
      click(save); await flush();
      assert.equal(writes, 1, "unknown outcome cannot issue another write");
      assert.equal(all(auth.root, "conversation-settings-actions").flatMap((n) => n.children)
        .some((n) => n.props["data-testid"] === "bindings-discard"), false);
      failSync = true;
      click(bindingAction(auth.root, "sync")); await flush();
      assert.equal(capabilities.send, false, "failed sync retains barrier");
      const retry = all(auth.root, "conversation-settings-actions").flatMap((n) => n.children).find((n) => n.tag === "button");
      assert.ok(retry, "failed synchronization is retryable");
      failSync = false;
      click(retry); await flush();
      assert.equal(capabilities.send, true);
      click(all(auth.root, "skill-chip-remove")[0]);
      click(all(auth.root, "tool-chip-remove")[0]); await nextTick();
      click(bindingAction(auth.root, "save")); await flush();
      assert.equal(writes, 2);
      assert.equal(capabilities.send, true);
      assert.throws(() => server.commit(oldPayload), /revision_conflict/);
      assert.deepEqual(server.snapshot().data.toolIds, []);
      assert.equal(all(auth.root, "tool-chip").length, 0);
    } finally { auth.close(); t.mock.timers.reset(); }
  });
}

test("CONCURRENCY R1: real auth scopes isolate accounts and reject stale readback", async () => {
  const a = protocolFixture(), b = protocolFixture();
  let current = a, syncs = 0, pendingA: any;
  let finishRead!: (value: unknown) => void;
  let delay = false;
  respond = async (config) => {
    if (config.method === "put") {
      pendingA = JSON.parse(config.data);
      return new Promise(() => {});
    }
    if (config.url.endsWith("/bindings/sync")) {
      syncs++;
      if (delay) return new Promise((resolve) => { finishRead = resolve; });
      return current.sync();
    }
    return sessionResponse(config);
  };
  const auth = await realAuth();
  try {
    await flush();
    click(all(auth.root, "skill-chip-remove")[0]); await nextTick();
    click(bindingAction(auth.root, "save")); await flush();
    auth.change(null); await flush();
    current = b;
    auth.change("synthetic-account-b"); await flush();
    assert.equal(syncs, 2);
    assert.equal(capabilities.send, true, "B revision 1 is independent of A's unresolved revision 1");
    delay = true;
    auth.change(null); await flush();
    auth.change("synthetic-account-b-refreshed"); await flush();
    assert.equal(capabilities.send, false);
    current = a; delay = false;
    auth.change("synthetic-account-a"); await flush();
    assert.equal(capabilities.send, true);
    assert.throws(() => a.commit(pendingA), /revision_conflict/);
    finishRead(b.sync()); await flush();
    click(all(auth.root, "skill-chip-remove")[0]); await nextTick();
    click(bindingAction(auth.root, "save")); await flush();
    assert.equal(pendingA.revision, a.snapshot().data.revision, "B's stale response did not replace A's scope");
  } finally { auth.close(); }
});
