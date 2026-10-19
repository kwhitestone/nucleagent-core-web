import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import { coveredBySkills, effectiveToolIds, listToolCatalog, toolOptions, toolUnavailable, type ToolCatalogItem } from "../src/addons/conversation/api/toolCatalog.ts";
import { readDraft } from "../src/addons/conversation/composables/taskDraft.ts";
import { createDefinitionApi, DefinitionError } from "../src/addons/administration/agents/definition/api.ts";
import { changeCount, dirtyGroups } from "../src/addons/administration/agents/definition/groups.ts";

// G-TASK-TOOL-PICK-1900: tool pick on task setup, skill/tool pick on my agent and the admin drawer.

// userAgent.ts imports through the "@/" alias, so it is loaded via vite.
let vite: ViteDevServer;
let draftBody: any, draftFromConfig: any, draftPatch: any, emptyDraft: any, userAgentError: any;
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ draftBody, draftFromConfig, draftPatch, emptyDraft, userAgentError } = await vite.ssrLoadModule("/src/addons/conversation/api/userAgent.ts"));
});
after(() => vite.close());

const tool = (id: number, skillIds: number[] = [], extra: Partial<ToolCatalogItem> = {}): ToolCatalogItem =>
  ({ id, name: `t${id}`, skillIds, imported: false, ...extra });
const catalog = [tool(1), tool(2, [7]), tool(3, [8], { imported: true })];

test("covered: a tool is covered only by a picked owning skill", () => {
  assert.equal(coveredBySkills(catalog[1], [7]), true);
  assert.equal(coveredBySkills(catalog[1], [8]), false);
  assert.equal(coveredBySkills(catalog[0], [7]), false);
  assert.equal(coveredBySkills(undefined, [7]), false);
});

test("effective ids drop tools a picked skill brings, keep the rest and unknown ids (server decides)", () => {
  assert.deepEqual(effectiveToolIds([1, 2, 3], catalog, [7]), [1, 3]);
  assert.deepEqual(effectiveToolIds([1, 2], catalog, []), [1, 2]);
  assert.deepEqual(effectiveToolIds([99], catalog, [7]), [99]);
});

test("options: covered ones disabled with the note, imported ones badged and grouped", () => {
  const [a, b, c] = toolOptions(catalog, "zh", "IMP", [7], "COVERED");
  assert.equal(a.value, "1");
  assert.equal("disabled" in a, false);
  assert.equal(b.disabled, true);
  assert.equal(b.note, "COVERED");
  assert.equal(c.group, "imported");
  assert.deepEqual(c.badges, ["IMP"]);
  assert.equal(a.group, "system");
});

test("catalog v2: status != ready is listed disabled with reason badge; covered still decided by skillIds", () => {
  const rows = [tool(1, [], { status: "ready" }), tool(2, [9], { imported: true, status: "unavailable", reason: "held" }),
    tool(3, [], { imported: true, status: "unavailable", reason: "conflict" }), tool(4, [], { status: "unavailable", reason: "source_removed" }), tool(5)];
  assert.deepEqual(rows.map(toolUnavailable), [false, true, true, true, false]); // absent status = older core = ready
  assert.equal(toolUnavailable(undefined), false);
  const [a, b, c, d, e] = toolOptions(rows, "en", "IMP", [9], "COVERED", (r) => `OFF:${r}`);
  assert.equal("disabled" in a, false);
  assert.equal("disabled" in e, false);
  assert.equal(b.disabled, true);
  assert.equal(b.note, "COVERED"); // held tool owned by a picked skill: covered note, still disabled
  assert.deepEqual(b.badges, ["IMP", "OFF:held"]);
  assert.equal(c.disabled, true);
  assert.deepEqual(c.badges, ["IMP", "OFF:conflict"]);
  assert.equal(d.disabled, true);
  assert.deepEqual(d.badges, ["OFF:source_removed"]);
  assert.equal(coveredBySkills(rows[1], [9]), true);
  assert.deepEqual(effectiveToolIds([1, 2, 3], rows, [9]), [1, 3]);
});

test("catalog: malformed rows dropped, skillIds normalised, 404 = [] (older core), other errors thrown", async () => {
  let reply: () => unknown = () => ({ data: { data: [{ id: 1, name: "a" }, { id: 0, name: "z" }, { id: 2 }, null, { id: 3, name: "c", skillIds: [4, "x"] }] } });
  const calls: string[] = [];
  const off = registerPlatformRuntime({ http: { get: async (url: string) => { calls.push(url); const r = reply(); if (r instanceof Error) throw r; return r; } } } as never);
  try {
    assert.deepEqual(await listToolCatalog(), [{ id: 1, name: "a", skillIds: [] }, { id: 3, name: "c", skillIds: [4] }]);
    assert.deepEqual(calls, ["/api/v1/addons/tool/catalog"]);
    reply = () => Object.assign(new Error("nf"), { status: 404 });
    assert.deepEqual(await listToolCatalog(), []);
    reply = () => Object.assign(new Error("boom"), { status: 500 });
    await assert.rejects(listToolCatalog(), /boom/);
  } finally { off(); }
});

test("task draft keeps only positive integer toolIds; none = field absent", () => {
  const store = (d: unknown) => ({ getItem: () => JSON.stringify(d) }) as unknown as Storage;
  const base = { name: "n", desc: "d", execMode: "", outputFormat: "", templateName: "", skillIds: [] };
  assert.deepEqual(readDraft(store({ ...base, toolIds: [1, -2, 0, 1.5, "3", 4] }))?.toolIds, [1, 4]);
  assert.equal("toolIds" in (readDraft(store({ ...base, toolIds: [] })) ?? {}), false);
});

test("TaskSetup: no pick = no toolIds field; picks filtered by selected skills before create", () => {
  const src = readFileSync(new URL("../src/addons/conversation/views/TaskSetup.vue", import.meta.url), "utf8");
  assert.match(src, /\.\.\.createBindings\.value/);
  assert.match(src, /useBindingSelection\(\)/);
  assert.equal((src.match(/<BindingPickers /g) ?? []).length, 2); // phone row + desktop form
});

test("my agent: create body carries non-empty skillIds/toolIds only", () => {
  assert.deepEqual(draftBody(emptyDraft({ name: " a ", skillIds: [7], toolIds: [1] })), { name: "a", skillIds: [7], toolIds: [1] });
  const empty = draftBody(emptyDraft({ name: "a" }));
  assert.equal("skillIds" in empty || "toolIds" in empty, false);
});

test("my agent: patch sends a set only when it changed (order-insensitive); [] clears", () => {
  const base = emptyDraft({ name: "a", skillIds: [1, 2], toolIds: [3] });
  assert.deepEqual(draftPatch(base, emptyDraft({ ...base, skillIds: [2, 1] })), {});
  assert.deepEqual(draftPatch(base, emptyDraft({ ...base, toolIds: [] })), { toolIds: [] });
  assert.deepEqual(draftPatch(base, emptyDraft({ ...base, skillIds: [1] })), { skillIds: [1] });
});

test("my agent: prefill reads ids from owner config, junk dropped, missing = []", () => {
  const d = draftFromConfig({ skillIds: [5, "6", -1], toolIds: [9] } as never, []);
  assert.deepEqual([d.skillIds, d.toolIds], [[5], [9]]);
  const none = draftFromConfig(undefined, []);
  assert.deepEqual([none.skillIds, none.toolIds], [[], []]);
});

test("my agent: server refusals map to the bindings field with distinct messages", () => {
  const e = (detail: string) => userAgentError(Object.assign(new Error(detail), { status: 422 }));
  assert.deepEqual(e("skill_not_selectable"), { field: "bindings", key: "agents.mine.errSkillClosed" });
  assert.deepEqual(e("tool_not_selectable"), { field: "bindings", key: "agents.mine.errToolClosed" });
  assert.deepEqual(e("tool_covered_by_skill"), { field: "bindings", key: "agents.mine.errToolCovered" });
  assert.deepEqual(e("invalid toolIds"), { field: "bindings", key: "agents.mine.errToolClosed" });
});

const detail = (caps: Record<string, boolean>) => ({
  definition: { id: 4, name: "A", slug: "a", revision: "2", isActive: false, config: {} },
  capabilities: { read: true, write: true, writeIdentity: true, delete: true, restore: true, readSkills: true, writeSkillBindings: true, readTools: true, writeTools: false, ...caps },
  fieldPolicy: { editablePaths: ["/name"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skillBindings: [], skills: [], tools: [], toolBindings: [],
  effective: { revision: "r", definitionRevision: "2" }, identity: { uid: 5, status: "ready", projectionRevision: "2" },
});
const ok = (data: unknown) => ({ status: 200, headers: { etag: '"agent-4-2"' }, body: { code: 0, data } });

test("admin drawer: toolBindings sent only when changed and only with writeToolBindings", async () => {
  let body: any;
  const api = createDefinitionApi(async (_p, init) => { if (init?.body) body = JSON.parse(String(init.body)); return ok(detail({ writeToolBindings: true })); });
  const rec = await api.detail(4);
  await api.patch(rec, { "/name": "B" });
  assert.equal("toolBindings" in body, false);
  await api.patch(rec, {}, undefined, [3]);
  assert.deepEqual(body.toolBindings, [3]);
  const denied = createDefinitionApi(async () => ok(detail({})));
  await assert.rejects(denied.patch(await denied.detail(4), {}, undefined, [3]), (e: unknown) => e instanceof DefinitionError && e.status === 403);
});

test("admin drawer: catalog filtered; tool edits mark the skills group dirty and count once", async () => {
  const api = createDefinitionApi(async () => ok([{ id: 1, name: "a" }, { id: "x", name: "b" }, { id: 2, name: "c", skillIds: [7] }]));
  assert.deepEqual(await api.toolCatalog(), [{ id: 1, name: "a", skillIds: [] }, { id: 2, name: "c", skillIds: [7] }]);
  assert.equal(dirtyGroups({}, undefined, [1]).has("skills"), true);
  assert.equal(dirtyGroups({}, undefined, undefined).has("skills"), false);
  assert.equal(changeCount({ "/name": 1 }, undefined, []), 2);
});
