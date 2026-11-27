import assert from "node:assert/strict";
import { test } from "node:test";
import { skillProcess } from "../src/addons/conversation/composables/skillProcess.ts";
import type { Message } from "../src/addons/conversation/api/types.ts";

const row = (senderName: string, metadata?: Record<string, unknown>) => ({ senderName, metadata, msgType: "status", content: "已自动选用技能：图片" }) as Message;

test("existing match rows need no new fields; future fields do not change their explanation", () => {
  for (const metadata of [undefined, { outcome: "chosen" }, { dispatch_mode: "parallel", effective_turn: "next", future_field: 42 }]) {
    assert.equal(skillProcess(row("agent.skill_match", metadata))?.content, "已自动选用技能：图片");
  }
  for (const outcome of ["failed", "not_written", "timeout"]) assert.equal(skillProcess(row("agent.skill_match", { outcome }))?.failed, true);
  assert.equal(skillProcess(row("agent.skill_match", { outcome: "empty" }))?.failed, false);
});

test("intent gate exposes only user-facing decisions; diagnostics and unrelated status stay hidden", () => {
  assert.equal(skillProcess(row("agent.skill_intent", { role: "probe", need: "tool" })), undefined);
  assert.equal(skillProcess(row("agent.other")), undefined);
  assert.equal(skillProcess({ ...row("agent.skill_match"), msgType: "text" }), undefined);
  assert.match(skillProcess(row("agent.skill_intent", { need: "none" }))!.content, /无需/);
  assert.match(skillProcess(row("agent.skill_intent", { need: "keep" }))!.content, /沿用/);
  const failure = skillProcess(row("agent.skill_intent", { role: "gate", need: "", error: "private upstream detail", model: "private-model" }))!;
  assert.equal(failure.failed, true);
  assert.doesNotMatch(failure.content, /private/);
});
