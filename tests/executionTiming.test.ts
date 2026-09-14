import assert from "node:assert/strict";
import test from "node:test";
import {
  executionTimingLabel,
  executionTimings,
} from "../src/addons/conversation/task-conversation/vue/executionTiming.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

const at = (ms: number) => new Date(Date.UTC(2026, 8, 7) + ms).toISOString();
const item = (id: string, ms: number, fields: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "process", role: "assistant",
  kind: "plan", content: "visible", status: "complete", revision: 1, seq: 1,
  timestamp: at(ms), ...fields,
});
const user = (id: string, ms: number) => item(id, ms, { role: "user", lane: "answer", kind: "text" });
const result = (id: string, ms: number, data = {}) => item(id, ms, { lane: "answer", kind: "result", data });
const agentInitialization = (id: string, ms: number, status: string, durationMs?: number, estimated = false) =>
  item(id, ms, { role: "system", kind: "status", content: "", data: {
    runStepId: "step", executionPhase: "agent_initialization", phaseStatus: status,
    ...(durationMs === undefined ? {} : { phaseDurationMs: durationMs }),
    ...(estimated ? { phaseDurationEstimated: true } : {}),
  } });

test("agent initialization is timed separately from model waiting and total runtime", () => {
  const running = [user("u", 0), agentInitialization("init", 100, "running")];
  const live = executionTimings(running, { nowMs: Date.parse(at(2100)), status: "running" }).get("u")!;
  assert.equal(live.agentInitializing, true);
  assert.equal(live.agentInitializationMs, 2000);
  assert.equal(live.totalMs, 2100);

  const completed = [user("u", 0), agentInitialization("init", 100, "completed", 2456), item("plan", 19317), result("done", 40604)];
  const settled = executionTimings(completed, { nowMs: Date.parse(at(90000)), status: "completed" }).get("u")!;
  assert.equal(settled.agentInitializing, false);
  assert.equal(settled.agentInitializationMs, 2456);
  assert.equal(settled.waitingMs, 19317);
  assert.equal(settled.totalMs, 40604);

  const cancelled = executionTimings(
    [user("cancelled-user", 0), agentInitialization("cancelled-init", 100, "cancelled", 2400, true)],
    { nowMs: Date.parse(at(3000)), status: "cancelled", stoppedAt: at(2500) },
  ).get("cancelled-user")!;
  assert.equal(cancelled.agentInitializationMs, 2400);
  assert.equal(cancelled.agentInitializationEstimated, true);
});

test("main bubble timing includes the full wait and freezes on completion", () => {
  const active = executionTimings(
    [user("u", 0), item("thinking", 100, { status: "streaming", data: { thinking: true } })],
    { nowMs: Date.parse(at(3_786_900)), status: "running" },
  ).get("u")!;
  assert.equal(active.totalMs, 3_786_900);
  assert.equal(executionTimingLabel(active, "zh-CN"), "已用 3786.9 秒");
  assert.equal(executionTimingLabel(active, "en-US"), "Elapsed 3786.9s");

  const settled = executionTimings(
    [user("u", 0), result("done", 3_300)],
    { nowMs: Date.parse(at(9_000)), status: "completed" },
  ).get("u")!;
  assert.equal(executionTimingLabel(settled, "zh-CN"), "总耗时 3.3 秒");
  assert.equal(executionTimingLabel(settled, "en-US"), "Total time 3.3s");
});

test("482 history includes startup and model gaps, independently of rounded tool time", () => {
  const rows = [user("u", 0), item("plan", 19317),
    ...[19808, 25462, 28404, 31052, 33117].map((ms, i) => item(`tool${i}`, ms, {
      role: "tool", kind: "tool_call", data: { durationMs: [32, 48, 32, 67, 56][i] },
    })), result("done", 40604)];
  const timing = executionTimings(rows, { nowMs: Date.parse(at(999999)), status: "completed" }).get("u")!;
  assert.equal(timing.totalMs, 40604);
  assert.equal(timing.waitingMs, 19317);
  assert.equal(timing.active, false);
  assert.equal(rows[2]?.data?.durationMs, 32);
  assert.deepEqual(executionTimings(rows, { nowMs: Date.parse(at(1999999)), status: "completed" }).get("u"), timing);
});

test("accepted user with no process rows visibly waits and clock keeps advancing", () => {
  const rows = [user("u", 1000)];
  for (const ms of [1500, 21000]) {
    const timing = executionTimings(rows, { nowMs: Date.parse(at(ms)), status: "running" }).get("u")!;
    assert.equal(timing.totalMs, ms - 1000);
    assert.equal(timing.waitingMs, ms - 1000);
    assert.equal(timing.awaitingResponse, true);
  }
  assert.equal(executionTimings([], { nowMs: 0, status: "running" }).size, 0);
});

test("replaceable heartbeat and empty delta do not end first-response waiting", () => {
  const rows = [user("u", 0), item("heartbeat", 100, { status: "streaming", data: { thinkingStatus: true } }),
    item("empty", 200, { content: "", status: "streaming" })];
  assert.equal(executionTimings(rows, { nowMs: Date.parse(at(20000)), status: "running" }).get("u")?.waitingMs, 20000);
  assert.equal(executionTimings([...rows, item("tool", 20100, { role: "tool", kind: "tool_call" })],
    { nowMs: Date.parse(at(23000)), status: "running" }).get("u")?.waitingMs, 20100);
});

test("tool-only runs count gaps once and parallel tools never add to total", () => {
  const rows = [user("u", 0), item("tool-a", 20000, { role: "tool", kind: "tool_call", data: { durationMs: 15000 } }),
    item("tool-b", 20000, { role: "tool", kind: "tool_call", data: { durationMs: 15000 } }), result("done", 40000)];
  assert.equal(executionTimings(rows, { nowMs: Date.parse(at(90000)), status: "completed" }).get("u")?.totalMs, 40000);
});

test("follow-ups start at their own user and late old-step results cannot settle the new run", () => {
  const rows = [user("u1", 0), item("p1", 1000, { data: { runStepId: "one" } }), result("r1", 3000, { runStepId: "one" }),
    user("u2", 60000), result("late", 61000, { runStepId: "one" }), item("p2", 65000, { data: { runStepId: "two" } })];
  const timings = executionTimings(rows, { nowMs: Date.parse(at(70000)), status: "running" });
  assert.equal(timings.get("u1")?.totalMs, 3000);
  assert.equal(timings.get("u2")?.totalMs, 10000);
  assert.equal(timings.get("u2")?.waitingMs, 5000);
  assert.equal(timings.get("u2")?.active, true);
});

test("child-agent output cannot terminate the main run and clarify response is not a new run", () => {
  const rows = [user("u", 0), item("p", 1000, { data: { runStepId: "main-step" } }),
    result("child", 2000, { mainRun: false, runTerminal: false, runStepId: "child-step" }),
    item("clarify", 4000, { role: "user", data: { clarifyResponse: true } }), result("done", 9000, { runStepId: "main-step" })];
  const timings = executionTimings(rows, { nowMs: Date.parse(at(20000)), status: "completed" });
  assert.deepEqual([...timings.keys()], ["u"]);
  assert.equal(timings.get("u")?.totalMs, 9000);
});

test("different turn IDs and separate conversation calls never share timing state", () => {
  const rows = [user("u", 0), item("foreign", 500, { turnId: "parallel", kind: "result", lane: "answer" }), result("done", 9000)];
  assert.equal(executionTimings(rows, { nowMs: Date.parse(at(20000)), status: "completed" }).get("u")?.totalMs, 9000);
  assert.equal(executionTimings([user("u", 15000)], { nowMs: Date.parse(at(20000)), status: "running" }).get("u")?.totalMs, 5000);
});

test("failure and cancellation stop clocks, including cancellation before any native row", () => {
  const failed = [user("u", 0), item("err", 2500, { role: "system", lane: "system", kind: "error", status: "failed" })];
  assert.equal(executionTimings(failed, { nowMs: Date.parse(at(20000)), status: "failed" }).get("u")?.totalMs, 2500);
  const cancelled = [user("u", 0)];
  for (const now of [10000, 90000]) {
    const timing = executionTimings(cancelled, { nowMs: Date.parse(at(now)), status: "cancelled", stoppedAt: at(4000) }).get("u")!;
    assert.equal(timing.totalMs, 4000);
    assert.equal(timing.active, false);
  }
  const restored = [{ ...cancelled[0]!, data: { runStoppedAt: at(4000), runStatus: "cancelled" } }];
  assert.equal(executionTimings(restored, { nowMs: Date.parse(at(90000)), status: "cancelled" }).get("u")?.totalMs, 4000);
});

test("missing endpoints and invalid timestamps do not manufacture historic elapsed time", () => {
  const incomplete = [user("u1", 0), user("u2", 10000), result("done", 15000)];
  const timings = executionTimings(incomplete, { nowMs: Date.parse(at(90000)), status: "completed" });
  assert.equal(timings.get("u1")?.totalMs, undefined);
  assert.equal(timings.get("u2")?.totalMs, 5000);
  assert.equal(executionTimings([{ ...user("bad", 0), timestamp: "invalid" }], { nowMs: 0, status: "running" }).size, 0);
});
