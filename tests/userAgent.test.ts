import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { createRenderer, createSSRApp, h, ssrContextKey, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
let vite: ViteDevServer;
let ua: any;
let zh: any;
let en: any;
let unregister: () => void;
const calls: { method: string; url: string; body?: unknown }[] = [];
let reply: (method: string, url: string, body?: unknown) => unknown = () => ({ data: { data: null } });

class Err extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const fakeHttp = Object.fromEntries(["get", "post", "patch", "delete"].map((m) => [m, async (url: string, body?: unknown) => {
  calls.push({ method: m, url, body });
  const r = reply(m, url, body);
  if (r instanceof Error) throw r;
  return r;
}]));

before(async () => {
  vite = await createServer({
    configFile: false, envFile: false, plugins: [vue()],
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: fakeHttp, isInShell: () => false, useEmbeddedAuthorization: () => ({ permissions: { value: [] }, can: () => false }),
  } as any);
  ua = await vite.ssrLoadModule("/src/addons/conversation/api/userAgent.ts");
  zh = (await vite.ssrLoadModule("/src/i18n/zh.ts")).default;
  en = (await vite.ssrLoadModule("/src/i18n/en.ts")).default;
});
after(async () => { unregister?.(); await vite.close(); });

async function render(comp: Component, props: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(comp, props) });
  app.use(createI18n({ legacy: false, locale: "zh", missingWarn: false, fallbackWarn: false, messages: { zh } }));
  app.component("RouterLink", { props: ["to"], setup: (_p: unknown, { slots }: any) => () => h("a", slots.default?.()) });
  return renderToString(app);
}

describe("API contract (core main definitions.go)", () => {
  test("create/update/active/delete hit /mine/definitions with only whitelisted fields", async () => {
    calls.length = 0;
    reply = () => ({ data: { data: { id: 7, name: "周报", isActive: false, config: {} } } });
    const def = await ua.createUserAgent({ name: " 周报 ", description: "d", model: "m1", prompt: "p" });
    assert.equal(def.id, 7);
    await ua.updateUserAgent(7, { name: "x" });
    await ua.setUserAgentActive(7, false);
    await ua.deleteUserAgent(7);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
      "post /api/v1/addons/agent/mine/definitions", "patch /api/v1/addons/agent/mine/definitions/7",
      "patch /api/v1/addons/agent/mine/definitions/7", "delete /api/v1/addons/agent/mine/definitions/7"]);
    assert.deepEqual(calls[0].body, { name: "周报", description: "d", model: "m1", prompt: "p" });
    assert.deepEqual(calls[2].body, { isActive: false });
  });

  test("older core: list 404/405 → null (entry hidden); models 404 → [] ; other errors propagate", async () => {
    for (const status of [404, 405, 422]) { // 422: older core routes GET /mine/definitions to /mine/{templateId}
      reply = () => new Err(status, "Not Found");
      assert.equal(await ua.listMyDefinitions(), null);
      assert.deepEqual(await ua.listUserAgentModels(), []);
    }
    reply = () => new Err(500, "boom");
    await assert.rejects(ua.listMyDefinitions(), /boom/);
    reply = () => ({ data: { data: [{ id: 1, name: "a", isActive: true }] } });
    assert.deepEqual((await ua.listMyDefinitions()).map((d: any) => d.id), [1]);
    reply = () => ({ data: { data: [{ model: "m1" }, { model: "m2", providerId: 3 }, {}] } });
    assert.deepEqual(await ua.listUserAgentModels(), ["m1", "m2"]);
  });

  test("error mapping: quota, daily, 404, per-field 422/409, else server text verbatim", () => {
    assert.deepEqual(ua.userAgentError(new Err(409, "user_agent_quota_exceeded")), { key: "agents.mine.errQuota" });
    assert.deepEqual(ua.userAgentError(new Err(429, "user_agent_daily_limit")), { key: "agents.mine.errDaily" });
    assert.deepEqual(ua.userAgentError(new Err(404, "agent not found")), { key: "agents.mine.errNotFound" });
    assert.deepEqual(ua.userAgentError(new Err(409, "agent_name_taken")), { field: "name", key: "agents.mine.errNameTaken" });
    assert.deepEqual(ua.userAgentError(new Err(422, "name is required")), { field: "name", key: "agents.mine.errNameRequired" });
    assert.deepEqual(ua.userAgentError(new Err(422, "invalid prompt")), { field: "prompt", key: "agents.mine.errTooLong" });
    assert.deepEqual(ua.userAgentError(new Err(422, "model_not_open_to_users")), { field: "model", key: "agents.mine.errModelClosed" });
    assert.deepEqual(ua.userAgentError(new Err(422, "an active agent requires a model")), { field: "model", key: "agents.mine.errModelRequired" });
    assert.deepEqual(ua.userAgentError(new Err(429, "slow down")), { text: "slow down" });
    assert.deepEqual(ua.userAgentError(new Err(500, "<script>x</script>")), { text: "<script>x</script>" });
    assert.equal(zh.agents.mine.errQuota, "你已创建 5 个智能体，请先删除一个");
    assert.equal(zh.agents.mine.errNotFound, "智能体不存在");
  });

  test("client validation mirrors server limits (runes, trimmed); edit sends only changed fields", () => {
    assert.deepEqual(ua.validateDraft({ name: "  ", description: "", model: "", prompt: "" }, true), { name: "agents.mine.errNameRequired", model: "agents.mine.errModelRequired" });
    assert.deepEqual(ua.validateDraft({ name: "😀".repeat(32), description: "a".repeat(80), model: "m", prompt: "p".repeat(4000) }, true), {});
    assert.deepEqual(Object.keys(ua.validateDraft({ name: "a".repeat(33), description: "a".repeat(81), model: "m", prompt: "p".repeat(4001) }, true)).sort(), ["description", "name", "prompt"]);
    assert.deepEqual(ua.validateDraft({ name: "a", description: "", model: "", prompt: "" }, false), {}, "edit may keep the current model");
    const base = { name: "a", description: "b", model: "m", prompt: "" };
    assert.deepEqual(ua.draftPatch(base, { ...base, name: " c ", prompt: "" }), { name: "c" }, "blank prompt in edit = unchanged");
    assert.deepEqual(ua.draftPatch(base, { ...base, prompt: "new" }), { prompt: "new" });
  });

  test("entry state: hidden on older core, full at 5, noModels when whitelist empty, else ok", () => {
    const defs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `a${i}`, isActive: true }));
    assert.equal(ua.entryState(null, ["m"]), "hidden");
    assert.equal(ua.entryState(defs(5), ["m"]), "full");
    assert.equal(ua.entryState(defs(4), []), "noModels");
    assert.equal(ua.entryState(defs(4), ["m"]), "ok");
    assert.equal(ua.entryState([], ["m"]), "ok");
  });

  test("single flight: a second submit while the first is running sends nothing", async () => {
    let n = 0;
    let release!: () => void;
    const run = ua.singleFlight(() => { n++; return new Promise<void>((r) => { release = r; }); });
    const a = run();
    assert.equal(await run(), undefined);
    release(); await a;
    assert.equal(n, 1);
    const b = run(); release(); await b;
    assert.equal(n, 2, "free again after it settles");
  });

  test("own definitions missing from /mine (disabled, never used) are merged in; ownership is by definition id", () => {
    const mine = [{ templateId: 1, name: "sys", slug: "s", description: "", disabled: false, instanceId: null, sessionCount: 0, lastSessionAt: null },
      { templateId: 9, name: "mine", slug: "u-x", description: "", disabled: false, instanceId: 2, sessionCount: 1, lastSessionAt: null }];
    const merged = ua.mergeOwned(mine, [{ id: 9, name: "mine", isActive: true }, { id: 10, name: "off", isActive: false, config: { description: "d", model: "m" } }]);
    assert.deepEqual(merged.map((a: any) => [a.templateId, a.disabled]), [[1, false], [9, false], [10, true]]);
    assert.equal(merged[2].description, "d");
    assert.deepEqual(ua.mergeOwned(mine, null), mine);
  });
});

describe("wizard", () => {
  let Wizard: any;
  before(async () => { Wizard = (await vite.ssrLoadModule("/src/addons/conversation/components/UserAgentWizard.vue")).default; });
  const props = { models: ["m1", "m2"], busy: false, errors: {} };

  test("labelled controls, model whitelist options, counters, default avatar, no skills", async () => {
    const html = await render(Wizard, props);
    for (const id of ["ua-name", "ua-desc", "ua-model", "ua-prompt"]) {
      assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /<option value="m1">m1<\/option>/);
    assert.match(html, /0\/4000/);
    assert.match(html, /data-testid="ua-avatar-default"/);
    assert.doesNotMatch(html, /skill/i);
    assert.match(html, /创建并启用/);
  });

  test("busy disables submit (loading); edit mode prefills and says save", async () => {
    assert.match(await render(Wizard, { ...props, busy: true }), /<button[^>]*type="submit"[^>]*disabled/);
    const html = await render(Wizard, { ...props, initial: { id: 3, name: "周报", description: "d", model: "m2", prompt: "" } });
    assert.match(html, /value="周报"/);
    assert.match(html, /保存/);
  });

  test("server error text with <script> is escaped, never rendered as HTML", async () => {
    const html = await render(Wizard, { ...props, errors: { form: "<script>alert(1)</script>", name: "<b>x</b>" } });
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
    assert.ok(!html.includes("<script>alert(1)"));
    assert.doesNotMatch(src("addons/conversation/components/UserAgentWizard.vue"), /v-html/);
    assert.doesNotMatch(src("addons/conversation/views/AgentList.vue"), /v-html/);
    assert.doesNotMatch(src("addons/conversation/components/AgentCard.vue"), /v-html/);
  });
});

describe("card actions", () => {
  let Card: any;
  before(async () => { Card = (await vite.ssrLoadModule("/src/addons/conversation/components/AgentCard.vue")).default; });
  const agent = { templateId: 9, name: "mine", slug: "u-x", description: "", disabled: false, instanceId: null, sessionCount: 0, lastSessionAt: null };

  test("own card: badge + edit/disable/delete; others' and system cards: none", async () => {
    const own = await render(Card, { agent, admin: false, hasModelField: true, delay: 0, owned: true });
    assert.match(own, /data-testid="agent-badge-owned"/);
    for (const a of ["edit", "toggle", "delete"]) assert.match(own, new RegExp(`data-testid="agent-own-${a}"`));
    assert.match(own, /停用/);
    assert.match(await render(Card, { agent: { ...agent, disabled: true }, admin: false, hasModelField: true, delay: 0, owned: true }), /启用/);
    for (const owned of [false, undefined]) {
      const html = await render(Card, { agent, admin: false, hasModelField: true, delay: 0, owned });
      assert.doesNotMatch(html, /agent-own-|agent-badge-owned/);
    }
  });
});

describe("list wiring", () => {
  const list = src("addons/conversation/views/AgentList.vue");
  test("entry shows used N/5, disabled when full, noModels hint on click, hidden on older core", () => {
    assert.match(list, /data-testid="agent-create"/);
    assert.match(list, /entry !== 'hidden'/);
    assert.match(list, /:disabled="entry === 'full'"/);
    assert.match(list, /agents\.mine\.used/);
    assert.match(list, /agents\.mine\.noModels/);
  });
  test("delete asks for confirmation first; ownership comes from definition ids", () => {
    assert.match(list, /confirm\(t\("agents\.mine\.confirmDelete"/);
    assert.match(list, /:owned="ownedIds\.has\(a\.templateId\)"/);
  });
  test("zh/en keys in agents.mine match", () => {
    assert.deepEqual(Object.keys(zh.agents.mine).sort(), Object.keys(en.agents.mine).sort());
  });
});

// UA-TESTFIX-1 (REVIEW-UA F1/F4–F9): drive the real AgentList / wizard setup (only rendering is replaced, no DOM).
describe("list behaviour (mounted setup)", () => {
  const renderer = createRenderer<object, object>({
    patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {},
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    parentNode: () => null, nextSibling: () => null,
  });
  const toasts: string[] = [];
  let List: Component;
  let Wizard: Component;
  before(async () => {
    List = { ...(await vite.ssrLoadModule("/src/addons/conversation/views/AgentList.vue")).default, render: () => null };
    Wizard = { ...(await vite.ssrLoadModule("/src/addons/conversation/components/UserAgentWizard.vue")).default, render: () => null };
    const el = () => ({ style: {}, textContent: "", remove() {}, appendChild(c: { textContent: string }) { if (c.textContent) toasts.push(c.textContent); } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
    Object.defineProperty(globalThis, "document", { configurable: true,
      value: { activeElement: null, createElement: el, body: el(), querySelector: () => null } });
  });
  after(() => { Reflect.deleteProperty(globalThis, "window"); Reflect.deleteProperty(globalThis, "document"); });

  const MINE = "/api/v1/addons/agent/mine";
  const DEFS = `${MINE}/definitions`;
  const card = (id: number, extra: Record<string, unknown> = {}) => ({ templateId: id, name: `a${id}`, slug: `s${id}`, description: "",
    disabled: false, instanceId: null, sessionCount: 0, lastSessionAt: null, config: { model: "m1" }, ...extra });
  // System card 1, someone else's shared card 5, my used card 9; my disabled never-used definition 10 is absent from /mine.
  const routes: Record<string, unknown> = {
    [`get ${MINE}`]: [card(1), card(5), card(9)],
    [`get ${DEFS}`]: [{ id: 9, name: "a9", isActive: true }, { id: 10, name: "off", isActive: false, config: { model: "m1" } }],
    [`get ${MINE}/models`]: [{ model: "m1" }],
  };
  let serve: Record<string, unknown> = routes;
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  async function mount(comp: Component = List, props: Record<string, unknown> = {}) {
    let instance: any = null;
    reply = (m, url, body) => {
      const r = serve[`${m} ${url}`];
      return typeof r === "function" ? r(body) : r instanceof Error || r instanceof Promise ? r : { data: { data: r ?? null } };
    };
    calls.length = 0; toasts.length = 0;
    const app = renderer.createApp({ render: () => h(comp, { ...props, onVnodeMounted: (v: any) => { instance = v.component; } }) });
    app.use(createI18n({ legacy: false, locale: "zh", missingWarn: false, fallbackWarn: false, messages: { zh } }));
    app.provide(ssrContextKey, {});
    app.mount({});
    await settle();
    return { app, s: instance!.setupState as any };
  }
  const writes = () => calls.filter((c) => c.method !== "get").map((c) => [`${c.method} ${c.url}`, c.body]);

  test("F1: 'mine' comes only from GET /mine/definitions — system and others' cards get no badge/actions", async () => {
    serve = routes;
    const { app, s } = await mount();
    try {
      assert.deepEqual(s.agents.map((a: any) => a.templateId), [1, 5, 9, 10]);
      assert.deepEqual([...s.ownedIds].sort((a: number, b: number) => a - b), [9, 10]);
      for (const a of s.agents) assert.equal(s.ownedIds.has(a.templateId), a.templateId >= 9, `card ${a.templateId}`);
    } finally { app.unmount(); }
  });

  test("F8: my disabled, never-used definition still shows (collapsed, disabled) via mergeOwned", async () => {
    serve = routes;
    const { app, s } = await mount();
    try {
      const off = s.agents.find((a: any) => a.templateId === 10);
      assert.ok(off, "own disabled definition listed");
      assert.equal(off.disabled, true);
      assert.deepEqual(s.groups.inactive.map((a: any) => a.templateId), [10]);
    } finally { app.unmount(); }
  });

  test("F9: definitions list failing keeps the page (cards shown, create hidden); /mine failing shows the error state", async () => {
    serve = { ...routes, [`get ${DEFS}`]: new Err(500, "boom") };
    let { app, s } = await mount();
    try {
      assert.equal(s.failed, false);
      assert.equal(s.loading, false);
      assert.deepEqual(s.agents.map((a: any) => a.templateId), [1, 5, 9]);
      assert.equal(s.entry, "hidden");
      assert.equal(s.ownedIds.size, 0);
    } finally { app.unmount(); }
    serve = { ...routes, [`get ${MINE}`]: new Err(500, "boom") };
    ({ app, s } = await mount());
    try {
      assert.equal(s.failed, true, "error state with retry, not a blank page");
      assert.equal(s.loading, false);
      assert.deepEqual(toasts, [zh.agents.loadFailed]);
    } finally { app.unmount(); }
  });

  test("F7: create-and-enable = POST then PATCH isActive; enable failing keeps the disabled agent and says why", async () => {
    serve = { ...routes, [`post ${DEFS}`]: { id: 11, name: "new", isActive: false }, [`patch ${DEFS}/11`]: {} };
    let { app, s } = await mount();
    const draft = { name: "new", description: "", model: "m1", prompt: "p" };
    try {
      s.openCreate();
      await s.submit(draft);
      assert.deepEqual(writes(), [[`post ${DEFS}`, { name: "new", model: "m1", prompt: "p" }], [`patch ${DEFS}/11`, { isActive: true }]]);
      assert.deepEqual(toasts, [zh.agents.mine.created]);
      assert.equal(s.wizard, null);
    } finally { app.unmount(); }
    serve = { ...serve, [`patch ${DEFS}/11`]: new Err(422, "model_not_open_to_users") };
    ({ app, s } = await mount());
    try {
      s.openCreate();
      serve = { ...serve, [`get ${DEFS}`]: [...(routes[`get ${DEFS}`] as unknown[]), { id: 11, name: "new", isActive: false }] };
      await s.submit(draft);
      assert.deepEqual(writes().map((w) => w[0]), [`post ${DEFS}`, `patch ${DEFS}/11`], "no rollback delete");
      assert.deepEqual(toasts, [zh.agents.mine.errModelClosed]);
      assert.equal(s.agents.find((a: any) => a.templateId === 11)?.disabled, true);
      assert.ok(s.ownedIds.has(11));
    } finally { app.unmount(); }
  });

  test("F6: edit with a blank prompt keeps it (PATCH has no prompt); a typed prompt is sent", async () => {
    serve = { ...routes, [`patch ${DEFS}/9`]: {} };
    const { app, s } = await mount();
    try {
      const mine = s.agents.find((a: any) => a.templateId === 9);
      s.openEdit(mine);
      assert.equal(s.wizard.initial.prompt, "");
      await s.submit({ name: "renamed", description: "", model: "m1", prompt: "  " });
      s.openEdit(mine);
      await s.submit({ name: "a9", description: "", model: "m1", prompt: "new" });
      assert.deepEqual(writes(), [[`patch ${DEFS}/9`, { name: "renamed" }], [`patch ${DEFS}/9`, { prompt: "new" }]]);
    } finally { app.unmount(); }
    // Contract independent of the prefilled base: blank prompt/model never clear the stored value.
    assert.deepEqual(ua.draftPatch({ name: "a", description: "", model: "m", prompt: "old" }, { name: "a", description: "", model: "", prompt: "" }), {});
  });

  test("F5: card actions are single-flight — double toggle/delete sends one request", async () => {
    let release!: () => void;
    const gate = () => new Promise((r) => { release = () => r({ data: { data: {} } }); });
    serve = { ...routes, [`patch ${DEFS}/9`]: gate, [`delete ${DEFS}/9`]: gate };
    const { app, s } = await mount();
    try {
      const mine = s.agents.find((a: any) => a.templateId === 9);
      const first = s.toggle(mine);
      s.toggle(mine);
      await settle();
      assert.deepEqual(writes(), [[`patch ${DEFS}/9`, { isActive: false }]]);
      release(); await first; await settle();
      calls.length = 0;
      s.remove(mine);
      s.remove(mine);
      await settle();
      assert.deepEqual(writes().map((w) => w[0]), [`delete ${DEFS}/9`]);
      release(); await settle();
    } finally { app.unmount(); }
  });

  test("F4: wizard ignores submit while busy (no second create)", async () => {
    const sent: unknown[] = [];
    const initial = { id: 9, name: "a9", description: "", model: "m1", prompt: "" };
    for (const busy of [true, false]) {
      const { app, s } = await mount(Wizard, { models: ["m1"], busy, errors: {}, initial, onSubmit: (d: unknown) => sent.push(d) });
      try { s.submit(); } finally { app.unmount(); }
    }
    assert.equal(sent.length, 1, "only the non-busy submit is emitted");
  });
});
