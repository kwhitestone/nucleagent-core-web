import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let hs: any;
let api: any;
let chip: any;
let zh: any;
let en: any;
let unregister: () => void;
const calls: Array<[string, string, unknown]> = [];
let putStatus = 200;

// The sibling nucleagent-shared checkout (workspace layout), or NUCLEAGENT_SHARED_DIR. Absent = check skipped.
const sharedModel = () => readFileSync(process.env.NUCLEAGENT_SHARED_DIR
  ? `${process.env.NUCLEAGENT_SHARED_DIR}/model/home_suggestion.go`
  : new URL("../../nucleagent-shared/model/home_suggestion.go", import.meta.url), "utf8");
const t = (messages: any) => (key: string) => key.split(".").reduce((o, k) => o?.[k], messages) as string;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  hs = await vite.ssrLoadModule("/src/composables/homeSuggestions.ts");
  ({ default: zh } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: en } = await vite.ssrLoadModule("/src/i18n/en.ts"));
  ({ default: chip } = await vite.ssrLoadModule("/src/components/SuggestionChip.vue"));
  const { registerPlatformRuntime, ApiError } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const config = { items: [{ id: "a", enabled: true, icon: "rocket", action: "prefill", titleZh: "甲" }], revision: 4, updatedAt: null, source: "stored" };
  unregister = registerPlatformRuntime({ http: {
    get: async (url: string, options: any) => { calls.push(["GET", url, options]); return { data: { code: 0, data: url.includes("/admin/") ? config : { items: config.items } } }; },
    put: async (url: string, body: any) => {
      calls.push(["PUT", url, body]);
      if (putStatus === 409) throw new ApiError("home suggestions changed since they were read", "home_suggestions_conflict", 409);
      return { data: { code: 0, data: { ...config, revision: 5 } } };
    },
    post: async (url: string) => { calls.push(["POST", url, undefined]); return { data: { code: 0, data: config } }; },
  } });
  api = await vite.ssrLoadModule("/src/addons/administration/api/homeSuggestions.ts");
});
after(async () => { unregister(); await vite.close(); });

test("icon library: >= 60 unique ids, same set and order as Core's whitelist, legacy 9 first", () => {
  const ids = hs.HOME_ICONS.map((i: any) => i.id);
  assert.ok(ids.length >= 60, `${ids.length} icons`);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 9), ["check", "ppt", "chat", "video", "music", "chart", "doc", "clock", "layers"]);
  // The server whitelist lives in shared; keep both lists in lockstep when the sibling checkout is present.
  try {
    const go = sharedModel();
    const block = go.slice(go.indexOf("HomeSuggestionIcons = []string{"), go.indexOf("// DefaultHomeSuggestions"));
    assert.deepEqual([...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]), ids);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const category of hs.ICON_CATEGORIES) assert.ok(hs.searchIcons(category, "").length > 0, category);
  assert.deepEqual(hs.searchIcons("all", "火箭").map((i: any) => i.id), []);
  assert.deepEqual(hs.searchIcons("all", "启动").map((i: any) => i.id), ["rocket"]);
  assert.deepEqual(hs.searchIcons("code", "term").map((i: any) => i.id), ["terminal"]);
  assert.equal(hs.iconFor("not-a-real-icon").id, "layers");
});

test("fallback is the pre-T14 9 cards, text verbatim from i18n in both locales", () => {
  const cards = hs.fallbackCards(t(zh));
  assert.equal(cards.length, 9);
  assert.deepEqual(cards[0], { id: "competitiveAnalysis", icon: "check", action: "fill-title", prompt: "", title: "竞品分析", desc: "自动收集数据生成报告" });
  assert.equal(hs.fallbackCards(t(en))[8].title, "Knowledge Base Q&A");
  // Core's seed (shared DefaultHomeSuggestions) must say exactly the same.
  try {
    const go = sharedModel();
    for (const [i, { id, icon }] of hs.FALLBACK_CARDS.entries()) {
      const s = zh.home.suggestions[id];
      const e = en.home.suggestions[id];
      const row = `row(${(i + 1) * 10}, "${id}", "${icon}", "${s.title}", "${s.desc}", "${e.title}", "${e.desc}")`;
      assert.ok(go.includes(row), `seed drifted from i18n: ${row}`);
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
});

test("home: bad, empty or null responses fall back; bad items are skipped; en falls back to zh", () => {
  for (const data of [null, undefined, {}, { items: "x" }, { items: [] }, { items: [{ id: "x" }] }, { items: [{ id: "a", titleZh: "甲", enabled: false }] }]) {
    assert.equal(hs.resolveCards(data, "zh-CN"), null, JSON.stringify(data));
  }
  const data = { items: [
    { id: "a", icon: "rocket", action: "prefill", titleZh: "甲", descZh: "描述", promptZh: "写一份\n报告", titleEn: "A" },
    { id: "b", icon: "unknown-icon", action: "weird", titleZh: "乙" },
    { titleZh: "no id" },
  ] };
  const zhCards = hs.resolveCards(data, "zh-CN");
  assert.deepEqual(zhCards.map((c: any) => c.id), ["a", "b"]);
  assert.equal(zhCards[1].icon, "layers");
  assert.equal(zhCards[1].action, "fill-title");
  const enCards = hs.resolveCards(data, "en");
  assert.equal(enCards[0].title, "A");
  assert.equal(enCards[0].desc, "描述");
  assert.equal(enCards[0].prompt, "写一份\n报告");
});

test("the built-in 9 (seed = restore defaults) pass validation as they are", () => {
  const items = hs.FALLBACK_CARDS.map(({ id, icon }: any) => ({ id, icon, enabled: true, action: "fill-title",
    titleZh: zh.home.suggestions[id].title, descZh: zh.home.suggestions[id].desc, promptZh: "",
    titleEn: en.home.suggestions[id].title, descEn: en.home.suggestions[id].desc, promptEn: "" }));
  assert.equal(hs.validateItems(items), null);
});

test("click: prefill inserts the prompt, empty prompt or fill-title inserts 'title：'", () => {
  assert.equal(hs.cardInput({ action: "prefill", title: "甲", prompt: "全文" }), "全文");
  assert.equal(hs.cardInput({ action: "prefill", title: "甲", prompt: "" }), "甲：");
  assert.equal(hs.cardInput({ action: "fill-title", title: "甲", prompt: "全文" }), "甲：");
});

test("admin validation mirrors Core: count, id, duplicate, icon, action, lengths, control chars, one enabled", () => {
  const ok = { id: "a", enabled: true, icon: "rocket", action: "prefill", titleZh: "甲", descZh: "", promptZh: "多\n行", titleEn: "", descEn: "", promptEn: "" };
  assert.equal(hs.validateItems([ok]), null);
  const bad = (patch: any) => hs.validateItems([{ ...ok, ...patch }]);
  assert.deepEqual(hs.validateItems([]), { index: -1, field: "items", reason: "count" });
  assert.equal(hs.validateItems(Array.from({ length: 13 }, (_, i) => ({ ...ok, id: `c${i}` })))?.reason, "count");
  assert.equal(bad({ id: "1a" })?.reason, "id");
  assert.equal(hs.validateItems([ok, { ...ok, id: "A" }])?.reason, "duplicate");
  assert.equal(bad({ icon: "https://x/y.svg" })?.reason, "icon");
  assert.equal(bad({ action: "template" })?.reason, "action");
  assert.deepEqual(bad({ titleZh: "字".repeat(41) }), { index: 0, field: "titleZh", reason: "tooLong" });
  assert.equal(bad({ titleZh: "字".repeat(40) }), null);
  assert.deepEqual(bad({ descEn: "a".repeat(81) }), { index: 0, field: "descEn", reason: "tooLong" });
  assert.deepEqual(bad({ titleZh: "  " }), { index: 0, field: "titleZh", reason: "required" });
  assert.deepEqual(bad({ titleEn: "a\nb" }), { index: 0, field: "titleEn", reason: "control" });
  assert.deepEqual(bad({ promptZh: "ab" }), { index: 0, field: "promptZh", reason: "control" });
  assert.deepEqual(bad({ enabled: false }), { index: -1, field: "enabled", reason: "noneEnabled" });
});

test("export/import round-trips; import accepts an admin GET envelope and rejects junk", () => {
  const items = [{ id: "a", enabled: false, icon: "rocket", action: "prefill", titleZh: "甲", descZh: "", promptZh: "p", titleEn: "", descEn: "", promptEn: "" }];
  assert.deepEqual(hs.parseImport(hs.exportJSON(items)), items);
  assert.equal(hs.parseImport(JSON.stringify({ code: 0, data: { items } }))[0].id, "a");
  assert.equal(hs.parseImport(JSON.stringify([{ ...items[0], action: "template" }]))[0].action, "template");
  assert.throws(() => hs.parseImport("{}"));
  assert.throws(() => hs.parseImport("not json"));
  assert.throws(() => hs.parseImport(JSON.stringify([{ id: "x" }])), /no id or Chinese title/);
});

test("admin API: GET unwraps, PUT sends expectedRevision and rewrites sortOrder, 409 surfaces as ApiError, reset POSTs", async () => {
  const got = await api.getHomeSuggestions();
  assert.equal(got.revision, 4);
  assert.equal(got.items[0].id, "a");
  const items = [{ ...got.items[0] }, { ...got.items[0], id: "b" }];
  assert.equal((await api.saveHomeSuggestions(items, 4)).revision, 5);
  const [, url, body] = calls.at(-1)! as [string, string, any];
  assert.equal(url, "/api/v1/addons/admin/home-suggestions");
  assert.equal(body.expectedRevision, 4);
  assert.deepEqual(body.items.map((i: any) => i.sortOrder), [10, 20]);
  putStatus = 409;
  await assert.rejects(api.saveHomeSuggestions(items, 4), (e: any) => e.status === 409);
  putStatus = 200;
  await api.resetHomeSuggestions();
  assert.deepEqual(calls.at(-1), ["POST", "/api/v1/addons/admin/home-suggestions/reset", undefined]);
});

test("user API asks with a 2 s budget and returns the raw data", async () => {
  const user = await vite.ssrLoadModule("/src/addons/conversation/api/homeSuggestions.ts");
  const data = await user.fetchHomeSuggestions();
  assert.equal(data.items[0].id, "a");
  assert.deepEqual(calls.at(-1), ["GET", "/api/v1/addons/conversation/home-suggestions", { timeout: 2000 }]);
});

test("chip renders text as plain text with a bundled currentColor svg", async () => {
  const app = createSSRApp({ render: () => h(chip, { card: { id: "x", icon: "rocket", action: "prefill", title: "<img src=x onerror=alert(1)>", desc: "d", prompt: "" } }) });
  app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zh } }));
  const html = await renderToString(app);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-icon="rocket"/);
  assert.match(html, /<svg[^>]*stroke="currentColor"/);
});
