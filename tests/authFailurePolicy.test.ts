import assert from "node:assert/strict";
import test from "node:test";

import { shouldHandleUnauthorized } from "../src/addons/platform-api/api/authFailurePolicy.ts";

test("ignores a pre-auth 401 after a token has been synchronized", () => {
  assert.equal(shouldHandleUnauthorized("new-token", undefined), false);
});

test("ignores a 401 produced by an older token", () => {
  assert.equal(shouldHandleUnauthorized("new-token", "old-token"), false);
});

test("handles a 401 produced by the current token", () => {
  assert.equal(shouldHandleUnauthorized("current-token", "current-token"), true);
});

test("handles a 401 when no active token exists", () => {
  assert.equal(shouldHandleUnauthorized("", undefined), true);
});

test("A-16: matches the bare token, not the legacy Bearer-prefixed form", () => {
  assert.equal(shouldHandleUnauthorized("current-token", "Bearer current-token"), false);
});
