import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAttachmentSize,
  isImageAttachment,
} from "../src/addons/conversation/components/attachmentPresentation.ts";

test("image attachment detection supports canonical kind and legacy MIME metadata", () => {
  assert.equal(isImageAttachment({ fileId: "1", name: "a.jpg", kind: "image" }), true);
  assert.equal(
    isImageAttachment({ fileId: "2", name: "b.png", mimeType: "image/png" }),
    true,
  );
  assert.equal(
    isImageAttachment({ fileId: "3", name: "not-image.bin", mimeType: "image/png", kind: "file" }),
    false,
  );
  assert.equal(
    isImageAttachment({ fileId: "4", name: "report.pdf", mimeType: "application/pdf", kind: "pdf" }),
    false,
  );
});

test("attachment sizes use compact binary units", () => {
  assert.equal(formatAttachmentSize(), "");
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(1536), "1.5 KB");
  assert.equal(formatAttachmentSize(1536 * 1024), "1.5 MB");
});
