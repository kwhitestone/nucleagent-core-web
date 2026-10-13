import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  daysLeft,
  deleteConfirmKeys,
  deleteErrorKey,
  groupSize,
  parseDeleteIntent,
} from "../src/addons/conversation/composables/conversationDelete.ts";

// UI-IMPL-5 / UI-DESIGN-7 §5/§8: component-level checks (no browser).
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("compare groups add the whole-group line", () => {
  assert.deepEqual(deleteConfirmKeys("completed", 3), ["conversation.delete.body", "conversation.delete.groupNote"]);
  assert.deepEqual(deleteConfirmKeys("executing", 1), ["conversation.delete.body", "conversation.delete.runningNote"]);
});

test("group size counts loaded members sharing broadcastGroupId", () => {
  const rows = [
    { id: 1, state: { broadcastGroupId: "g" } },
    { id: 2, state: { broadcastGroupId: "g" } },
    { id: 3, state: { broadcastGroupId: "g" } },
    { id: 4 },
  ];
  assert.equal(groupSize(rows, 2), 3);
  assert.equal(groupSize(rows, 4), 1);
  assert.equal(groupSize(rows, 99), 1);
});

test("days left in the 30-day window, never negative", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  assert.equal(daysLeft("2026-10-14T00:00:00Z", now), 30);
  assert.equal(daysLeft("2026-09-20T12:00:00Z", now), 7);
  assert.equal(daysLeft("2026-09-01T00:00:00Z", now), 0);
});

test("someone else's / missing conversation (404) reads as gone, not a retry", () => {
  assert.equal(deleteErrorKey({ status: 404 }), "conversation.delete.notFound");
  assert.equal(deleteErrorKey({ status: 500 }), "conversation.delete.failed");
  assert.equal(deleteErrorKey(new Error("x")), "conversation.delete.failed");
});

test("shell delete intent is strictly validated", () => {
  assert.deepEqual(parseDeleteIntent({ source: "shell", type: "delete", conversationId: 7 }), { conversationId: 7 });
  for (const bad of [null, {}, { source: "sub", type: "delete", conversationId: 7 }, { source: "shell", type: "delete", conversationId: "7" },
    { source: "shell", type: "delete", conversationId: 0 }, { source: "shell", type: "delete", conversationId: 1.5 }]) {
    assert.equal(parseDeleteIntent(bad), null);
  }
});

test("conversation header has a 「⋯」 menu with delete on every width", () => {
  const view = src("addons/conversation/views/Conversation.vue");
  assert.match(view, /data-testid="conv-delete"/);
  assert.match(view, /requestDelete\(/);
});

test("confirm dialog + 5s undo bar are mounted once at the app root", () => {
  assert.match(src("App.vue"), /<ConversationDeleteHost \/>/);
  const host = src("addons/conversation/components/ConversationDeleteHost.vue");
  assert.match(host, /role="alertdialog"/);
  assert.match(host, /deleteConfirmKeys\(/);
  assert.match(host, /UNDO_WINDOW_MS/);
  assert.match(host, /undoDelete/);
  assert.match(src("addons/conversation/composables/useConversationDelete.ts"), /restoreConversation\(/);
  assert.match(host, /data-testid="conv-undo"/);
  assert.match(host, /@media \(max-width: 640px\)/);
});

test("recently deleted page lists, restores, and has an empty state", () => {
  const page = src("addons/conversation/views/RecentlyDeleted.vue");
  assert.match(page, /listDeletedConversations\(/);
  assert.match(page, /restoreConversation\(/);
  assert.match(page, /recentlyDeletedEmpty/);
  assert.match(page, /daysLeft\(/);
  assert.match(src("addons/conversation/index.ts"), /path: "\/deleted"/);
});

test("shell bridge accepts the delete intent", () => {
  const bridge = src("addons/conversation/composables/useShellBridge.ts");
  assert.match(bridge, /toChild: \[[^\]]*"delete"/);
  assert.match(bridge, /parseDeleteIntent\(/);
});

test("zh/en carry the new copy", async () => {
  for (const lang of ["zh", "en"]) {
    const { default: m } = await import(`../src/i18n/${lang}.ts`);
    const d = m.conversation.delete;
    for (const k of ["groupNote", "notFound", "daysLeft", "back", "loadFailed"]) assert.ok(d[k], `${lang}.${k}`);
  }
});
