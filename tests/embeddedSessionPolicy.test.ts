import assert from "node:assert/strict";
import test from "node:test";

import { shouldAcceptShellSession } from "../src/addons/platform-api/session/embeddedSessionPolicy.ts";

test("rejects stale and already rejected shell session generations", () => {
  assert.equal(shouldAcceptShellSession(3, null, 2, true), false);
  assert.equal(shouldAcceptShellSession(3, 3, 3, true), false);
  assert.equal(shouldAcceptShellSession(3, 3, 4, true), true);
  assert.equal(shouldAcceptShellSession(3, 3, 3, false), true);
});
