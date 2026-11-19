import assert from "node:assert/strict";
import { test } from "node:test";
import { engineInput } from "./fixtures/workflowTyped.ts";
import { directMediaTool, directMediaRequest, workflowFields } from "../src/chat-react/workflowParams.ts";

const schema = { model: "jimeng_v30_1080p", invocation: { toolId: 788, revision: "5" }, inputSchema: {
  type: "object", additionalProperties: false, required: ["prompt", "duration", "resolution", "image_url"],
  properties: Object.fromEntries(["prompt", "duration", "resolution", "image_url", "seed", "aspect_ratio"].map(name => [name, engineInput.properties[name]])),
} };
const rows = [{ id: 788, imported: true, status: "ready", mediaModel: schema.model }];

test("real video parameters remain visible while missing controlled image binding refuses sending", async () => {
  const direct = await directMediaTool(schema.model, rows, async () => schema);
  assert.ok(direct);
  assert.equal(workflowFields(direct.schema, true).find(([name]) => name === "seed")?.[1].type, "integer");
  assert.throws(() => directMediaRequest(direct, { duration: "5", resolution: "1080p" }, "video"));
  assert.throws(() => directMediaRequest(direct, { duration: "5", resolution: "1080p", image_url: "https://example.test/forged.png" }, "video"));
  assert.equal(await directMediaTool(schema.model, [{ ...rows[0], status: "disabled" }], async () => schema), null);
});

test("schema-backed direct parameters serialize integers and preserve optional zero without guessing fields", async () => {
  const definition = { ...schema, inputSchema: { ...schema.inputSchema, required: ["prompt", "duration", "resolution"], properties: { ...schema.inputSchema.properties } } };
  delete definition.inputSchema.properties.image_url;
  const direct = await directMediaTool(schema.model, rows, async () => definition);
  assert.ok(direct);
  assert.deepEqual(directMediaRequest(direct, { duration: "5", resolution: "1080p", seed: "0", aspect_ratio: "" }, "video").toolInvocation.arguments,
    { prompt: "video", duration: 5, resolution: "1080p", seed: 0 });
  for (const params of [{ duration: "7" }, { duration: "5.5" }, { duration: "" }, { duration: "5", seed: "9007199254740993" }, { duration: "5", injected: "x" }]) {
    assert.throws(() => directMediaRequest(direct, { resolution: "1080p", ...params }, "video"));
  }
});
