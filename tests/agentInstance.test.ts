import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { definitionDetail } from "./agentDefinitionFixture.ts";

let vite: ViteDevServer;
let unregister: () => void;
let userApi: any;
let adminApi: any;
let convApi: any;
const calls: Array<{ method: string; url: string; body?: unknown; options?: any }> = [];
let reply: unknown = { code: 0, data: [] };
const record = (method: string) => async (url: string, a?: any, b?: any) => {
  calls.push(method === "get" ? { method, url, options: a } : { method, url, body: a, options: b });
  return { data: reply };
};

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ getSessionVersion: () => 1, getAccessToken: () => "unit-test-session",
    http: { get: record("get"), post: record("post"), patch: record("patch"), request: async (cfg: any) => {
      calls.push({ method: cfg.method.toLowerCase(), url: cfg.url, body: cfg.data, options: cfg });
      return { status: 200, headers: { etag: '"agent-3-2"' }, data: reply };
    } } });
  userApi = await vite.ssrLoadModule("/src/addons/conversation/api/agent.ts");
  adminApi = await vite.ssrLoadModule("/src/addons/administration/api/agent.ts");
  convApi = await vite.ssrLoadModule("/src/addons/conversation/api/conversation.ts");
});
after(async () => { unregister(); await vite.close(); });

test("my agents: list, item and memory hit the instance contract", async () => {
  calls.length = 0;
  reply = { code: 0, data: [{ templateId: 3, name: "HR", instanceId: null, sessionCount: 0 }] };
  const list = await userApi.listMyAgents();
  assert.equal(list[0].instanceId, null, "an unused agent is still listed, without an instance");
  reply = { code: 0, data: { templateId: 3, name: "HR", instanceId: 9, memory: "likes tables" } };
  assert.equal((await userApi.getMyAgent(3)).memory, "likes tables");
  await userApi.updateAgentMemory(9, "");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "get /api/v1/addons/agent/mine",
    "get /api/v1/addons/agent/mine/3",
    "patch /api/v1/addons/agent/instances/9",
  ]);
  assert.deepEqual(calls[2].body, { memory: "" }, "clearing sends an empty string, not a delete");
});

test("instance session list filters by agentId and creation sends agentTemplateId", async () => {
  calls.length = 0;
  reply = { code: 0, data: [], hasMore: false };
  await convApi.listConversations({ agentId: 9, limit: 50 });
  assert.equal(calls[0].options.params.agentId, 9);
  reply = { code: 0, data: { id: 1 } };
  await convApi.createConversation({ mode: "a2a_agent", input: "hi", agentTemplateId: 3 });
  assert.equal((calls[1].body as any).agentTemplateId, 3);
  assert.equal((calls[1].body as any).agentId, undefined, "the client never picks an instance id");
});

test("admin agents: CRUD and metadata-only usage", async () => {
  calls.length = 0;
  reply = { code: 0, data: [{ id: 3, name: "HR", isActive: true, instanceCount: 2, sessions7d: 5 }] };
  assert.equal((await adminApi.agentDefinitions.list())[0].instanceCount, 2);
  reply = { code: 0, data: definitionDetail };
  await adminApi.agentDefinitions.create({ ...definitionDetail, capabilities: { ...definitionDetail.capabilities, create: true } }, "hr", { "/name": "HR" }, "request_key_123456");
  await adminApi.agentDefinitions.lifecycle({ ...definitionDetail, etag: '"agent-3-2"' }, "disable");
  reply = { code: 0, data: [{ instanceId: 9, userId: 7, nickName: "A", firstUsedAt: "x", sessionCount: 1, lastSessionAt: null }], total: 41 };
  const page = await adminApi.agentDefinitions.instances(3, 20);
  assert.equal(page.total, 41);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["firstUsedAt", "instanceId", "lastSessionAt", "nickName", "sessionCount", "userId"]);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "get /api/v1/addons/admin/agents?include_deleted=1",
    "post /api/v1/addons/admin/agents",
    "patch /api/v1/addons/admin/agents/3",
    "get /api/v1/addons/admin/agents/3/instances?offset=20&limit=20",
  ]);
  assert.deepEqual(calls[2].body, { changes: { "/isActive": false } });
  assert.equal(calls[1].options.headers["idempotency-key"], "request_key_123456");
  assert.equal(calls[2].options.headers["if-match"], '"agent-3-2"');
});

test("routes: instance page under /agents, admin tab gated by core:admin:read", () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(src("addons/conversation/index.ts"), /routeScopes:[^\]]*"\/agents"/);
  assert.match(src("addons/conversation/index.ts"), /path: "\/agents\/:templateId"/);
  assert.match(src("addons/administration/index.ts"), /path: "agents"[\s\S]*AdminAgents\.vue/);
  assert.match(src("addons/administration/views/admin/AdminLayout.vue"), /"\/admin\/agents"[^\n]*core:admin:read/);
  for (const locale of ["zh", "en"]) {
    const text = src(`i18n/${locale}.ts`);
    for (const key of ["memoryHint", "personaNewSessions", "disabledHint", "metadataOnly"]) assert.match(text, new RegExp(`${key}:`), `${locale}.${key}`);
  }
});

test("shell projection: my agents ride the existing conversations message (no new channel type)", () => {
  const bridge = readFileSync(new URL("../src/addons/conversation/composables/useShellBridge.ts", import.meta.url), "utf8");
  assert.match(bridge, /fromChild: \["auth-required", "conversations", "view-changed"\]/, "agents add no channel type");
  assert.match(bridge, /agents: agents\.value\.map\(\(a\) => \(\{\s*templateId: a\.templateId, name: a\.name, disabled: a\.disabled, lastSessionAt: a\.lastSessionAt,/);
  assert.match(bridge, /agents\.value = \[\];/, "session change drops the previous identity's agents");
  assert.match(bridge, /runtime\.getAccessToken\(\) === token && runtime\.getSessionVersion\(\) === version\) agents\.value = list/,
    "a late response from an old session is discarded");
});
