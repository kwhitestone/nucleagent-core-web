import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { compileScript, parse } from "@vue/compiler-sfc";
import { createServer, transformWithEsbuild, type ViteDevServer } from "vite";
import { descendants, hostNode, loadComponent, renderer } from "./vueComponentHarness.ts";

const { EditField: Field } = await import("@prism-fusion/editor-ui");
let Tools: any, vite: ViteDevServer, unregister: () => void;
before(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  async function client(path: string): Promise<any> {
    const { descriptor } = parse(readFileSync(new URL(`..${path}`, import.meta.url), "utf8"));
    const compiled = compileScript(descriptor, { id: path, inlineTemplate: true });
    const js = await transformWithEsbuild(compiled.content, `${path}.ts`, { loader: "ts" });
    const transformed = await vite.ssrTransform(js.code, null, path);
    const exports: any = {};
    await new Function("__vite_ssr_exports__", "__vite_ssr_import__", `return (async () => {${transformed!.code}})()`)(
      exports, (id: string) => id.startsWith("@/") ? (id.endsWith(".vue")
        ? client(`/src/${id.slice(2)}`) : vite.ssrLoadModule(`/src/${id.slice(2)}`)) : import(id));
    return exports;
  }
  Tools = (await client("/src/components/agent-edit/ToolBindings.vue")).default;
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: { get: async (_path: string, config: any) => {
    const rows = [{ id: 1, name: "Normal", skillIds: [] }, { id: 3, name: "Covered", skillIds: [9] }]
      .filter(row => !config.params.ids || config.params.ids.split(",").map(Number).includes(row.id));
    return { data: { data: rows, page: 1, pageSize: config.params.pageSize, total: rows.length, hasMore: false } };
  } } });
});
after(async () => { unregister?.(); await vite?.close(); Reflect.deleteProperty(globalThis, "window"); });

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

test("shared tool binding policy: missing removals, skill coverage and readonly", async () => {
  const rows = [
    { id: 1, name: "Normal", missing: false, covered: false },
    { id: 2, name: "Missing", missing: true, covered: false },
    { id: 3, name: "Covered", missing: false, covered: true },
    { id: 4, name: "Unavailable", missing: true, covered: false },
  ];
  for (const editable of [true, false]) for (const omitCovered of [true, false]) {
    const changes: unknown[] = [], root = hostNode("root");
    const app = renderer.createApp(Tools, {
      rows, selected: [2, 3], skillIds: [9], editable, omitCovered, coveredLabel: "Covered", unavailableLabel: "Unavailable",
      onToggle: (id: number, checked: boolean) => changes.push([id, checked]),
    });
    app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
    app.mount(root);
    for (let i = 0; i < 10; i++) await nextTick();
    const inputs = descendants(root).filter(n => n.tag === "input" && n.props.type === "checkbox").slice(1);
    // A usable tool a selected skill brings always shows ticked, whether or not it is also a manual pick.
    assert.deepEqual(inputs.map(n => n.props.checked !== undefined && n.props.checked !== false), [false, true, true]);
    assert.deepEqual(inputs.map(n => n.props.disabled), [!editable, !editable || omitCovered, !editable]);
    for (const input of inputs) input.props.onChange({ target: { checked: false } });
    assert.deepEqual(changes, !editable ? [] : omitCovered ? [[1, false], [2, false]] : [[1, false], [3, false], [2, false]]);
    app.unmount();
  }
});
