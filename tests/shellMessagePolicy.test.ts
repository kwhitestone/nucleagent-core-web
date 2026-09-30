import assert from "node:assert/strict";
import test from "node:test";

import { resolveShellViewPath, shellViewLocation } from "../src/addons/conversation/composables/shellMessagePolicy.ts";

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
