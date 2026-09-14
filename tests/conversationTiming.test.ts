import assert from "node:assert/strict";
import test from "node:test";
import { messageTimingData, snapshotTiming } from "../src/addons/conversation/composables/conversationTiming.ts";
import type { Message } from "../src/addons/conversation/api/types.ts";

const message = (fields: Partial<Message> = {}): Message => ({
  id: 1, conversationId: 482, senderType: "agent", senderName: "agent",
  msgType: "result", content: "done", createdAt: "2026-09-07T06:06:32.695Z", ...fields,
});

test("main-run ownership and heartbeat identity survive the message adapter", () => {
  assert.deepEqual(messageTimingData(message({ metadata: { step_id: "s1" } })), {
    runStepId: "s1", mainRun: true, runTerminal: true,
  });
  assert.equal(messageTimingData(message({ senderName: "researcher" })).mainRun, false);
  assert.equal(messageTimingData(message({ senderName: "researcher" })).runTerminal, false);
  assert.equal(messageTimingData(message({ senderName: "agent.thinking", msgType: "streaming", metadata: { thinkingStatus: true } })).thinkingStatus, true);
  assert.equal(messageTimingData(message({ senderType: "system", senderName: "system", msgType: "error" })).runTerminal, true);
  assert.equal(messageTimingData(message({ senderType: "user", senderName: "user", msgType: "text", metadata: { clarify_request_id: "q1" } })).clarifyResponse, true);
  assert.deepEqual(messageTimingData(message({ senderType: "system", senderName: "agent.lifecycle.agent_init", msgType: "status", metadata: {
    step_id: "s1", execution_phase: "agent_initialization", phase_status: "completed", phase_boundary: "hermes_message_start", duration_ms: 2456,
    duration_source: "core_wall_clock_cutoff",
  } })), {
    runStepId: "s1", mainRun: true, runTerminal: false,
    executionPhase: "agent_initialization", phaseStatus: "completed",
    phaseBoundary: "hermes_message_start", phaseDurationMs: 2456, phaseDurationEstimated: true,
  });
});

test("a server snapshot supplies waiting status and a stable cancelled endpoint", () => {
  const base = { status: "executing" as const, completedAt: null };
  assert.deepEqual(snapshotTiming(base), { status: "running", stoppedAt: undefined });
  assert.equal(snapshotTiming({ ...base, status: "blocked" }).status, "running");
  assert.equal(snapshotTiming({ ...base, status: "drafting" }).status, "idle");
  assert.deepEqual(snapshotTiming({ status: "cancelled", completedAt: "2026-09-07T06:06:32.614Z" }), {
    status: "cancelled", stoppedAt: "2026-09-07T06:06:32.614Z",
  });
  assert.equal(snapshotTiming({ status: "failed", completedAt: "bad" }).stoppedAt, undefined);
});
