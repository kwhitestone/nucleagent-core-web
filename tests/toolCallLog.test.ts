import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTaskId,
  toolType,
  typeCoverage,
  type ToolCallRow,
  type TypedTool,
} from "../src/addons/administration/views/admin/toolCallLog.ts";

// Row shapes as returned by Core GET /conversation/tool-calls (MUYU-181 PROD tasks 872 DJ ok, 759 DJ failed).
const row = (id: number, taskId: number, tool: string, status: ToolCallRow["status"]): ToolCallRow =>
  ({ id, taskId, taskTitle: "", tool, status, callId: `c${id}`, createdAt: "2026-11-06T06:50:00Z" });
const okCall = [row(2, 872, "nucleagent.agentia-t1", "completed")];
const failedCall = [row(4, 759, "nucleagent.agentia-t1", "failed")];

test("task id is a positive integer or empty; anything else is rejected before a request", () => {
  assert.equal(parseTaskId(undefined), "");
  assert.equal(parseTaskId("  "), "");
  assert.equal(parseTaskId(" 872 "), "872");
  for (const bad of ["0", "-1", "1.5", "abc", "call_ok", "0872", "1".repeat(20), ["1"]]) assert.equal(parseTaskId(bad), null, String(bad));
});

const tools: TypedTool[] = [
  { id: 1, name: "DJ知识库", slug: "agentia-t1", config: { mcp_config: { input_schema: { properties: { question: {}, data: {}, username: {} } } } } },
  { id: 188, name: "SkillForge 历史", slug: "agentia-t2864", config: { description: "列出当前用户在 SkillForge 已锻造的所有 Skill" } },
  { id: 187, name: "SkillForge 取产物", slug: "agentia-t2863", config: { description: "按 sessionId 取当前用户的产物" } },
  { id: 93, name: "火车票", slug: "agentia-t2766", config: { description: "查询12306公开余票" } },
  { id: 318, name: "Leo", slug: "aihub-leo", config: { type: "aihub" } },
  { id: 30, name: "生图", slug: "agentia-t2687", config: { mcp_config: { input_schema: { properties: { app_id: {}, base_url: {} } } } } },
  { id: 43, name: "工作台", slug: "agentia-t2710", config: { mcp_config: { input_schema: { properties: { api_base_url: {}, query: {} } } } } },
  { id: 3, name: "天气", slug: "agentia-t8", config: { mcp_config: { input_schema: { properties: { city: {} } } } } },
];

test("tools are typed by call chain, not by name", () => {
  assert.deepEqual(tools.map(toolType), ["dj", "identity", "identity", "train", "aihub", "workflow", "api", "mcp"]);
});

test("type coverage separates 'represented' from 'every tool called'", () => {
  const identityOk = [row(9, 871, "nucleagent.agentia-t2864", "completed")];
  const rows = [...okCall, ...failedCall, ...identityOk];
  const cov = Object.fromEntries(typeCoverage(tools, rows).map((c) => [c.type, c]));
  assert.equal(cov.identity.represented, true);
  assert.equal(cov.identity.total, 2);
  assert.equal(cov.identity.calledOk, 1, "only 188 was really called; 187 must not count");
  assert.equal(cov.dj.represented, true);
  assert.equal(cov.dj.representative?.taskId, 872, "the failed DJ call is not the representative");
  assert.equal(cov.aihub.represented, false);
  // A type whose only call failed stays unverified.
  const failOnly = Object.fromEntries(typeCoverage(tools, failedCall).map((c) => [c.type, c]));
  assert.equal(failOnly.dj.represented, false);
  assert.equal(failOnly.dj.calledOk, 0);
});

test("a completed call that returned a business error does not verify its type", () => {
  const wf = { ...row(10, 877, "nucleagent.agentia-t2687", "completed"), error: "unexpected status 403 Forbidden" };
  const cov = Object.fromEntries(typeCoverage(tools, [wf]).map((c) => [c.type, c]));
  assert.equal(cov.workflow.represented, false);
  assert.equal(cov.workflow.calledOk, 0);
});
