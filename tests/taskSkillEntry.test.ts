import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../src/addons/conversation/views/TaskSetup.vue", import.meta.url), "utf8");
const entry = source.slice(source.indexOf("function applyEntry()"), source.indexOf("const selected ="));
async function mount(query: Record<string, unknown>, fail = false) {
  let mounted: () => Promise<void> = async () => {};
  const state = { skillIds: { value: [] as number[] }, form: { desc: "" }, restored: false, read: false };
  const context = { ...state, route: { query }, templates: { value: [] }, localStorage: {},
    onMounted: (fn: () => Promise<void>) => { mounted = fn; },
    readDraft: () => { state.read = true; return { skillIds: [99] }; },
    restoreDraft: () => { state.restored = true; state.skillIds.value = [99]; },
    listAgentTemplates: async () => { if (fail) throw Error("offline"); return [{ name: "default" }]; },
    selectTemplate: () => { state.form.desc = "default"; }, templateToTask: (v: unknown) => v,
    console: { warn: () => {} } };
  vm.runInNewContext(ts.transpileModule(entry, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  await mounted(); return state;
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
