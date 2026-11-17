import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultEffort, effortView, sentEffort, storedEffort, storeEffort, withRequestEffort } from "../src/chat-react/requestEffort.ts";

// MUYU-365 gap2: per-model reasoning effort (Core `reasoningEffort` low|medium|high, codex only).
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

test("reasoningEffort is sent only for a chosen level on codex; '' = backend default (field omitted)", () => {
  const base = { input: "q" };
  for (const level of ["low", "medium", "high"] as const) assert.deepEqual(withRequestEffort(base, level, "codex"), { ...base, reasoningEffort: level });
  assert.equal("reasoningEffort" in withRequestEffort(base, "", "codex"), false);
  assert.equal("reasoningEffort" in withRequestEffort(base, "high", "hermes"), false, "Core rejects non-codex (400)");
  assert.equal("reasoningEffort" in withRequestEffort(base, "high", null), false);
});

test("environment default comes from runtime config and only accepts low|medium|high", () => {
  assert.equal(defaultEffort(() => "low"), "low");
  assert.equal(defaultEffort(() => "high"), "high");
  for (const v of ["", "minimal", "none", "HIGH"]) assert.equal(defaultEffort(() => v), "");
  assert.equal(defaultEffort(() => { throw new Error("not loaded"); }), "");
});

test("choice is remembered per model; corrupt or blocked storage falls back to undefined", () => {
  const s = memory();
  assert.equal(storedEffort("1:m", s), undefined);
  storeEffort("1:m", "high", s);
  storeEffort("1:n", "", s);
  assert.equal(storedEffort("1:m", s), "high");
  assert.equal(storedEffort("1:n", s), "", "explicit backend default is remembered too");
  assert.equal(storedEffort("2:m", s), undefined);
  s.data.set("nucleagent_chat_effort", "{bad");
  assert.equal(storedEffort("1:m", s), undefined);
  s.data.set("nucleagent_chat_effort", JSON.stringify({ "1:m": "minimal" }));
  assert.equal(storedEffort("1:m", s), undefined);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(storedEffort("1:m", blocked), undefined);
  assert.doesNotThrow(() => storeEffort("1:m", "low", blocked));
});

test("sent level: unsupported or disabled choices fall back to the backend default, never a level the model lacks", () => {
  assert.equal(sentEffort("high", effortView("codex", { levels: ["low"], effective: true, source: "s" })), "");
  assert.equal(sentEffort("low", effortView("codex", { levels: ["low"], effective: true, source: "s" })), "low");
  assert.equal(sentEffort("low", effortView("hermes", undefined)), "");
  assert.equal(sentEffort("medium", effortView("codex", undefined)), "");
});

test("view: non-codex disables everything; evidence disables unsupported levels and states real effect; no evidence = unverified", () => {
  assert.deepEqual(effortView("hermes", undefined), { disabled: true, off: ["low", "medium", "high"], note: "backend" });
  assert.deepEqual(effortView("codex", undefined), { disabled: true, off: ["low", "medium", "high"], note: "unverified" });
  assert.deepEqual(effortView("codex", { levels: ["low", "medium"], effective: false, source: "s" }),
    { disabled: false, off: ["high"], note: "ineffective" });
  assert.equal(effortView("codex", { levels: ["low", "medium", "high"], effective: true, source: "s" }).note, "effective");
});

test("a model with no supported levels disables the selector and omits remembered effort on create", () => {
  const view = effortView("codex", { levels: [], effective: false, source: "catalog:unsupported" });
  assert.equal(view.disabled, true);
  assert.deepEqual(view.off, ["low", "medium", "high"]);
  for (const level of ["low", "medium", "high"] as const) {
    const payload = withRequestEffort({ input: "q" }, sentEffort(level, view), "codex");
    assert.deepEqual(payload, { input: "q" });
  }
});

// MUYU-365 exp3: Core /model-profiles `efforts` is the server whitelist; it enables levels when no measured strategy exists.
test("server efforts enable only listed levels and are labelled as accepted, not measured", async () => {
  const { serverEvidence } = await import("../src/chat-react/requestEffort.ts");
  assert.equal(serverEvidence(undefined), undefined);
  assert.equal(serverEvidence([]), undefined);
  assert.equal(serverEvidence([{ efforts: [] }]), undefined, "empty whitelist = nothing to offer");
  assert.equal(serverEvidence([{}]), undefined, "older Core without efforts");
  const evidence = serverEvidence([{ efforts: ["medium", "low", "xhigh"] }]);
  assert.deepEqual(evidence, { levels: ["low", "medium"], effective: false, source: "core" });
  const view = effortView("codex", evidence);
  assert.deepEqual([view.disabled, view.off, view.note], [false, ["high"], "server"]);
  assert.equal(sentEffort("low", view), "low");
  assert.equal(sentEffort("high", view), "", "unlisted level is never sent");
  assert.equal(effortView("hermes", evidence).disabled, true);
});
