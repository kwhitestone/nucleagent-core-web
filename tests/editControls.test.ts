import assert from "node:assert/strict";
import test from "node:test";
import { descendants, hostNode, loadComponent, renderer } from "./vueComponentHarness.ts";

const Field = loadComponent(new URL("../src/components/agent-edit/EditField.vue", import.meta.url));
const Tools = loadComponent(new URL("../src/components/agent-edit/ToolBindings.vue", import.meta.url));

for (const kind of ["text", "textarea", "select", "boolean"]) {
  test(`shared ${kind}: editable updates, locked controls reject writes`, () => {
    for (const editable of [true, false]) {
      const root = hostNode("root"), changes: unknown[] = [];
      const app = renderer.createApp(Field, {
        id: "field", label: "Field", modelValue: kind === "boolean" ? false : "old", kind, editable,
        choices: [{ value: "old", label: "Old", disabled: true }, { value: "new", label: "New" }],
        emptyLabel: "Default", "onUpdate:modelValue": (value: unknown) => changes.push(value),
      });
      app.mount(root);
      const nodes = descendants(root), control = nodes.find(n => n.props.id === "field")!;
      assert.equal(control.props["aria-describedby"], "field-hint");
      assert.equal(nodes.find(n => n.tag === "label")?.props.for, "field");
      assert.equal(control.props[kind === "select" || kind === "boolean" ? "disabled" : "readonly"], !editable);
      (control.props.onInput ?? control.props.onChange)({ target: { value: "new", checked: true } });
      assert.deepEqual(changes, editable ? [kind === "boolean" ? true : "new"] : []);
      if (kind === "select") {
        const options = nodes.filter(n => n.tag === "option");
        assert.deepEqual(options.map(n => n.props.value), ["", "old", "new"]);
        assert.equal(options[1].props.selected, true);
        assert.equal(options[1].props.disabled, true);
      }
      app.unmount();
    }
  });
}

test("shared tool binding policy: missing removals, skill coverage and readonly", () => {
  const rows = [
    { id: 1, name: "Normal", missing: false, covered: false },
    { id: 2, name: "Missing", missing: true, covered: false },
    { id: 3, name: "Covered", missing: false, covered: true },
    { id: 4, name: "Unavailable", missing: true, covered: false },
  ];
  for (const editable of [true, false]) for (const omitCovered of [true, false]) {
    const changes: unknown[] = [], root = hostNode("root");
    const app = renderer.createApp(Tools, {
      rows, selected: [2, 3], editable, omitCovered, coveredLabel: "Covered", unavailableLabel: "Unavailable",
      onToggle: (id: number, checked: boolean) => changes.push([id, checked]),
    });
    app.mount(root);
    const inputs = descendants(root).filter(n => n.tag === "input");
    assert.deepEqual(inputs.map(n => n.props.checked), [false, true, !omitCovered, false]);
    assert.deepEqual(inputs.map(n => n.props.disabled), [!editable, !editable, !editable || omitCovered, true]);
    for (const input of inputs) input.props.onChange({ target: { checked: false } });
    assert.deepEqual(changes, !editable ? [] : omitCovered ? [[1, false], [2, false]] : [[1, false], [2, false], [3, false]]);
    app.unmount();
  }
});
