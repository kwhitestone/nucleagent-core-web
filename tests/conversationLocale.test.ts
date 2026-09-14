import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveMessages } from "../src/addons/conversation/task-conversation/vue/messages.ts";

test("conversation view forwards the reactive shell locale to its task component", () => {
  const source = readFileSync(new URL("../src/addons/conversation/views/Conversation.vue", import.meta.url), "utf8");
  assert.match(source, /const\s*\{\s*t,\s*locale\s*\}\s*=\s*useI18n\(\)/);
  assert.match(source, /:locale="locale === 'en' \? 'en-US' : 'zh-CN'"/);
  assert.doesNotMatch(source, /\slocale="zh-CN"/);
  assert.equal(resolveMessages("en-US").send, "Send");
  assert.equal(resolveMessages("en-US").process, "Execution process");
  assert.equal(resolveMessages("zh-CN").send, "发送");
});
