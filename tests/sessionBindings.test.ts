import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import { getSessionBindings, updateSessionBindings } from "../src/addons/conversation/api/sessionBindings.ts";

const source = (name: string) => readFileSync(new URL(`../src/addons/conversation/${name}`, import.meta.url), "utf8");
const run = (script: string, context: Record<string, unknown>) =>
  vm.runInNewContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

for (const [view, fn, end] of [
  ["Home", "handleCreate", "// ---- Task desk"],
  ["TaskSetup", "launch", "</script>"],
] as const) {
  test(`${view}: actual create handler submits skills/tools, no pick retains old behavior`, async () => {
    const src = source(`views/${view}.vue`);
    assert.equal((src.match(/<BindingPickers /g) ?? []).length, 2);
    const body = src.slice(src.indexOf(`async function ${fn}()`), src.indexOf(end));
    for (const picks of [{ skillIds: [7], toolIds: [8] }, { skillIds: undefined, toolIds: undefined }]) {
      const writes: any[] = [];
      const context = {
        input: { value: "test fixture" }, genOn: { value: false }, canSend: { value: true },
        submitting: { value: false }, backendCompatible: { value: true }, broadcast: { value: false },
        modelChoice: { value: null }, executionBackend: { value: "codex" }, attachments: { value: [] },
        createBindings: { value: picks }, form: { name: "fixture", desc: "fixture" },
        targetDeviceId: { value: "" }, launchError: { value: "" }, nameError: { value: false }, narrow: { value: false },
        store: { create: async (payload: unknown) => { writes.push(payload); return { id: 11 }; } },
        router: { push: async () => {}, replace: async () => {} }, clearDraft() {}, localStorage: {},
        toast: { error: (s: string) => assert.fail(s), warning: (s: string) => assert.fail(s) }, t: (s: string) => s,
        DOMException, modelErrorMessage: (e: Error) => e.message,
      };
      await run(`${body}\n${fn}()`, context);
      assert.equal(writes.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(writes[0])).skillIds, picks.skillIds);
      assert.deepEqual(JSON.parse(JSON.stringify(writes[0])).toolIds, picks.toolIds);
    }
  });
}

test("Conversation uses shared editor on desktop/mobile and blocks unsaved sends", () => {
  const src = source("views/Conversation.vue");
  assert.equal((src.match(/<SessionBindingsEditor /g) ?? []).length, 2);
  assert.match(src, /send: !bindingsPending/);
  assert.match(src, /@pending="bindingsPending = \$event"/);
  assert.match(source("components/SessionBindingsEditor.vue"), /<BindingPickers /);
});

test("bindings API uses the session path, sends explicit clears, and rejects malformed readback", async () => {
  const calls: unknown[] = [];
  let data: unknown = { skillIds: [7], toolIds: [8], editable: true };
  const off = registerPlatformRuntime({ http: {
    get: async (path: string) => { calls.push(path); return { data: { data } }; },
    put: async (path: string, body: unknown) => { calls.push([path, body]); return { data: { data } }; },
  } } as never);
  try {
    assert.deepEqual(await getSessionBindings("11"), data);
    await updateSessionBindings("11", { skillIds: [], toolIds: [] });
    assert.deepEqual(calls, ["/api/v1/addons/conversation/11/bindings",
      ["/api/v1/addons/conversation/11/bindings", { skillIds: [], toolIds: [] }]]);
    data = {};
    await assert.rejects(getSessionBindings("11"), /Invalid session bindings/);
  } finally { off(); }
});
