import assert from "node:assert/strict";
import { test } from "node:test";
import { directMediaTool, workflowFields, workflowInvocation } from "../src/chat-react/workflowParams.ts";
import { videoSchema, scalarSchema } from "./fixtures/workflowTyped.ts";

test("saved engine duration and required input declarations survive typed field discovery", () => {
  assert.deepEqual(workflowFields(videoSchema, true).map(([name]) => name), ["prompt", "image_url", "duration", "resolution"]);
  assert.deepEqual(videoSchema.inputSchema.required, ["prompt", "image_url"]);
  assert.deepEqual(workflowFields(videoSchema, true).find(([name]) => name === "duration")?.[1].enum, [5, 10]);
});

test("saved Core scalar contract preserves number, false, zero and string values in JSON", () => {
  const values = { prompt: "p", duration: 5, length: 0, cfg: 0.5, watermark: false };
  const request = workflowInvocation(38, scalarSchema, values);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { toolId: 38, revision: "7", arguments: values });
  assert.deepEqual(workflowInvocation(38, scalarSchema, { prompt: "p" }).arguments, { prompt: "p" });
});

test("numeric types, enum, bounds and unsafe numbers cannot be coerced or rounded through", () => {
  for (const bad of [{ duration: "5" }, { duration: 7 }, { duration: 5.5 }, { length: 16 }, { length: -2 },
    { length: Number.MAX_SAFE_INTEGER + 1 }, { cfg: NaN }, { cfg: Infinity }, { watermark: "false" }, { watermark: 0 }]) {
    assert.throws(() => workflowInvocation(38, scalarSchema, { prompt: "p", ...bad }), JSON.stringify(bad));
  }
  const bounded = { ...scalarSchema, inputSchema: { ...scalarSchema.inputSchema, properties: {
    ratio: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1.5 },
  }, required: ["ratio"] } };
  assert.equal(workflowInvocation(38, bounded, { ratio: 0.5 }).arguments.ratio, 0.5);
  for (const ratio of [0, 1.5, -1, "0.5"]) assert.throws(() => workflowInvocation(38, bounded, { ratio }));
});

test("required image and prompt guards use saved minLength and Unicode maxLength", () => {
  for (const values of [{ prompt: "p" }, { prompt: "p", image_url: "" }, { prompt: "", image_url: "fixture" },
    { prompt: "😀".repeat(5001), image_url: "fixture" }]) {
    assert.throws(() => workflowInvocation(37, videoSchema, values));
  }
  assert.equal(workflowInvocation(37, videoSchema, { prompt: "😀".repeat(5000), image_url: "fixture", duration: 10 }).arguments.duration, 10);
});

test("caller capsule and non-caller parameters remain closed", () => {
  for (const key of ["model", "api_key", "base_url", "__user_id__", "ucToken", "toolRevision", "revision", "extra"]) {
    assert.throws(() => workflowInvocation(38, scalarSchema, { prompt: "p", [key]: "override" }));
  }
  assert.throws(() => workflowInvocation(37, scalarSchema, { prompt: "p" }));
  assert.throws(() => workflowFields({ ...scalarSchema, invocation: { toolId: 38, revision: "1e3" } }, true));
  assert.throws(() => workflowFields({ ...scalarSchema, inputSchema: { ...scalarSchema.inputSchema, required: ["seed"] } }, true));
});

test("legacy string discovery and direct media required input gates stay unchanged", async () => {
  assert.deepEqual(workflowFields(videoSchema).map(([name]) => name), ["prompt", "image_url", "resolution"]);
  const rows = [{ id: 37, imported: true, status: "ready", mediaModel: "video-model" }];
  assert.equal(await directMediaTool("video-model", rows, async () => videoSchema), null);
  const requiredNumber = { ...videoSchema, inputSchema: { ...videoSchema.inputSchema, required: ["prompt", "duration"] } };
  assert.equal(await directMediaTool("video-model", rows, async () => requiredNumber), null);
});

test("typed boolean enum and malformed numeric declarations fail closed", () => {
  const definition = (field: object) => ({ ...scalarSchema, inputSchema: {
    type: "object", additionalProperties: false, required: ["value"], properties: { value: field },
  } });
  assert.equal(workflowInvocation(38, definition({ type: "boolean", enum: [false] }), { value: false }).arguments.value, false);
  assert.throws(() => workflowInvocation(38, definition({ type: "boolean", enum: [false] }), { value: true }));
  for (const field of [{ type: "integer", enum: ["5"] }, { type: "number", minimum: "0" },
    { type: "integer", maximum: Number.MAX_SAFE_INTEGER + 1 }, { type: "integer", enum: [] }]) {
    assert.throws(() => workflowFields(definition(field), true));
  }
});
