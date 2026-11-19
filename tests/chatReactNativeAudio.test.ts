import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowToolEligible, validateWorkflowTool, workflowInvocation, directMediaTool } from "../src/chat-react/workflowParams.ts";

const row = { id: 71, imported: false, status: "ready", nativeCapability: "nucleagent.audio.tts.v1", nativeModel: "qwen3-tts-flash" };
const schema = { nativeCapability: row.nativeCapability, model: row.nativeModel, output: "audio/wav", invocation: { toolId: 71, revision: "9" }, inputSchema: {
  type: "object", additionalProperties: false, required: ["input", "voice"], properties: { input: { type: "string", maxLength: 256 }, voice: { type: "string", maxLength: 64 } },
} };

test("native audio eligibility and binding use the explicit server contract", async () => {
  assert.equal(workflowToolEligible(row), true);
  validateWorkflowTool(row, schema);
  assert.deepEqual(workflowInvocation(71, schema, { input: "你好", voice: "fixture" }), { toolId: 71, revision: "9", arguments: { input: "你好", voice: "fixture" } });
  assert.equal(await directMediaTool(row.nativeModel, [row], async () => schema), null);
  assert.equal(workflowToolEligible({ id: 1, imported: true, status: "ready" }), true);
  for (const change of [{ nativeCapability: undefined }, { nativeCapability: "fake" }, { nativeModel: "other" }, { status: "held" }, { status: undefined }, { imported: true }, { mediaModel: row.nativeModel }]) {
    assert.equal(workflowToolEligible({ ...row, ...change }), false);
    assert.throws(() => validateWorkflowTool({ ...row, ...change }, schema));
  }
  for (const change of [{ nativeCapability: "fake" }, { nativeCapability: undefined }, { model: "other" }, { output: "text/html" }, { invocation: { toolId: 72, revision: "9" } }, { inputSchema: { ...schema.inputSchema, additionalProperties: true } }, { inputSchema: { ...schema.inputSchema, properties: { ...schema.inputSchema.properties, token: { type: "string" } } } }]) {
    assert.throws(() => validateWorkflowTool(row, { ...schema, ...change }));
  }
});
