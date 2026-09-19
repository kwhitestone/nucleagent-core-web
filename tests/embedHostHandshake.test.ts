import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedHostOrigins,
  embedInitConversationId,
} from "../src/composables/useEmbedHostHandshake.ts";

test("accepts only well-formed embed-init messages", () => {
  assert.equal(
    embedInitConversationId({ type: "agentia:embed-init", payload: { conversationId: "7" } }),
    "7",
  );
  assert.equal(
    embedInitConversationId({ type: "nucleagent:ready", payload: { conversationId: "7" } }),
    null,
  );
  assert.equal(
    embedInitConversationId({ type: "agentia:embed-init", payload: { conversationId: "  " } }),
    null,
  );
  assert.equal(embedInitConversationId({ type: "agentia:embed-init" }), null);
  assert.equal(embedInitConversationId(null), null);
});

test("host origins stay exact and drop malformed entries", () => {
  const origins = allowedHostOrigins("http://localhost:19002/, not-a-url, https://app.test");
  assert.deepEqual([...origins].sort(), ["http://localhost:19002", "https://app.test"]);
  assert.equal(allowedHostOrigins(undefined).size, 0);
  assert.equal(allowedHostOrigins("").size, 0);
});
