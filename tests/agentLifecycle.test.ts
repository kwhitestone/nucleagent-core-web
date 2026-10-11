// AG1-B3: agent definition delete / restore / impact / audit in the admin UI,
// the deleted-agent banner, and the admin "edit" jump (Q2 B6, B10, B12).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { definitionDetail } from "./agentDefinitionFixture.ts";

let vite: ViteDevServer;
let unregister: () => void;
let adminApi: any;
let userApi: any;
let lifecycle: any;
let zh: any;
let en: any;
const calls: Array<{ method: string; url: string; body?: unknown; options?: any }> = [];
let reply: unknown = { code: 0, data: [] };
const record = (method: string) => async (url: string, a?: any, b?: any) => {
  calls.push(method === "get" || method === "delete" ? { method, url, options: a } : { method, url, body: a, options: b });
  return { data: reply };
};
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ getSessionVersion: () => 1, getAccessToken: () => "unit-test-session",
    http: { get: record("get"), post: record("post"), patch: record("patch"), delete: record("delete"),
      request: async (cfg: any) => {
        calls.push({ method: cfg.method.toLowerCase(), url: cfg.url, body: cfg.data, options: cfg });
        return { status: 200, headers: { etag: '"agent-3-2"' }, data: reply };
      } } });
  adminApi = await vite.ssrLoadModule("/src/addons/administration/api/agent.ts");
  userApi = await vite.ssrLoadModule("/src/addons/conversation/api/agent.ts");
  lifecycle = await vite.ssrLoadModule("/src/addons/administration/agents/lifecycle.ts");
  ({ default: zh } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: en } = await vite.ssrLoadModule("/src/i18n/en.ts"));
});
after(async () => { unregister(); await vite.close(); });

test("api: complete aggregate list, delete, restore, impact and audits use CAS contract", async () => {
  calls.length = 0;
  reply = { code: 0, data: [] };
  await adminApi.agentDefinitions.list();
  const snapshot = { ...definitionDetail, etag: '"agent-3-2"' };
  reply = { code: 0, data: definitionDetail };
  await adminApi.agentDefinitions.lifecycle(snapshot, "delete");
  await adminApi.agentDefinitions.lifecycle(snapshot, "restore");
  reply = { code: 0, data: { instances: 2, conversations: 5, conversations_7d: 1, skill_bindings: 0, im_groups: null, deliverables: null, unavailable: ["im_groups", "deliverables"], counted_at: "x" } };
  const impact = await adminApi.agentDefinitions.impact(3);
  assert.equal(impact.conversations_7d, 1);
  reply = { code: 0, data: [{ id: 1, action: "delete", actorUserId: 5, fields: ["deletedAt"], promptSha256Before: "", promptSha256After: "", createdAt: "x" }], total: 1 };
  const audits = await adminApi.agentDefinitions.audits(3);
  assert.equal(audits.total, 1);
  assert.equal(audits.items[0].action, "delete");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "get /api/v1/addons/admin/agents?include_deleted=1",
    "delete /api/v1/addons/admin/agents/3",
    "post /api/v1/addons/admin/agents/3/restore",
    "get /api/v1/addons/admin/agents/3/impact",
    "get /api/v1/addons/admin/agents/3/audits?offset=0&limit=20",
  ]);
  assert.equal(calls[1].options.headers["if-match"], snapshot.etag);
  assert.equal(calls[2].options.headers["if-match"], snapshot.etag);
});

test("api: avatar uses one dirty leaf, never a flattened DTO or whole config", async () => {
  calls.length = 0;
  reply = { code: 0, data: definitionDetail };
  await adminApi.agentDefinitions.patch({ ...definitionDetail, etag: '"agent-3-2"' }, { "/config/avatar": "https://cdn.example/a.png" });
  assert.deepEqual(calls[0].body, { changes: { "/config/avatar": "https://cdn.example/a.png" } });
});

test("delete is only offered for a disabled, not-yet-deleted definition; restore only for a deleted one", () => {
  assert.equal(lifecycle.canDelete({ isActive: true, deletedAt: null }), false, "B4: active must be disabled first");
  assert.equal(lifecycle.canDelete({ isActive: false, deletedAt: null }), true);
  assert.equal(lifecycle.canDelete({ isActive: false, deletedAt: "x" }), false);
  assert.equal(lifecycle.canRestore({ isActive: false, deletedAt: "x" }), true);
  assert.equal(lifecycle.canRestore({ isActive: false, deletedAt: null }), false);
});

test("impact rows: every count shown, unavailable ones say so instead of 0", () => {
  const rows = lifecycle.impactRows({ instances: 2, conversations: 5, conversations_7d: 1, skill_bindings: 0, im_groups: null, deliverables: 3, unavailable: ["im_groups"], counted_at: "x" });
  assert.deepEqual(rows.map((r: any) => r.key), ["instances", "conversations", "conversations_7d", "skill_bindings", "im_groups", "deliverables"]);
  assert.deepEqual(rows.find((r: any) => r.key === "im_groups"), { key: "im_groups", value: null });
  assert.deepEqual(rows.find((r: any) => r.key === "skill_bindings"), { key: "skill_bindings", value: 0 });
});

test("delete confirmation requires typing the slug", () => {
  assert.equal(lifecycle.confirmMatches("hr-assistant", "hr-assistant"), true);
  assert.equal(lifecycle.confirmMatches("hr-assistant", " hr-assistant "), true);
  assert.equal(lifecycle.confirmMatches("hr-assistant", "hr"), false);
  assert.equal(lifecycle.confirmMatches("hr-assistant", ""), false);
});

test("my agent detail and deleted state come from /agent/mine/{id}", async () => {
  calls.length = 0;
  reply = { code: 0, data: { templateId: 3, name: "HR", deleted: true, disabled: true, instanceId: 9 } };
  const agent = await userApi.getMyAgent(3);
  assert.equal(agent.deleted, true);
  reply = { code: 0, data: { id: 9, templateId: 3, userId: 7 } };
  assert.equal(await userApi.getInstanceTemplateId(9), 3);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "get /api/v1/addons/agent/mine/3",
    "get /api/v1/addons/agent/instances/9",
  ]);
});

test("views: delete/restore/impact/audit/filter in the admin page; avatar field; ?edit= opens the editor", () => {
  const page = src("addons/administration/views/admin/AdminAgents.vue");
  const drawer = src("addons/administration/agents/definition/DefinitionDrawer.vue");
  const fields = src("addons/administration/agents/definition/draft.ts");
  assert.match(page, /<AgentManagement/);
  for (const action of ["delete", "restore"]) assert.ok(drawer.includes(`prepare('${action}')`));
  assert.match(drawer, /editor\.dirty \|\| record\.definition\.isActive/);
  assert.match(drawer, /sameImpact\(impact\.value, fresh\)/);
  assert.match(drawer, /typedSlug\.value !== record\.value\.definition\.slug/);
  assert.match(drawer, /api\.audits/);
  assert.match(fields, /\/config\/avatar/);
  assert.match(page, /route\.query\.edit/, "/admin/agents?edit=id opens that definition");
  assert.match(drawer, /label\('nextTurn'\)/);
  assert.match(drawer, /record\.capabilities\.write/);
});

test("views: deleted banner on the agent page and the conversation page; admin edit link", () => {
  const agentPage = src("addons/conversation/views/AgentInstance.vue");
  assert.match(agentPage, /agent\.deleted/);
  assert.match(agentPage, /agents\.deletedHint/);
  assert.match(agentPage, /\/admin\/agents\?edit=/);
  assert.match(agentPage, /core:admin:write/);
  const conv = src("addons/conversation/views/Conversation.vue");
  assert.match(conv, /data-testid="conv-agent-deleted"/);
  assert.match(conv, /agents\.deletedHint/);
});

test("i18n: every new key exists in zh and en", () => {
  const admin = ["delete", "restore", "showDeleted", "deleted", "deleteTitle", "deleteImpact", "deleteKeeps", "deleteTypeSlug",
    "deleteConfirm", "deletedToast", "restoredToast", "impactUnavailable", "audits", "auditsTitle", "noAudits", "effectTiming",
    "fieldAvatar", "deleteNeedsDisable", "impact_instances", "impact_conversations", "impact_conversations_7d",
    "impact_skill_bindings", "impact_im_groups", "impact_deliverables",
    "action_create", "action_update", "action_disable", "action_enable", "action_delete", "action_restore", "promptHash"];
  for (const [name, dict] of [["zh", zh], ["en", en]] as const) {
    for (const key of admin) assert.ok(dict.agents.admin[key], `${name}.agents.admin.${key}`);
    for (const key of ["deleted", "deletedHint", "editAsAdmin"]) assert.ok(dict.agents[key], `${name}.agents.${key}`);
  }
  assert.match(zh.agents.deleted, /已删除/);
  assert.match(en.agents.deleted, /[Dd]eleted/);
});

test("mobile (B12): dialogs fit a 390px screen", () => {
  const drawer = src("addons/administration/agents/definition/DefinitionDrawer.vue");
  assert.match(drawer, /@media \(max-width: 600px\) \{[\s\S]*?\.definition-drawer \{ width: 100%/);
  assert.match(drawer, /100dvh/);
  assert.match(drawer, /min-height: 44px/);
});
