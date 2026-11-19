import assert from "node:assert/strict";
import { test } from "node:test";
import { directMediaRequest, workflowFormInvocation } from "../src/chat-react/workflowParams.ts";

const schema = { invocation: { toolId: 789, revision: "5" }, inputSchema: { type: "object", additionalProperties: false, required: ["prompt", "first_frame_url", "last_frame_url"], properties: {
  prompt: { type: "string", minLength: 1 }, first_frame_url: { type: "string", "x-owned-image": true, minLength: 15, maxLength: 142 }, last_frame_url: { type: "string", "x-owned-image": true, minLength: 15, maxLength: 142 }, duration: { type: "integer", enum: [5, 10] },
} } };
test("controlled native image fields bind owner references through workflow and direct model selection", () => {
  const values = { first_frame_url: "storage-image:first", last_frame_url: "storage-image:last", duration: "5" };
  const direct = { toolId: 789, schema, prompt: "prompt" };
  const request = directMediaRequest(direct, values, "animate");
  assert.deepEqual(request.toolInvocation, workflowFormInvocation(789, schema, { ...values, prompt: "animate" }));
  assert.equal(request.toolInvocation.arguments.duration, 5);
  for (const image of ["", "https://images.test/own.png", "http://127.0.0.1/", "data:image/png;base64,aA==", "storage-image:../file"]) {
    assert.throws(() => directMediaRequest(direct, { ...values, first_frame_url: image }, "animate"));
    assert.throws(() => workflowFormInvocation(789, schema, { ...values, prompt: "animate", first_frame_url: image }));
  }
  for (const key of ["api_key", "model", "base_url", "__portal_auth_token__"]) assert.throws(() => directMediaRequest(direct, { ...values, [key]: "override" }, "animate"));
});
