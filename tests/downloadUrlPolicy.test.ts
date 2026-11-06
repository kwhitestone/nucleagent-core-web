import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeDownloadUrl, isSealedToolLink } from "../src/addons/conversation/api/downloadUrlPolicy.ts";

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

test("MUYU-181: only http(s) links with a sealed ticket go through the owner tool-link endpoint", () => {
  assert.equal(isSealedToolLink("https://wb.example.com/52?token=nlk.AbC_-1&lang=zh"), true);
  assert.equal(isSealedToolLink("https://wb.example.com/52?lang=zh&session=nlk.x"), true);
  assert.equal(isSealedToolLink("https://wb.example.com/52?token=***&lang=zh"), false);
  assert.equal(isSealedToolLink("https://wb.example.com/nlk./a?q=1"), false);
  assert.equal(isSealedToolLink("javascript:alert(1)//?token=nlk.x"), false);
});
