import assert from "node:assert/strict";
import test from "node:test";

import {
  isAuthenticationFailure,
  retryDelayMs,
} from "../src/addons/conversation/task-conversation/vue/retryPolicy.ts";

test("treats only explicit 401/403 errors as terminal authentication failures", () => {
  assert.equal(isAuthenticationFailure({ status: 401 }), true);
  assert.equal(isAuthenticationFailure({ status: 403 }), true);
  assert.equal(isAuthenticationFailure({ status: 500 }), false);
  assert.equal(isAuthenticationFailure(new Error("Unauthorized")), false);
});

test("uses bounded exponential retry delays for recoverable failures", () => {
  assert.equal(retryDelayMs(0), 750);
  assert.equal(retryDelayMs(1), 1_500);
  assert.equal(retryDelayMs(10), 30_000);
  assert.equal(retryDelayMs(100), 30_000);
});
