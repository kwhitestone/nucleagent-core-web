import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import { createServer, type ViteDevServer } from "vite";

// MUYU-163: the read-only all-users conversation viewer. Fixture data only.
let vite: ViteDevServer;
let api: any;
let presentation: any;
let detailView: any;
let messages: any;
let english: any;
let administration: any;
let unregister: () => void;
const calls: Array<[string, unknown]> = [];
let responses: Record<string, any> = {};

const user = { id: 12, username: "fixture-bob", nickName: "Bob", accountType: "human", isActive: true };
const chatDetail = {
  type: "chat", id: 7, userId: 12, user, title: "Fixture <b>title</b>", status: "executing", processing: true,
  createdAt: "2026-10-20T08:00:00Z", messageCount: 3, streamingCount: 1, inFlightCount: 1, linkStatus: "ok",
  links: [{ coreConversationId: 7, coreStatus: "executing", channelType: 1, channelKey: "12@40", agentUserId: 40, executionOwnerUserId: 12, imConversationId: 33 }],
};
const chatMessages = [
  { id: 1, senderType: "user", senderName: "fixture-bob", msgType: "text", content: "hello <script>x</script>", streaming: false,
    attachments: [{ messageId: 1, fileId: "f-1", name: "spec.pdf", mimeType: "application/pdf", size: 2048 }], createdAt: "2026-10-20T08:00:00Z" },
  { id: 2, senderType: "agent", senderName: "agent.thinking", msgType: "text", content: "", streaming: false, thinking: true, contentHidden: true, createdAt: "2026-10-20T08:00:01Z" },
  { id: 3, senderType: "agent", senderName: "agent", msgType: "streaming", content: "partial answer", streaming: true, createdAt: "2026-10-20T08:00:02Z" },
];

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: {
    get: async (url: string, options: any) => {
      calls.push([url, options?.params]);
      const body = responses[url];
      if (!body) throw new Error(`unexpected GET ${url}`);
      return { data: typeof body === "function" ? body(options?.params) : body };
    },
  } });
  api = await vite.ssrLoadModule("/src/addons/administration/api/conversations.ts");
  presentation = await vite.ssrLoadModule("/src/addons/administration/views/admin/conversationPresentation.ts");
  ({ default: detailView } = await vite.ssrLoadModule("/src/addons/administration/views/admin/AdminConversationDetail.vue"));
  ({ default: messages } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: english } = await vite.ssrLoadModule("/src/i18n/en.ts"));
  ({ default: administration } = await vite.ssrLoadModule("/src/addons/administration/index.ts"));
});
after(async () => { unregister(); await vite.close(); });

test("list sends only the given filters and unwraps the cursor page", async () => {
  responses = { "/api/v1/addons/admin/conversations": { code: 0, data: [{ type: "chat", id: 7, userId: 12, processing: true }], nextCursor: "c2", hasMore: true } };
  const page = await api.listConversations({ type: "chat", userId: " 12 ", from: "", to: "", includeDeleted: true }, "", 20);
  assert.deepEqual(calls.at(-1), ["/api/v1/addons/admin/conversations", { type: "chat", limit: "20", userId: "12", includeDeleted: "true" }]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "c2");
  await api.listConversations({ type: "im", includeDeleted: true }, "c2", 5);
  assert.deepEqual(calls.at(-1), ["/api/v1/addons/admin/conversations", { type: "im", limit: "5", cursor: "c2" }]);
});

test("a last page never carries a cursor, and a malformed body fails instead of showing nothing", async () => {
  responses = { "/api/v1/addons/admin/conversations": { code: 0, data: [], nextCursor: "stale", hasMore: false } };
  const page = await api.listConversations({ type: "chat" });
  assert.equal(page.nextCursor, "");
  responses = { "/api/v1/addons/admin/conversations": { code: 0 } };
  await assert.rejects(api.listConversations({ type: "chat" }), /malformed/);
});

test("time filters become RFC3339 and invalid ones are dropped", () => {
  const params = api.listParams({ type: "chat", from: "2026-10-20T08:00", to: "nonsense" });
  assert.match(params.from, /^2026-10-20T\d\d:00:00\.000Z$/);
  assert.equal(params.to, undefined);
});

test("detail paths accept only chat|im and positive integer ids", () => {
  assert.equal(api.conversationPath("chat", 7), "/api/v1/addons/admin/conversations/chat/7");
  assert.equal(api.conversationPath("im", "33"), "/api/v1/addons/admin/conversations/im/33");
  for (const [type, id] of [["sms", 1], ["chat", 0], ["chat", "1/../2"], ["im", "-3"], ["chat", "7?x=1"]]) {
    assert.throws(() => api.conversationPath(type, id));
  }
});

test("IM<->Core jumps point at the other side only", () => {
  assert.deepEqual(presentation.linkTargets(chatDetail).map((l: any) => l.to), ["/admin/conversations/im/33"]);
  const imDetail = { ...chatDetail, type: "im", id: 33, links: [chatDetail.links[0], chatDetail.links[0]] };
  assert.deepEqual(presentation.linkTargets(imDetail), [{ kind: "core", id: 7, to: "/admin/conversations/chat/7", status: "executing" }]);
  assert.deepEqual(presentation.linkTargets({ ...chatDetail, links: [] }), []);
});

test("sizes and user labels never invent data", () => {
  assert.equal(api.formatSize(2048), "2.0 KB");
  assert.equal(api.formatSize(0), "");
  assert.equal(api.userLabel(undefined, 9), "UID 9");
  assert.equal(api.userLabel(user, 12), "Bob (fixture-bob)");
});

test("routes register the list and a constrained detail path under the admin layout", () => {
  const admin = administration.routes.find((route: any) => route.path === "/admin");
  const paths = admin.children.map((child: any) => child.path);
  assert.ok(paths.includes("conversations"));
  assert.ok(paths.includes("conversations/:type(chat|im)/:id(\\d+)"));
  for (const existing of ["providers", "default-model", "skills", "tools", "agents", "home-suggestions", "users", "executors"]) {
    assert.ok(paths.includes(existing), `existing admin route ${existing} kept`);
  }
});

test("every viewer string exists in both locales", () => {
  const keys = (value: any, prefix = ""): string[] => Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
  assert.deepEqual(keys(messages.conversationsAdmin).sort(), keys(english.conversationsAdmin).sort());
  assert.ok(messages.admin.tabs.conversations && english.admin.tabs.conversations);
});

async function renderDetail() {
  responses = {
    "/api/v1/addons/admin/conversations/chat/7": { code: 0, data: chatDetail },
    "/api/v1/addons/admin/conversations/chat/7/messages": (params: any) => params?.cursor
      ? { code: 0, data: [], hasMore: false }
      : { code: 0, data: chatMessages, nextCursor: "m2", hasMore: true },
  };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/admin/conversations", component: { template: "<div/>" } },
    { path: "/admin/conversations/:type/:id", component: detailView },
  ] });
  await router.push("/admin/conversations/chat/7");
  await router.isReady();
  const app = createSSRApp({ template: "<router-view />" });
  app.use(router);
  app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": messages, en: english } }));
  return renderToString(app);
}

test("detail renders owner, processing state, streaming, hidden thinking, attachments and the IM link as plain text", async () => {
  const html = await renderDetail();
  assert.match(html, /Bob \(fixture-bob\)/);
  assert.match(html, /data-testid="conv-processing"[^>]*>处理中/);
  assert.match(html, /1 条流式消息/);
  assert.match(html, /1 条 IM 待处理/);
  assert.match(html, /hello &lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /Fixture &lt;b&gt;title&lt;\/b&gt;/);
  assert.match(html, /（思考过程不展示）/);
  assert.match(html, /生成中/);
  assert.match(html, /spec\.pdf/);
  assert.match(html, /2\.0 KB/);
  assert.match(html, /href="\/admin\/conversations\/im\/33"/);
  assert.match(html, /data-testid="conv-more"/);
  for (const forbidden of ["<textarea", "<input", "删除", "发送", "下载", "data-testid=\"user-toggle\""]) {
    assert.ok(!html.includes(forbidden), `read-only view must not render ${forbidden}`);
  }
});
