import assert from "node:assert/strict";
import { test } from "node:test";
import { skillProcess } from "../src/addons/conversation/composables/skillProcess.ts";
import { messageTimingData } from "../src/addons/conversation/composables/conversationTiming.ts";
import { executionTimings } from "../src/addons/conversation/task-conversation/vue/executionTiming.ts";
import { ttftReadout, formatReadout } from "../src/chat-react/ttft.ts";
import type { Message } from "../src/addons/conversation/api/types.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

const progress = (status: string) => ({
  senderName: "agent.skill_progress", senderType: "system", msgType: "status",
  content: "正在检索适用技能", metadata: { step_id: "step", phase_status: status, first_progress_ms: 25, duration_ms: 3100 },
}) as Message;

test("real skill progress renders independently of assistant output", () => {
  assert.equal(skillProcess(progress("running"))?.content, "正在检索适用技能");
  assert.equal(skillProcess(progress("running"))?.running, true);
  assert.equal(skillProcess(progress("completed"))?.running, false);
  assert.equal(skillProcess(progress("failed"))?.failed, true);
  const data = messageTimingData(progress("completed"));
  assert.equal(data.skillProgressMs, 25);
  assert.equal(data.skillPreparationMs, 3100);
  assert.equal(data.mainRun, false);
  assert.equal(data.runTerminal, false);
});

test("progress arrives first but never satisfies first model output timing", () => {
  const at = (offset: number) => new Date(1800000000000 + offset).toISOString();
  const item = (id: string, offset: number, fields: Partial<ConversationItem>) => ({
    id, turnId: "main", streamId: id, lane: "process", role: "system", kind: "status", content: "", status: "complete", revision: 1, seq: 1, timestamp: at(offset), ...fields,
  }) as ConversationItem;
  const items = [
    item("user", 0, { role: "user", kind: "text", content: "画图" }),
    item("progress", 25, { data: messageTimingData(progress("completed")) }),
  ];
  const waiting = executionTimings(items, { nowMs: Date.parse(at(3200)), status: "running" }).get("user")!;
  assert.equal(waiting.awaitingResponse, true);
  assert.equal(waiting.firstProgressMs, 25);
  assert.equal(waiting.skillPreparationMs, 3100);
  const pendingReadout = ttftReadout(undefined, waiting, false)!;
  assert.equal(pendingReadout.firstMs, undefined);
  assert.equal(pendingReadout.progressMs, 25);
  const readout = ttftReadout({ version: 4, first_body_write_outcome: "written", first_body_write_ms: 2000 }, { ...waiting, queueMs: 20 }, false)!;
  assert.equal(readout.firstMs, 5120);
  assert.equal(readout.progressMs, 25);
  assert.match(formatReadout(readout, key => key).detail, /progress/);
});
