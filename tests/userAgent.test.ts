import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { createSSRApp, h, type Component } from "vue";
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

class Err extends Error { constructor(public status: number, message: string) { super(message); } }
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
  unregister = registerPlatformRuntime({ http: fakeHttp } as any);
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
    for (const status of [404, 405]) {
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
