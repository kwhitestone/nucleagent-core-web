import assert from "node:assert/strict";
import { test } from "node:test";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";

test("Chinese generation picker uses generation tools terminology", () => {
  assert.equal(ZH_STRINGS.workflow, "生成工具");
});

test("English generation picker uses generation tools terminology", () => {
  assert.equal(EN_STRINGS.workflow, "Generation tools");
});
