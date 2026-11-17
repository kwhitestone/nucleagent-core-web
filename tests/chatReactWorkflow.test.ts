import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowFields, workflowInvocation } from "../src/chat-react/workflowParams.ts";

const schema = { invocation: { toolId: 37, revision: "9007199254740993" }, inputSchema: {
  type: "object", additionalProperties: false, required: ["style"],
  properties: { style: { type: "string", enum: ["水彩", "素描"], maxLength: 5 }, topic: { type: "string", maxLength: 3 }, pic: { type: "array" } },
} };

test("workflow fields and arguments come only from the selected source schema", () => {
  assert.deepEqual(workflowFields(schema).map(([name]) => name), ["style", "topic"]);
  assert.deepEqual(workflowInvocation(37, schema, { style: "水彩", topic: "海边" }), {
    toolId: 37, revision: "9007199254740993", arguments: { style: "水彩", topic: "海边" },
  });
  for (const args of [{}, { style: "invented" }, { style: "水彩", topic: "four" }, { style: "水彩", duration: "5" }]) {
    assert.throws(() => workflowInvocation(37, schema, args));
  }
  assert.throws(() => workflowInvocation(38, schema, { style: "水彩" }));
  assert.throws(() => workflowFields({ ...schema, invocation: undefined }));
  assert.throws(() => workflowFields({ ...schema, inputSchema: { ...schema.inputSchema, required: ["pic"] } }));
});

test("a selected media model resolves to its own Toolgate job tool and real parameters, else stays closed", async () => {
  const { directMediaTool, directMediaRequest, workflowInvocation } = await import("../src/chat-react/workflowParams.ts");
  const schema = { model: "image-model", invocation: { toolId: 9, revision: "4" },
    inputSchema: { type: "object", additionalProperties: false, properties: { input: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] } } } };
  const rows = [{ id: 8, imported: true, status: "ready", mediaModel: "video-model" }, { id: 9, imported: true, status: "ready", mediaModel: "image-model" }];
  const loads: number[] = [];
  const load = async (id: number) => { loads.push(id); return schema; };
  const direct = await directMediaTool("image-model", rows, load);
  assert.equal(direct?.toolId, 9);
  assert.deepEqual(loads, [9]);
  assert.deepEqual(directMediaRequest(direct!, { aspect_ratio: "16:9", note: "" }, "一只猫"), { toolIds: [9], toolInvocation: { toolId: 9, revision: "4", arguments: { input: "一只猫", aspect_ratio: "16:9" } } });
  // The model and unknown parameters are never client-chosen.
  assert.throws(() => workflowInvocation(9, direct!.schema, { input: "x", model: "other" }));
  assert.throws(() => workflowInvocation(9, direct!.schema, { input: "x", duration: "5" }));
  assert.throws(() => workflowInvocation(9, direct!.schema, { input: "x", aspect_ratio: "21:9" }));
  // Fail closed: no tool for the model, held tool, another model's schema, another tool's capsule, no prompt field.
  assert.equal(await directMediaTool("unlisted", rows, load), null);
  assert.equal(await directMediaTool("image-model", [{ ...rows[1], status: "unavailable" }], load), null);
  assert.equal(await directMediaTool("video-model", rows, load), null);
  assert.equal(await directMediaTool("image-model", rows, async () => ({ ...schema, invocation: { toolId: 8, revision: "4" } })), null);
  assert.equal(await directMediaTool("image-model", rows, async () => ({ ...schema, inputSchema: { ...schema.inputSchema, properties: { aspect_ratio: schema.inputSchema.properties.aspect_ratio } } })), null);
  assert.equal(await directMediaTool("image-model", rows, async () => ({ ...schema, inputSchema: { ...schema.inputSchema, required: ["seed"], properties: { ...schema.inputSchema.properties, seed: { type: "string" } } } })), null);
  assert.equal(await directMediaTool("image-model", rows, async () => { throw new Error("403"); }), null);
});
