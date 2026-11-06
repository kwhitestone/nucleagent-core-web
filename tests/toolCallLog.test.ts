import assert from "node:assert/strict";
import test from "node:test";

import {
  errorReason,
  extractToolCalls,
  redact,
  toolType,
  toolsCalled,
  typeCoverage,
  type TypedTool,
} from "../src/addons/administration/views/admin/toolCallLog.ts";

// Shapes copied from MUYU-181 PROD conversations 872 (DJ ok), 759 (DJ failed), 876 (token in result).
const msg = (id: number, msgType: string, content: string, metadata: Record<string, unknown>, senderName = "agent") =>
  ({ id, conversationId: 1, senderType: "agent", senderName, msgType, content, metadata, createdAt: `2026-11-06T06:5${id % 10}:00Z` }) as any;

const okCall = [
  msg(1, "text", "question", {}, "user"),
  msg(2, "tool_call", "使用工具完成 · 53.4 秒", { tool: "nucleagent.agentia-t1", step_id: "s1", duration_ms: 53380, tool_status: "completed", tool_call_id: "call_ok" }),
  msg(3, "result", '[{"type":"text","text":"{\\"status\\":\\"completed\\",\\"answer\\":\\"知识库内容\\"}"}]', { step_id: "s1" }),
];
const failedCall = [
  msg(4, "tool_call", "使用工具失败 · 0.0 秒", { tool: "nucleagent.agentia-t1", step_id: "s2", duration_ms: 34, tool_status: "failed", tool_call_id: "call_bad" }),
  msg(5, "result", 'tool call error: tool call failed for `nucleagent/agentia-t1`\n\nCaused by:\n    Mcp error: -32602: mcp upstream unavailable({"error_class":"rpc_error"})', { step_id: "s2" }),
];
const tokenCall = [
  msg(6, "tool_call", "使用工具完成 · 2.4 秒", { tool: "nucleagent.agentia-t2710", step_id: "s3", duration_ms: 2341, tool_status: "completed", tool_call_id: "call_tok" }),
  msg(7, "result", '{"homepageUrl": "https://w.example/52?token=c845d88b8fc975c22327ae6b0bc4ebe199eedb290945f13f0d35c6d3fb040335&lang=zh"}', { step_id: "s3" }),
];

test("extracts one row per real tool call with status, duration, ids and result", () => {
  const rows = extractToolCalls(872, "DJ", okCall);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "completed");
  assert.equal(rows[0].durationMs, 53380);
  assert.equal(rows[0].callId, "call_ok");
  assert.equal(rows[0].conversationId, 872);
  assert.match(rows[0].summary, /知识库内容/);
  assert.equal(rows[0].error, "");
});

test("a failed call is never reported as success and carries the error reason", () => {
  const [row] = extractToolCalls(759, "DJ", failedCall);
  assert.equal(row.status, "failed");
  assert.equal(row.summary, "");
  assert.match(row.error, /Mcp error: -32602: mcp upstream unavailable/);
  assert.deepEqual(toolsCalled([row]), [{ tool: "nucleagent.agentia-t1", completed: 0, failed: 1 }]);
});

test("tool_call rows without a tool_call_id (process notes) are skipped", () => {
  assert.deepEqual(extractToolCalls(1, "", [msg(8, "tool_call", "x", { tool: "codex.plan" })]), []);
});

test("credential-shaped values are masked in summaries", () => {
  const [row] = extractToolCalls(876, "PD", tokenCall);
  assert.doesNotMatch(row.summary, /c845d88b/);
  assert.match(row.summary, /token=\*\*\*&lang=zh/);
  assert.equal(redact("Authorization: Bearer abcdefghijklmnop"), "Authorization: Bearer ***");
  assert.equal(redact('{"data":"forged-uc-token","q":"x"}'), '{"data":"***","q":"x"}');
  assert.equal(errorReason("all good"), "");
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
  const identityOk = extractToolCalls(871, "SF", [
    msg(9, "tool_call", "ok", { tool: "nucleagent.agentia-t2864", tool_status: "completed", tool_call_id: "c9" }),
  ]);
  const rows = [...extractToolCalls(872, "DJ", okCall), ...extractToolCalls(759, "DJ", failedCall), ...identityOk];
  const cov = Object.fromEntries(typeCoverage(tools, rows).map((c) => [c.type, c]));
  assert.equal(cov.identity.represented, true);
  assert.equal(cov.identity.total, 2);
  assert.equal(cov.identity.calledOk, 1, "only 188 was really called; 187 must not count");
  assert.equal(cov.dj.represented, true);
  assert.equal(cov.dj.representative?.conversationId, 872, "the failed DJ call is not the representative");
  assert.equal(cov.aihub.represented, false);
  // A type whose only call failed stays unverified.
  const failOnly = Object.fromEntries(typeCoverage(tools, extractToolCalls(759, "DJ", failedCall)).map((c) => [c.type, c]));
  assert.equal(failOnly.dj.represented, false);
  assert.equal(failOnly.dj.calledOk, 0);
});
