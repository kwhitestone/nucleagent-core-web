import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleOptions, type Option } from "../src/chat-react/modelGroups.ts";

// design-1123 rule C: unavailable models are not listed (chat, image, video and executors alike).
const o = (label: string, over: Partial<Option> = {}): Option => ({ value: `chat:1:${label}`, label, choice: { kind: "chat", model: { providerId: 1, model: label } }, ...over });
const ok = o("ok");
const down = o("down", { unavailable: "upstream_offline" });
const unprobed = o("unprobed", { unprobed: true });
const blind = o("blind", { vision: "unsupported" });
const denied = (code: string) => o(code, { denied: code });
const away = o("away", { incompatible: true });

test("available:false, explicit negative combinations and incompatible executors are dropped", () => {
  const list = [ok, down, denied("upstream_protocol_unsupported"), denied("official_unsupported"), denied("translation_unsupported"), away];
  assert.deepEqual(visibleOptions(list, "").map((x) => x.label), ["ok"]);
});

test("an unknown denial code is not a negative fact and stays listed", () => {
  assert.deepEqual(visibleOptions([denied("something_else")], "").map((x) => x.label), ["something_else"]);
});

test("available:null stays listed (未核实); vision-unsupported is a context limit, not unavailable", () => {
  const shown = visibleOptions([unprobed, blind], "");
  assert.deepEqual(shown.map((x) => x.label), ["unprobed", "blind"]);
  assert.equal(shown[0]!.unprobed, true);
  assert.equal(shown.some((x) => x.stale), false);
});

test("the current selection is kept even when hidden, marked stale; nothing else changes", () => {
  const shown = visibleOptions([ok, down, away], down.value);
  assert.deepEqual(shown.map((x) => [x.label, !!x.stale]), [["ok", false], ["down", true]]);
  assert.equal(shown[1]!.unavailable, "upstream_offline", "the reason travels for the hint");
});

test("pure: the input array and options are not mutated", () => {
  const list = [ok, down];
  const copy = structuredClone(list);
  visibleOptions(list, down.value);
  assert.deepEqual(list, copy);
});
