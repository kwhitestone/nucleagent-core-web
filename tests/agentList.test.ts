import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { agentModel, agentStatus, avatarGradient, groupAgents, matchesQuery } from "../src/addons/conversation/components/agentCard.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const agent = (id: number, extra: Record<string, unknown> = {}) => ({
  templateId: id, name: `Agent ${id}`, slug: `a${id}`, description: "", disabled: false,
  instanceId: null, sessionCount: 0, lastSessionAt: null, ...extra,
});

test("0 / 1 / 6 / 20 agents: enabled first by last use then id, disabled grouped apart", () => {
  assert.deepEqual(groupAgents([], ""), { active: [], inactive: [] });
  assert.deepEqual(groupAgents([agent(1)], "").active.map((a) => a.templateId), [1]);
  const six = [
    agent(1), agent(2, { lastSessionAt: "2026-10-01T00:00:00Z", sessionCount: 3 }), agent(3),
    agent(4, { lastSessionAt: "2026-10-12T00:00:00Z", sessionCount: 1 }), agent(5, { disabled: true, lastSessionAt: "2026-10-13T00:00:00Z" }), agent(6),
  ];
  const g = groupAgents(six, "");
  assert.deepEqual(g.active.map((a) => a.templateId), [4, 2, 1, 3, 6]);
  assert.deepEqual(g.inactive.map((a) => a.templateId), [5]);
  const twenty = Array.from({ length: 20 }, (_, i) => agent(i + 1, { disabled: i >= 18 }));
  const g20 = groupAgents(twenty, "");
  assert.equal(g20.active.length, 18);
  assert.equal(g20.inactive.length, 2);
});

test("search filters name and description, case-insensitive, trimmed", () => {
  const list = [agent(1, { name: "周报生成器" }), agent(2, { description: "Data Analysis helper" }), agent(3)];
  assert.ok(matchesQuery(list[0], " 周报 "));
  assert.ok(matchesQuery(list[1], "analysis"));
  assert.equal(matchesQuery(list[2], "analysis"), false);
  assert.deepEqual(groupAgents(list, "ANALYSIS").active.map((a) => a.templateId), [2]);
});

test("model label is the public read-only config.model; missing model degrades gracefully", () => {
  assert.equal(agentModel(agent(1, { config: { model: "gpt-5" } })), "gpt-5");
  assert.equal(agentModel(agent(1, { config: {} })), "");
  assert.equal(agentModel(agent(1)), "");
  // Older Core never sends model: a disabled agent is "disabled", never "needs config".
  assert.equal(agentStatus(agent(1, { disabled: true }), false), "disabled");
  // Newer Core: disabled without a model means it still needs configuring.
  assert.equal(agentStatus(agent(1, { disabled: true }), true), "unconfigured");
  assert.equal(agentStatus(agent(1, { disabled: true, config: { model: "m" } }), true), "disabled");
  assert.equal(agentStatus(agent(1), true), "active");
});

test("avatar fallback rotates six existing gradients by id", () => {
  const all = new Set(Array.from({ length: 6 }, (_, i) => avatarGradient(i)));
  assert.equal(all.size, 6);
  assert.equal(avatarGradient(7), avatarGradient(1));
  for (const g of all) assert.match(g, /^var\(--grad-[a-z-]+\)$/);
  const aurora = src("styles/aurora.css");
  for (const g of all) assert.ok(aurora.includes(g.slice(4, -1) + ":"), `token ${g} exists in aurora.css`);
});

test("AgentCard shows the uploaded avatar and falls back to initial + gradient when it breaks", () => {
  const card = src("addons/conversation/components/AgentCard.vue");
  assert.match(card, /<img[^>]*v-if="avatarOk"[^>]*@error="avatarOk = false"/s);
  assert.match(card, /avatarGradient\(agent\.templateId\)/);
  assert.match(card, /data-testid="agent-card-start"/);
  assert.match(card, /v-if="admin"/, "edit is admin-only");
});

test("AgentList: states, collapse, search and admin-only entries", () => {
  const view = src("addons/conversation/views/AgentList.vue");
  assert.match(view, /can\("core:admin:read"\)/, "admin = existing core:admin:read capability");
  for (const id of ["agent-list-skeleton", "agent-list-error", "agent-list-retry", "agent-list-empty", "agent-list-search",
    "agent-list-active", "agent-list-inactive", "agent-list-inactive-toggle", "agent-list-help"]) {
    assert.ok(view.includes(`data-testid="${id}"`), id);
  }
  assert.match(view, /v-if="admin"[^>]*data-testid="agent-list-admin"/s, "management/import only for admins");
  assert.match(view, /showInactive = ref\(false\)/, "disabled group collapsed by default");
  assert.match(view, /prefers-reduced-motion/);
  for (const key of ["eyebrow", "help", "searchPlaceholder", "groupActive", "groupInactive", "loadError", "retry", "emptyTitle",
    "emptyAdmin", "emptyUser", "start", "history", "neverUsed", "noDescription", "unconfigured", "manage", "importRecommended"]) {
    assert.match(src("i18n/zh.ts"), new RegExp(`\\b${key}:`), `zh ${key}`);
    assert.match(src("i18n/en.ts"), new RegExp(`\\b${key}:`), `en ${key}`);
  }
});

test("AgentInstance focuses the new-session input on entry", () => {
  assert.match(src("addons/conversation/views/AgentInstance.vue"), /\.focus\(/);
});
