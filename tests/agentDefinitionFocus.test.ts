import assert from "node:assert/strict";
import test from "node:test";
import { trapDialogFocus } from "../src/addons/administration/agents/definition/focus.ts";

test("modal Tab wraps both ways and skips invisible or disabled controls", () => {
  let focused = "", prevented = 0;
  const ownerDocument = { activeElement: null as any, defaultView: { getComputedStyle: () => ({ visibility: "visible" }) } };
  const control = (id: string, disabled = false, hidden = false) => ({
    ownerDocument, tabIndex: 0, matches: () => disabled, closest: () => null,
    getClientRects: () => hidden ? [] : [1], focus: () => { focused = id; },
  });
  const first = control("first"), hidden = control("hidden", false, true);
  const disabled = control("disabled", true), last = control("last");
  ownerDocument.activeElement = first;
  const dialog = { ownerDocument, querySelectorAll: () => [disabled, first, hidden, last, disabled] };
  const event = { key: "Tab", shiftKey: true, currentTarget: dialog, preventDefault: () => { prevented++; } };
  trapDialogFocus(event as unknown as KeyboardEvent);
  assert.equal(focused, "last");
  ownerDocument.activeElement = last;
  trapDialogFocus({ ...event, shiftKey: false } as unknown as KeyboardEvent);
  assert.equal(focused, "first");
  trapDialogFocus({ ...event, key: "Escape" } as unknown as KeyboardEvent);
  assert.equal(prevented, 2);
});
