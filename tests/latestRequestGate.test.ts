import assert from "node:assert/strict";
import { test } from "node:test";

import { createLatestRequestGate } from "../src/addons/conversation/composables/latestRequestGate.ts";

test("logout invalidation prevents an in-flight authenticated response from committing", async () => {
  let release!: (value: string[]) => void;
  const response = new Promise<string[]>((resolve) => { release = resolve; });
  const gate = createLatestRequestGate();
  const request = gate.begin();
  let options: string[] = [];

  const pending = response.then((value) => {
    if (request.isCurrent()) options = value;
  });
  gate.invalidate();
  release(["codex", "hermes"]);
  await pending;

  assert.deepEqual(options, []);
});

test("starting a newer request invalidates the older request only", () => {
  const gate = createLatestRequestGate();
  const older = gate.begin();
  const current = gate.begin();

  assert.equal(older.isCurrent(), false);
  assert.equal(current.isCurrent(), true);
});
