import assert from "node:assert/strict";
import { test } from "node:test";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";

// MUYU-365 exp85: tools are agent grants ("工具"); only native audio keeps a user form ("音频工具").
test("Chinese composer names tools as grants and keeps audio as its own form", () => {
  assert.equal(ZH_STRINGS.toolGrant, "工具");
  assert.equal(ZH_STRINGS.toolGrantsEnabled, "已启用工具：");
  assert.equal(ZH_STRINGS.workflow, "音频工具");
  assert.equal(Object.values(ZH_STRINGS).some((value) => /工作流参数|生成工具/.test(value)), false);
});

test("English composer names tools as grants and keeps audio as its own form", () => {
  assert.equal(EN_STRINGS.toolGrant, "Tools");
  assert.equal(EN_STRINGS.workflow, "Audio tools");
  assert.equal(Object.values(EN_STRINGS).some((value) => /workflow parameters|Generation tools/i.test(value)), false);
});
