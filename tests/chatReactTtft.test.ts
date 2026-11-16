import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatReadout, ttftReadout } from "../src/chat-react/ttft.ts";
import { messageTimingData } from "../src/addons/conversation/composables/conversationTiming.ts";
import type { ExecutionTiming } from "../src/addons/conversation/task-conversation/vue/executionTiming.ts";

// Conversation 1351 (TEST, 2026-11-16) server_timing v2, verbatim; turn 4 is the aihub 401.
const v2 = (over: Record<string, unknown> = {}) => ({
  version: 2, run_return_ms: 3670, agent_ready_ms: 789, thread_ready_ms: 724, first_body_event_ms: 2495,
  first_body_write_ms: 2495, runtime_acquired_ms: 4, first_model_event_ms: 2495, receive_to_accept_ms: 0,
  application_generation: "533dc917f9e78f46362eadb1e7151aaf", attachments_prepared_ms: 547, first_body_write_outcome: "written", ...over,
});
const turn401 = v2({ run_return_ms: 18949, agent_ready_ms: 1108, first_body_event_ms: -1, first_body_write_ms: -1, first_model_event_ms: -1, attachments_prepared_ms: 624, first_body_write_outcome: "missing" });
const v4 = (over: Record<string, unknown> = {}) => ({
  ...v2(), version: 4, environment_ready_ms: 30, skills_projected_ms: 200, attachments_prepared_ms: 547,
  upstream_received_ms: 900, upstream_forwarded_ms: 910, upstream_headers_ms: 1500, upstream_first_byte_ms: 1600,
  upstream_first_thinking_ms: -1, upstream_first_body_ms: 2310, ...over,
});
const timing = (over: Partial<ExecutionTiming> = {}): ExecutionTiming => ({
  totalMs: 3700, queueMs: 40, agentInitializationMs: 800, queued: false, agentInitializing: false, active: false, awaitingResponse: false, ...over,
});
const zh: Record<string, string> = { firstToken: "首字", queue: "排队", upload: "上传附件", agentReady: "Agent 就绪", upstreamFirst: "上游首字", sec: " 秒", approx: "约 ", serverMeasured: "服务端计" };
const t = (key: string) => zh[key.replace("chatReact.", "")] ?? key;

test("default path only passes server_timing through, verbatim, and omits the key when absent", () => {
  const msg = (metadata?: Record<string, unknown>) => ({ id: 1, conversationId: 1351, senderType: "agent" as const, senderName: "agent", msgType: "result" as const, content: "ok", createdAt: "2026-11-16T01:53:00Z", metadata });
  assert.deepEqual(messageTimingData(msg({ step_id: "s", server_timing: turn401 })).serverTiming, turn401);
  assert.equal("serverTiming" in messageTimingData(msg({ step_id: "s" })), false, "snapshot schema rejects undefined values");
  assert.equal("serverTiming" in messageTimingData(msg({ server_timing: "v2" })), false, "non-object is dropped");
});

test("v2 written: server first token = queue + first_body_write_ms; agent ready from Core; v2 never shows upload", () => {
  const r = ttftReadout(v2(), timing(), true)!;
  assert.deepEqual(r, { firstMs: 2535, firstSource: "server", queueMs: 40, agentMs: 800 });
  const f = formatReadout(r, t);
  assert.equal(f.head, "首字 2.5 秒");
  assert.equal(f.detail, "排队 0.0 秒 · Agent 就绪 0.8 秒 · 首字 2.5 秒（服务端计）");
});

test("401 turn (outcome missing, -1): first token is — and never 0; head falls back to total only", () => {
  const r = ttftReadout(turn401, timing({ totalMs: 19000, queueMs: 0, agentInitializationMs: 1100 }), true)!;
  assert.equal(r.firstMs, undefined);
  const f = formatReadout(r, t);
  assert.equal(f.head, "");
  assert.equal(f.detail, "排队 0.0 秒 · Agent 就绪 1.1 秒 · 首字 —");
  assert.doesNotMatch(f.detail, /首字 0/);
});

test("v4: upload = attachments − skills (only with attachments), upstream first body row appears", () => {
  const r = ttftReadout(v4(), timing(), true)!;
  assert.equal(r.uploadMs, 347);
  assert.equal(r.upstreamMs, 1400);
  assert.equal(formatReadout(r, t).detail, "排队 0.0 秒 · 上传附件 0.3 秒 · Agent 就绪 0.8 秒 · 首字 2.5 秒（服务端计） · 上游首字 1.4 秒");
  assert.equal(ttftReadout(v4(), timing(), false)!.uploadMs, undefined, "no attachment → no upload item");
  assert.equal(ttftReadout(v4({ upstream_first_body_ms: -1 }), timing(), true)!.upstreamMs, undefined, "-1 hides the row, not 0");
  assert.equal(ttftReadout(v4({ skills_projected_ms: -1 }), timing(), true)!.uploadMs, undefined);
});

test("missing Core phases show — (not 0); agent ready falls back to server agent_ready_ms", () => {
  const r = ttftReadout(v2(), timing({ queueMs: undefined, agentInitializationMs: undefined }), false)!;
  assert.equal(r.agentMs, 789);
  assert.equal(r.firstMs, 2495, "no queue → executor-only first token");
  assert.match(formatReadout(r, t).detail, /^排队 — · Agent 就绪 0\.8 秒/);
  assert.match(formatReadout(ttftReadout(v2({ agent_ready_ms: -1 }), timing({ agentInitializationMs: undefined }), false)!, t).detail, /Agent 就绪 —/);
});

test("no server_timing: streaming uses Core waitingMs marked 约; final-only history shows —", () => {
  const live = ttftReadout(undefined, timing({ active: true, waitingMs: 1800, totalMs: 2500 }), false)!;
  assert.deepEqual([live.firstMs, live.firstSource], [1800, "client"]);
  assert.equal(formatReadout(live, t).head, "首字 约 1.8 秒");
  assert.equal(ttftReadout(undefined, timing({ active: true, awaitingResponse: true, waitingMs: 2500 }), false)!.firstMs, undefined, "still waiting is not a first token");
  assert.equal(ttftReadout(undefined, timing({ waitingMs: undefined }), false)!.firstMs, undefined);
  assert.equal(ttftReadout({ version: 1 }, timing(), false)!.firstMs, undefined, "unknown versions are not trusted");
  assert.equal(ttftReadout(undefined, undefined, false), undefined);
});

test("bundle gate: thresholds unchanged and parsing stays inside the island", () => {
  const gate = readFileSync("scripts/muyu365-bundle-size.mjs", "utf8");
  assert.match(gate, /now\.reactOnly <= 180 \* 1024/);
  assert.match(gate, /now\[key\] - was\[key\] <= 1024/);
  for (const file of ["src/addons/conversation/composables/conversationTiming.ts", "src/addons/conversation/task-conversation/vue/executionTiming.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /ttft|first_body_write/, `${file} stays a raw pass-through`);
  }
  assert.doesNotMatch(readFileSync("src/chat-react/ChatApp.tsx", "utf8"), /首字|First token/, "strings live in the language chunks");
  for (const f of ["src/chat-react/islandStringsZh.ts", "src/chat-react/islandStringsEn.ts"]) {
    assert.match(readFileSync(f, "utf8"), /firstToken:/);
  }
});
