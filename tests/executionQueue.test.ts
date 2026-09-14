import assert from "node:assert/strict";
import test from "node:test";
import { messageTimingData } from "../src/addons/conversation/composables/conversationTiming.ts";
import { executionTimings } from "../src/addons/conversation/task-conversation/vue/executionTiming.ts";
import { executionPhaseLabel, isExecutionPhaseData } from "../src/addons/conversation/task-conversation/vue/executionPhasePresentation.ts";
import { ensureDirectReplyProcessItems, groupContiguousProcessItems, orderTurnItemsForDisplay, processItemForDisplay, resolveProcessStepDurationMs } from "../src/addons/conversation/task-conversation/vue/processPresentation.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";
import type { Message } from "../src/addons/conversation/api/types.ts";

const at = (ms: number) => new Date(Date.UTC(2026, 8, 8) + ms).toISOString();
const row = (id: string, ms: number, fields: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "process", role: "system", kind: "status",
  content: "", status: "complete", revision: 1, seq: 1, timestamp: at(ms), ...fields,
});
const user = (id: string, ms: number) => row(id, ms, { role: "user", lane: "answer", kind: "text", content: "hello" });
const queue = (id: string, ms: number, state: string, duration?: number, step = "s1") => row(id, ms, {
  status: state === "running" ? "streaming" : "complete",
  data: { executionPhase: "execution_queue", phaseStatus: state, phaseDurationMs: duration, runStepId: step },
});
const response = (ms: number) => row("answer", ms, {
  role: "assistant", lane: "answer", kind: "result", content: "done", data: { runStepId: "s1" },
});

test("queue metadata preserves validated position, reason, ownership and fixed duration", () => {
  const message = { senderType: "system", msgType: "status", metadata: {
    step_id: "s1", execution_phase: "execution_queue", phase_status: "completed", duration_ms: 12_345,
    queue_position: 3, queue_reason: "executor_capacity",
  } } as Message;
  assert.deepEqual(messageTimingData(message), {
    mainRun: true, runTerminal: false, runStepId: "s1", executionPhase: "execution_queue",
    phaseStatus: "completed", phaseDurationMs: 12_345, queuePosition: 3, queueReason: "executor_capacity",
  });
  for (const invalid of [0, -1, 1.2, "3", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const data = messageTimingData({ ...message, metadata: { ...message.metadata, queue_position: invalid } });
    assert.equal(data.queuePosition, undefined);
  }
  assert.equal(messageTimingData({ ...message, metadata: { ...message.metadata, queue_reason: "untrusted" } }).queueReason, undefined);
  assert.equal(messageTimingData({ ...message, metadata: { ...message.metadata, queue_reason: "executor_unavailable" } }).queueReason, "executor_unavailable");
  assert.equal(messageTimingData({ ...message, metadata: { ...message.metadata, execution_phase: "agent_initialization" } }).queuePosition, undefined);
});

test("queue labels and position stay inside the process row without duplicate timers", () => {
  const active = { ...queue("queue", 100, "running"), content: "已等待 99 秒", data: { ...queue("queue", 100, "running").data, queuePosition: 3 } };
  assert.equal(processItemForDisplay(active, "zh-CN").content, "前面还有 2 个请求");
  assert.equal(processItemForDisplay(active, "en-US").content, "2 requests ahead");
  assert.equal(processItemForDisplay({ ...active, data: { ...active.data, queuePosition: 2 } }, "en-US").content, "1 request ahead");
  assert.equal(processItemForDisplay({ ...active, data: { ...active.data, queuePosition: 1 } }, "zh-CN").content, "前面还有 0 个请求");
  assert.equal(processItemForDisplay({ ...active, data: { ...active.data, queuePosition: undefined } }, "zh-CN").content, "");
  assert.equal(processItemForDisplay({ ...active, status: "cancelled", data: { ...active.data, phaseStatus: "cancelled" } }, "zh-CN").content, "");
  for (const [state, zh, en] of [
    ["running", "排队等待", "Queued"], ["completed", "排队等待", "Queued"],
    ["cancelled", "排队已取消", "Queue cancelled"], ["failed", "排队失败", "Queue failed"],
    ["unavailable", "排队耗时未知", "Queue duration unavailable"],
  ]) {
    assert.equal(executionPhaseLabel({ executionPhase: "execution_queue", phaseStatus: state }, "zh-CN"), zh);
    assert.equal(executionPhaseLabel({ executionPhase: "execution_queue", phaseStatus: state }, "en-US"), en);
  }
  assert.equal(isExecutionPhaseData(active.data), true);
  assert.equal(isExecutionPhaseData(), false);
  assert.equal(executionPhaseLabel({}, "zh-CN"), undefined);
  assert.equal(active.content, "已等待 99 秒", "presentation does not mutate transport state");
  assert.equal(processItemForDisplay({ ...active, data: { ...active.data, queuePosition: "3" } }, "zh-CN").content, "");
  assert.equal(processItemForDisplay({ ...active, data: { ...active.data, queuePosition: 0 } }, "zh-CN").content, "");
});

test("initialization labels keep their native boundary independently of queue presentation", () => {
  for (const [state, zh, en] of [
    ["running", "Agent 初始化中", "Initializing agent"], ["completed", "Agent 初始化", "Agent initialization"],
    ["cancelled", "Agent 初始化已取消", "Agent initialization cancelled"],
    ["failed", "Agent 初始化失败", "Agent initialization failed"],
    ["unavailable", "Agent 初始化耗时未知", "Agent init duration unavailable"],
  ]) {
    const data = { executionPhase: "agent_initialization", phaseStatus: state };
    assert.equal(executionPhaseLabel(data, "zh-CN"), zh);
    assert.equal(executionPhaseLabel(data, "en-US"), en);
  }
  const ready = { executionPhase: "agent_initialization", phaseStatus: "completed", phaseBoundary: "opencode_prompt_accepted" };
  assert.equal(executionPhaseLabel(ready, "zh-CN"), "OpenCode 准备");
  assert.equal(executionPhaseLabel(ready, "en-US"), "OpenCode ready");
});

test("queued requests have independent clocks while the main bubble includes the whole wait", () => {
  const waiting = [user("u", 0), queue("q", 100, "running")];
  const live = executionTimings(waiting, { nowMs: Date.parse(at(5100)), status: "running" }).get("u")!;
  assert.equal(live.totalMs, 5100);
  assert.equal(live.queueMs, 5000);
  assert.equal(live.queued, true);
  assert.equal(live.agentInitializing, false);
  assert.equal(live.agentInitializationMs, undefined);
  const init = row("init", 5100, { data: { executionPhase: "agent_initialization", phaseStatus: "completed", phaseDurationMs: 300, runStepId: "s1" } });
  const complete = [user("u", 0), queue("q", 100, "completed", 5000), init, response(9000)];
  const settled = executionTimings(complete, { nowMs: Date.parse(at(900_000)), status: "completed" }).get("u")!;
  assert.equal(settled.totalMs, 9000);
  assert.equal(settled.queueMs, 5000);
  assert.equal(settled.queued, false);
  assert.equal(settled.agentInitializationMs, 300);
  assert.deepEqual(executionTimings(complete, { nowMs: Date.parse(at(9_000_000)), status: "completed" }).get("u"), settled);
  const cancelled = executionTimings([user("u", 0), queue("q", 100, "cancelled", 2500)], {
    nowMs: Date.parse(at(999_999)), status: "cancelled", stoppedAt: at(2600),
  }).get("u")!;
  assert.equal(cancelled.totalMs, 2600);
  assert.equal(cancelled.queueMs, 2500);
  assert.equal(cancelled.queued, false);
});

test("late queue updates never become the next submission's initialization or clock", () => {
  const rows = [user("u1", 0), queue("q1", 100, "completed", 2000), response(9000),
    user("u2", 10000), queue("late-q1", 10100, "running"), queue("q2", 10200, "running", undefined, "s2")];
  const clocks = executionTimings(rows, { nowMs: Date.parse(at(12000)), status: "running" });
  assert.equal(clocks.get("u1")?.queueMs, 2000);
  assert.equal(clocks.get("u2")?.queueMs, 1800);
  assert.equal(clocks.get("u2")?.totalMs, 2000);
  assert.equal(executionTimings([user("different-conversation", 0)], { nowMs: Date.parse(at(12000)), status: "running" }).get("different-conversation")?.queueMs, undefined);
});

test("queue and initialization remain separate child bubbles before response work", () => {
  const u = user("u", 0), q = queue("q", 100, "completed", 5000);
  const init = row("init", 5100, { data: { executionPhase: "agent_initialization", phaseStatus: "completed", phaseDurationMs: 300 } });
  const thinking = row("thinking", 5400, { role: "assistant", data: { thinking: true } });
  const ordered = orderTurnItemsForDisplay([u, thinking, init, q, response(9000)]);
  assert.deepEqual(ordered.map(item => item.id), ["u", "q", "init", "thinking", "answer"]);
  assert.deepEqual(groupContiguousProcessItems(ordered).map(group => group.map(item => item.id)), [["q", "init", "thinking"]]);
  const fallback = { title: "思考过程", responseTitle: "模型响应", content: "直接回复" };
  const direct = ensureDirectReplyProcessItems([u, q, response(9000)], fallback);
  assert.equal(direct[2]?.title, "模型响应");
  assert.equal(direct[2]?.timestamp, at(5100), "queue time must not become model response time");
  assert.equal(resolveProcessStepDurationMs({ startedAt: direct[2]!.timestamp, endedAt: at(9000), nowMs: 0, status: "complete" }), 3900);
  const both = ensureDirectReplyProcessItems([u, q, init, response(9000)], fallback);
  assert.equal(both[3]?.timestamp, at(5400));
  const unknown = ensureDirectReplyProcessItems([u, queue("q", 100, "unavailable"), response(9000)], fallback);
  assert.equal(unknown[2]?.data?.durationUnavailable, true);
});
