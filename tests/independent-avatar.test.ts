import assert from "node:assert/strict";
import { test } from "node:test";
import { createDefinitionApi, type Detail } from "../src/addons/administration/agents/definition/api.ts";
import { DefinitionEditor } from "../src/addons/administration/agents/definition/state.ts";

const detail = (): Detail => ({
  definition: { id: 4, name: "synthetic", slug: "synthetic", revision: "1", isActive: false, config: {} },
  capabilities: { read: true, write: true, writeIdentity: false, delete: false, restore: false,
    readSkills: false, writeSkillBindings: false, readTools: false, writeTools: false },
  fieldPolicy: { editablePaths: ["/config/description"], readOnlyPaths: [], protectedPaths: [], unknownPaths: [], reasons: {} },
  skills: [], tools: [], skillBindings: [], identity: { uid: 8, status: "ready" },
  effective: { revision: "1", definitionRevision: "1" }, etag: '"agent-4-1"',
});
// The browser pipeline only inspects MIME/size; these are synthetic 1x1 PNG bytes.
const image = () => new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64")],
  "synthetic.png", { type: "image/png" });

for (const status of [401, 403]) test(`independent: successful POST then GET ${status} clears protected state`, async () => {
  let posts = 0;
  const api = createDefinitionApi(async (_path, init) => {
    if (init?.method === "POST") {
      posts++;
      return { status: 200, headers: {}, body: { fileId: "synthetic", path: "/api/v1/avatars/synthetic" } };
    }
    return { status, headers: {}, body: { code: "forbidden" } };
  });
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = image();
  await editor.save(api);
  await editor.save(api);
  assert.equal(posts, 1, "no blind resend");
  assert.deepEqual({ recordRetained: editor.record !== null, imageRetained: editor.avatar !== undefined },
    { recordRetained: false, imageRetained: false }, "readback revocation must erase protected record and image");
});

test("independent: explicit read revocation clears pending image", () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = image();
  const denied = detail(); denied.capabilities.read = false;
  editor.acceptRefresh(denied);
  assert.equal(editor.record, null);
  assert.equal(editor.avatar, undefined);
});

test("independent: write revocation clears pending image", () => {
  const editor = new DefinitionEditor();
  editor.open(detail()); editor.avatar = image();
  const denied = detail(); denied.capabilities.write = false;
  editor.acceptRefresh(denied);
  assert.equal(editor.avatar, undefined, "write revocation must clear pending upload state");
});
