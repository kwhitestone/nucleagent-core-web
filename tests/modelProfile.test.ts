import assert from "node:assert/strict";
import { test } from "node:test";
import { profileEffortView, profileRequest } from "../src/chat-react/modelProfile.ts";
import { effortView, sentEffort } from "../src/chat-react/requestEffort.ts";

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

// MUYU-406 §2.1: a selected profile narrows the evidence view to the levels its server whitelist also lists.
test("with a profile selected only levels in both the evidence view and the profile whitelist stay enabled", () => {
  const scope = "7:codex:7:gpt-6-astra";
  const all = effortView("codex", { levels: ["low", "medium", "high"], effective: true, source: "fixture" });
  const pick = (efforts?: string[]) => ({ scope, profileId: "quick", efforts });
  // No profile in this scope (none, the default item, another model): the evidence view is untouched.
  for (const none of [null, { scope, profileId: "", efforts: [] }, { ...pick([]), scope: "7:codex:7:other" }]) {
    assert.equal(profileEffortView(all, none, scope), all);
  }
  assert.deepEqual(profileEffortView(all, pick(["low", "high"]), scope).off, ["medium"]);
  // An intersection, never a union: the profile cannot switch on a level the evidence leaves off.
  const partial = profileEffortView(effortView("codex", { levels: ["low", "medium"], effective: false, source: "fixture" }), pick(["medium", "high"]), scope);
  assert.deepEqual([partial.off, partial.disabled, partial.note], [["low", "high"], false, "ineffective"]);
  // Unknown (older Core), empty or forged whitelist: no level is offered or sent; the default item stays selectable.
  for (const efforts of [undefined, [], ["xhigh", "LOW", ""]]) {
    const view = profileEffortView(all, pick(efforts), scope);
    assert.deepEqual([view.off, view.disabled], [["low", "medium", "high"], false]);
    for (const level of ["low", "medium", "high"] as const) assert.equal(sentEffort(level, view), "");
  }
  // A remembered level outside the intersection is dropped, and the turn still carries one field set.
  const narrow = pick(["low", "high"]);
  const view = profileEffortView(all, narrow, scope);
  assert.deepEqual(profileRequest(narrow, scope, sentEffort("medium", view)), { profileId: "quick" });
  assert.deepEqual(profileRequest(narrow, scope, sentEffort("high", view)), { profileId: "quick", modelParams: { reasoningEffort: "high" } });
  assert.equal(profileEffortView(effortView("hermes", undefined), pick(["low"]), scope).disabled, true);
});
