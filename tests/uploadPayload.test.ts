import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";

import { buildUploadRequestBody } from "../src/addons/conversation/api/uploadPayload.ts";

test("local upload credentials send the raw file without multipart overhead", () => {
  const file = new File(["payload"], "report.txt", { type: "text/plain" });

  const body = buildUploadRequestBody(file, {});

  assert.strictEqual(body, file);
});

test("form-based upload credentials keep provider fields and configured file field", async () => {
  const file = new File(["payload"], "report.txt", { type: "text/plain" });

  const body = buildUploadRequestBody(file, {
    formFields: { path: "/core/reports", scope: "1" },
    fileField: "filename",
  });

  assert.ok(body instanceof FormData);
  assert.equal(body.get("path"), "/core/reports");
  assert.equal(body.get("scope"), "1");
  const uploaded = body.get("filename");
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, file.name);
  assert.equal(uploaded.type, file.type);
  assert.equal(await uploaded.text(), await file.text());
});

test("an explicit file field selects multipart even without extra form fields", async () => {
  const file = new File(["payload"], "report.txt", { type: "text/plain" });

  const body = buildUploadRequestBody(file, { fileField: "file" });

  assert.ok(body instanceof FormData);
  const uploaded = body.get("file");
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, file.name);
  assert.equal(await uploaded.text(), await file.text());
});

test("form fields without a file field use the provider contract default", () => {
  const file = new File(["payload"], "report.txt", { type: "text/plain" });

  const body = buildUploadRequestBody(file, { formFields: { scope: "1" } });

  assert.ok(body instanceof FormData);
  assert.ok(body.get("filename") instanceof File);
});
