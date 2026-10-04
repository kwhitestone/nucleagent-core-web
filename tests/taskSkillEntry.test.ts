import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { nextTick, reactive, watch } from "vue";
const source = readFileSync(new URL("../src/addons/conversation/views/TaskSetup.vue", import.meta.url), "utf8");
const entry = source.slice(source.indexOf("function applyEntry()"), source.indexOf("const selected ="));
async function mount(query: Record<string, unknown>, fail = false, duringLoad?: Record<string, unknown>) {
  let mounted: () => Promise<void> = async () => {};
  const state = { skillIds: { value: [] as number[] }, form: { desc: "" }, targetDeviceId: { value: "" }, executionBackend: { value: "" }, restored: false, read: false };
  const route = reactive({ query });
  const context = { ...state, route, watch, templates: { value: [] }, localStorage: {},
    onMounted: (fn: () => Promise<void>) => { mounted = fn; },
    readDraft: () => { state.read = true; return { skillIds: [99] }; },
    restoreDraft: () => { state.restored = true; state.skillIds.value = [99]; },
    listAgentTemplates: async () => {
      if (duringLoad) { route.query = duringLoad; await nextTick(); }
      if (fail) throw Error("offline"); return [{ name: "default" }];
    },
    selectTemplate: () => { state.form.desc = "default"; }, templateToTask: (v: unknown) => v,
    console: { warn: () => {} } };
  vm.runInNewContext(ts.transpileModule(entry, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await mounted(); return { ...state, navigate: async (query: Record<string, unknown>) => {
    route.query = query; await nextTick();
  } };
}
test("explicit skill IDs win over saved draft after asynchronous template load", async () => {
  const state = await mount({ skillIds: "12,34", input: "from hub" });
  assert.deepEqual(Array.from(state.skillIds.value), [12,34]);
  assert.equal(state.form.desc, "from hub"); assert.equal(state.read, false); assert.equal(state.restored, false);
});
test("repeated query IDs are deduplicated and invalid IDs cannot select skills", async () => {
  const state = await mount({ skillIds: ["2,2,3", null, "0,-1,2e3,NaN,9007199254740992"] });
  assert.deepEqual(Array.from(state.skillIds.value), [2,3]);
});
test("explicit empty query suppresses saved draft", async () => {
  const state = await mount({ skillIds: "" });
  assert.deepEqual(Array.from(state.skillIds.value), []); assert.equal(state.read, false);
});
test("absent query retains existing draft behavior", async () => {
  const state = await mount({}); assert.equal(state.restored, true); assert.deepEqual(state.skillIds.value, [99]);
});
test("prefill survives unavailable templates", async () => {
  const state = await mount({ skillIds: "7" }, true);
  assert.deepEqual(Array.from(state.skillIds.value), [7]); assert.equal(state.restored, false);
});
test("a mounted task applies a new deep link without recreating the form", async () => {
  const state = await mount({ input: "first", skillIds: "1" });
  await state.navigate({ input: "second & 世界", skillIds: ["2,2,3", "0,-1"], device: " pc-2 ", backend: " hermes " });
  assert.equal(state.form.desc, "second & 世界");
  assert.deepEqual(Array.from(state.skillIds.value), [2, 3]);
  assert.equal(state.targetDeviceId.value, "pc-2");
  assert.equal(state.executionBackend.value, "hermes");
  await state.navigate({ skillIds: "" });
  assert.deepEqual(Array.from(state.skillIds.value), []);
  assert.equal(state.form.desc, "second & 世界");
});
test("a deep link arriving during template loading supersedes the saved draft", async () => {
  const state = await mount({}, false, { input: "new intent", skillIds: "7", backend: "codex" });
  assert.equal(state.read, true);
  assert.equal(state.restored, false);
  assert.equal(state.form.desc, "new intent");
  assert.deepEqual(Array.from(state.skillIds.value), [7]);
});
