import assert from "node:assert/strict";
import { test } from "node:test";
import { profileRequest } from "../src/chat-react/modelProfile.ts";

test("a turn carries the scoped profile with the Controls effort, or the legacy effort alone, never both", () => {
  const scope = "7:codex:7:gpt-6-astra";
  const selection = { scope, profileId: "quick" };
  assert.deepEqual(profileRequest(selection, scope, "medium"), { profileId: "quick", modelParams: { reasoningEffort: "medium" } });
  assert.deepEqual(profileRequest(selection, scope, ""), { profileId: "quick" });
  // Another conversation/backend/provider/model, the default item, or no selection: only the legacy effort is left.
  for (const other of ["8:codex:7:gpt-6-astra", "7:hermes:7:gpt-6-astra", "7:codex:8:gpt-6-astra", "7:codex:7:other"]) {
    assert.equal(profileRequest(selection, other, "high"), "high");
  }
  assert.equal(profileRequest({ scope, profileId: "" }, scope, "low"), "low");
  assert.equal(profileRequest(null, scope, ""), "");
});
