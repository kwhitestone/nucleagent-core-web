import assert from "node:assert/strict";
import test from "node:test";
import {
  UNDO_WINDOW_MS,
  RESTORE_WINDOW_DAYS,
  deleteConfirmKeys,
  isRestorable,
} from "../src/addons/conversation/composables/conversationDelete.ts";

// UI-IMPL-5 / UI-DESIGN-7: delete confirm copy, 5s undo, 30-day recently deleted.

test("undo window is 5 seconds and restore window 30 days", () => {
  assert.equal(UNDO_WINDOW_MS, 5000);
  assert.equal(RESTORE_WINDOW_DAYS, 30);
});

test("confirm copy adds the stop-generation line only while running", () => {
  assert.deepEqual(deleteConfirmKeys("completed"), ["conversation.delete.body"]);
  for (const s of ["executing", "blocked"]) {
    assert.deepEqual(deleteConfirmKeys(s), ["conversation.delete.body", "conversation.delete.runningNote"]);
  }
});

test("restorable only within 30 days of deletion", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  assert.equal(isRestorable("2026-09-15T00:00:01Z", now), true);
  assert.equal(isRestorable("2026-09-13T23:59:59Z", now), false);
  assert.equal(isRestorable(null, now), false);
});
