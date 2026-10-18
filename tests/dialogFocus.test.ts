import assert from "node:assert/strict";
import { test } from "node:test";
import { trapDialogFocus } from "../src/addons/administration/agents/definition/focus.ts";

function fixture() {
  const focused: string[] = [];
  const doc = { activeElement: null as any, defaultView: { getComputedStyle: (el: any) => ({ visibility: el.visibility }) } };
  const control = (id: string, tabIndex = 0) => ({
    id, tabIndex, disabled: false, hidden: false, inert: false, visibility: "visible", ownerDocument: doc,
    closedDetails: null as any,
    getClientRects() { return this.hidden ? [] : [{}]; },
    matches() { return this.disabled; },
    closest(selector: string) { return selector === "[inert]" ? (this.inert ? {} : null) : this.closedDetails; },
    focus() { focused.push(id); doc.activeElement = this; },
  });
  const basic = control("basic", -1), skills = control("skills"), save = control("save");
  let controls = [basic, skills, save];
  const dialog = { querySelectorAll: () => controls, ownerDocument: doc,
    focus() { focused.push("dialog"); }, tabIndex: -1 };
  function tab(active: any, shiftKey = false, key = "Tab") {
    doc.activeElement = active;
    let prevented = false;
    trapDialogFocus({ key, shiftKey, currentTarget: dialog, preventDefault() { prevented = true; } } as any);
    return prevented;
  }
  return { focused, control, basic, skills, save, tab, set: (list: typeof controls) => { controls = list; } };
}

test("non-first sidebar group Shift+Tab wraps to last actual stop", () => {
  const f = fixture();
  assert.equal(f.tab(f.skills, true), true);
  assert.deepEqual(f.focused, ["save"]);
});
test("forward Tab wraps to selected group, not negative tabindex", () => {
  const f = fixture();
  assert.equal(f.tab(f.save), true);
  assert.deepEqual(f.focused, ["skills"]);
});
test("disabled controls are recalculated for each key event", () => {
  const f = fixture();
  f.save.disabled = true;
  assert.equal(f.tab(f.skills), true);
  assert.deepEqual(f.focused, ["skills"]);
});
test("invisible, inert and negative tabindex controls are excluded", () => {
  const f = fixture();
  const hidden = f.control("hidden"), invisible = f.control("invisible"), inert = f.control("inert");
  hidden.hidden = true; invisible.visibility = "hidden"; inert.inert = true;
  f.set([hidden, invisible, inert, f.basic, f.skills, f.save]);
  f.tab(f.save);
  assert.deepEqual(f.focused, ["skills"]);
});
test("empty candidate set traps Tab on the dialog", () => {
  const f = fixture(); f.set([]);
  assert.equal(f.tab(null), true);
  assert.deepEqual(f.focused, ["dialog"]);
});
test("background focus recovers to first or last according to direction", () => {
  const f = fixture();
  assert.equal(f.tab(f.control("outside")), true);
  assert.equal(f.tab(f.control("outside"), true), true);
  assert.deepEqual(f.focused, ["skills", "save"]);
});
test("positive tabindex precedes zero in native sequential order", () => {
  const f = fixture(), one = f.control("one", 1), two = f.control("two", 2);
  f.set([f.skills, two, one, f.save]);
  f.tab(f.save); f.tab(one, true);
  assert.deepEqual(f.focused, ["one", "save"]);
});
test("interior Tab and non-Tab keys retain native handling", () => {
  const f = fixture();
  assert.equal(f.tab(f.skills), false);
  assert.equal(f.tab(f.save, false, "Enter"), false);
  assert.deepEqual(f.focused, []);
});

test("closed details descendants with client rectangles are not focus stops", () => {
  const f = fixture(), hidden = f.control("closed-child");
  hidden.closedDetails = { querySelector: () => null };
  f.set([hidden, f.skills, f.save]);
  f.tab(f.skills, true); f.tab(f.save);
  assert.deepEqual(f.focused, ["save", "skills"]);
});

test("first summary stays reachable but a closed outer details still excludes it", () => {
  const f = fixture(), summary = f.control("summary");
  const outer = { querySelector: () => ({ contains: () => false }) };
  const details = { querySelector: () => ({ contains: (el: unknown) => el === summary }),
    parentElement: { closest: () => null as any } };
  summary.closedDetails = details;
  f.set([summary, f.skills, f.save]);
  f.tab(f.save);
  assert.deepEqual(f.focused, ["summary"]);
  details.parentElement.closest = () => outer;
  f.tab(f.save);
  assert.deepEqual(f.focused, ["summary", "skills"]);
});

test("positive tabindex traverses numeric order, stable ties and zero stops in both directions", () => {
  const f = fixture(), twoA = f.control("two-a", 2), one = f.control("one", 1),
    twoB = f.control("two-b", 2), ten = f.control("ten", 10);
  f.set([f.skills, twoA, ten, one, twoB, f.save]);
  const ordered = [one, twoA, twoB, ten, f.skills, f.save];
  for (let i = 0; i < ordered.length; i++) {
    assert.equal(f.tab(ordered[i]), true);
    assert.equal(f.focused.at(-1), ordered[(i + 1) % ordered.length].id);
    assert.equal(f.tab(ordered[i], true), true);
    assert.equal(f.focused.at(-1), ordered[(i + ordered.length - 1) % ordered.length].id);
  }
});
