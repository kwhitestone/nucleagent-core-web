import assert from "node:assert/strict";
import { test } from "node:test";
import { directMediaRequest, directMediaTool } from "../src/chat-react/workflowParams.ts";

// MUYU-365 exp4: Core projects an imported Toolgate job tool with the source's own prompt
// parameter name (e.g. seedream 684: required ["prompt"], no "input"). The composer text is that prompt.
const seedream = { model: "doubao-seedream-5-0-260128", invocation: { toolId: 684, revision: "8" },
  inputSchema: { type: "object", additionalProperties: false, required: ["prompt"],
    properties: { prompt: { type: "string" }, aspect_ratio: { type: "string" }, quality: { type: "string" }, prompts: { type: "array" } } } };
const rows = [{ id: 684, imported: true, status: "ready", mediaModel: "doubao-seedream-5-0-260128" }];

test("a job tool whose only free-text required parameter is `prompt` takes the composer text as that prompt", async () => {
  const direct = await directMediaTool("doubao-seedream-5-0-260128", rows, async () => seedream);
  assert.equal(direct?.toolId, 684);
  assert.equal(direct?.prompt, "prompt");
  assert.deepEqual(directMediaRequest(direct!, { quality: "" }, "一只猫"),
    { toolIds: [684], toolInvocation: { toolId: 684, revision: "8", arguments: { prompt: "一只猫" } } });
});

test("`input` keeps priority, and other free-text required parameters still keep the model closed", async () => {
  const withInput = { ...seedream, inputSchema: { ...seedream.inputSchema, required: [], properties: { ...seedream.inputSchema.properties, input: { type: "string" } } } };
  assert.equal((await directMediaTool("doubao-seedream-5-0-260128", rows, async () => withInput))?.prompt, "input");
  // 685-like: prompt + reference_url both free text and required -> closed.
  const twoFree = { ...seedream, inputSchema: { ...seedream.inputSchema, required: ["prompt", "reference_url"], properties: { ...seedream.inputSchema.properties, reference_url: { type: "string" } } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => twoFree), null);
  // An enum prompt is not free text.
  const enumPrompt = { ...seedream, inputSchema: { ...seedream.inputSchema, properties: { prompt: { type: "string", enum: ["a"] } } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => enumPrompt), null);
  // Video-like projection with no text field at all stays closed.
  const noText = { ...seedream, inputSchema: { type: "object", additionalProperties: false, properties: { aspect_ratio: {}, seed: {} } } };
  assert.equal(await directMediaTool("doubao-seedream-5-0-260128", rows, async () => noText), null);
});

test("the first usable bound row wins when several tools map to one model", async () => {
  const many = [{ id: 685, imported: true, status: "ready", mediaModel: "m" }, { id: 684, imported: true, status: "ready", mediaModel: "m" }];
  const load = async (id: number) => id === 685
    ? { ...seedream, model: "m", invocation: { toolId: 685, revision: "8" }, inputSchema: { ...seedream.inputSchema, required: ["prompt", "reference_url"], properties: { prompt: { type: "string" }, reference_url: { type: "string" } } } }
    : { ...seedream, model: "m" };
  assert.equal((await directMediaTool("m", many, load))?.toolId, 684);
});
