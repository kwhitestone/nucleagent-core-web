import assert from "node:assert/strict";
import test from "node:test";
import { generates } from "../src/chat-react/modelGroups.ts";

for (const [kind, type, caps] of [
  ["image", "image", ["t2i","i2i"]],
  ["video", "video", ["t2v","i2v"]],
  ["music", "audio", ["music"]],
] as const) {
  test(kind + " requires a matching declared output on the route", () => {
    for (const cap of caps) assert.equal(generates(kind, { type, capabilities: [cap] }), true);
    for (const cap of ["vision_in","tools","stream","tts","asr","",kind === "image" ? "t2v" : "t2i"]) {
      assert.equal(generates(kind, { type, capabilities: [cap] }), false);
    }
    assert.equal(generates(kind, { type: "chat", capabilities: ["tools","vision_in"] }), false);
  });
}
