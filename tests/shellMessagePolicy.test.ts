import assert from "node:assert/strict";
import test from "node:test";

import { resolveShellViewPath } from "../src/addons/conversation/composables/shellMessagePolicy.ts";

test("accepts only local absolute child routes from shell view messages", () => {
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "/admin/tools" }), "/admin/tools");
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "https://evil.test" }), null);
  assert.equal(resolveShellViewPath({ source: "shell", type: "view", path: "//evil.test" }), null);
  assert.equal(resolveShellViewPath({ source: "sub", type: "view", path: "/admin/tools" }), null);
});
