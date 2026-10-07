import assert from "node:assert/strict";
import test from "node:test";

import { resolveShellViewPath, shellViewLocation, shouldReportView } from "../src/addons/conversation/composables/shellMessagePolicy.ts";

test("accepts only local absolute child routes from shell view messages", () => {
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "/admin/tools" }), "/admin/tools");
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "https://evil.test" }), null);
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "//evil.test" }), null);
  assert.equal(resolveShellViewPath({ source: "sub", type: "view", path: "/admin/tools" }), null);
});

test("the shell's compare route maps onto the broadcast view with its member", () => {
  const group = "123e4567-e89b-12d3-a456-426614174000";
  assert.deepEqual(shellViewLocation(`/b/${group}/42`), { path: `/b/${group}`, query: { conversationId: "42" } });
  assert.deepEqual(shellViewLocation("/c/42"), { path: "/c/42" });
  assert.deepEqual(shellViewLocation(`/b/${group}`), { path: `/b/${group}` });
  assert.deepEqual(shellViewLocation(`/b/${group}/x`), { path: `/b/${group}/x` });
});

test("O-1: Core reports its own page changes, never the boot route, a shell echo or a conversation", () => {
  assert.equal(shouldReportView("/tasks?input=x", true, null), true);
  assert.equal(shouldReportView("/admin/tools", true, "/admin/providers"), true);
  assert.equal(shouldReportView("/chat", false, null), false, "before the shell's first view");
  assert.equal(shouldReportView("/tasks", true, "/tasks"), false, "the shell asked for it");
  assert.equal(shouldReportView("/c/42", true, null), false);
  assert.equal(shouldReportView("/b/g1?conversationId=4", true, null), false);
});
