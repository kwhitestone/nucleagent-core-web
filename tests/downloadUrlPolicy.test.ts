import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeDownloadUrl } from "../src/addons/conversation/api/downloadUrlPolicy.ts";

test("download URLs allow only absolute HTTP(S) targets", () => {
  assert.equal(
    assertSafeDownloadUrl("https://cdn.example.com/report.pdf?token=abc"),
    "https://cdn.example.com/report.pdf?token=abc",
  );
  assert.equal(
    assertSafeDownloadUrl("http://localhost:26610/blob/report.pdf"),
    "http://localhost:26610/blob/report.pdf",
  );

  for (const value of [
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "/relative/download",
    "not a url",
  ]) {
    assert.throws(() => assertSafeDownloadUrl(value), /下载地址不安全/);
  }
});
