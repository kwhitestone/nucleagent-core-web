import assert from "node:assert/strict";
import { test } from "node:test";
import zh from "../src/i18n/zh.ts";
import en from "../src/i18n/en.ts";
import { messages } from "../src/addons/administration/agents/definition/messages.ts";

// The unavailable label sits on every held catalog row (0e68bd9), picked or not; it must not tell the
// user to untick a row they never ticked (PROD: 286/286 held tools all read "不可用，保存时请取消").
test("the tool unavailable label states the fact without an untick instruction", () => {
  for (const label of [zh.agents.mine.bindingUnavailable, en.agents.mine.bindingUnavailable, ...messages.toolUnavailable]) {
    assert.doesNotMatch(label, /取消|untick/i, label);
    assert.match(label, /不可用|unavailable/i);
  }
});
