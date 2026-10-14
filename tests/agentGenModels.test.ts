// UI-IMPL-6 P1: admin "生成模型" block — one select per enabled registry kind.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildChanges, definitionFields, genModelState } from "../src/addons/administration/agents/definition/draft.ts";
import { createDefinitionApi } from "../src/addons/administration/agents/definition/api.ts";

const IMG = "/config/defaults/imageModel", VID = "/config/defaults/videoModel";

test("fields: one genModel per enabled kind (music reserved)", () => {
  const gen = definitionFields.filter(f => f.kind === "genModel");
  assert.deepEqual(gen.map(f => [f.path, f.genKind]), [[IMG, "image"], [VID, "video"]]);
  assert.ok(!definitionFields.some(f => f.path === "/config/defaults/musicModel"));
});

test("changes: editable only when the server grants the path; empty = platform default", () => {
  assert.deepEqual(buildChanges({ config: { defaults: { imageModel: "a" } } }, { [IMG]: "" }, [IMG]), { [IMG]: "" });
  assert.throws(() => buildChanges({}, { [VID]: "v" }, [IMG]), /Read-only/);
});

test("state: unset / ok / delisted / unknown when catalog failed", () => {
  const list = [{ providerId: 1, model: "a", kind: "image", verified: true }];
  assert.equal(genModelState("", list), "unset");
  assert.equal(genModelState("a", list), "ok");
  assert.equal(genModelState("gone", list), "delisted");
  assert.equal(genModelState("gone", null), "unknown");
});

test("api.genModels reads the media catalog (no code envelope) and throws on old sync", async () => {
  let url = "";
  const data = [{ providerId: 1, model: "a", kind: "video", verified: false }];
  const api = createDefinitionApi(async (path) => { url = path; return { status: 200, headers: {}, body: { typesAvailable: true, data } }; });
  assert.deepEqual(await api.genModels("video"), data);
  assert.equal(url, "/api/v1/addons/media/models?kind=video");
  await assert.rejects(createDefinitionApi(async () => ({ status: 200, headers: {}, body: { typesAvailable: false, data: [] } })).genModels("image"));
  await assert.rejects(createDefinitionApi(async () => ({ status: 403, headers: {}, body: {} })).genModels("image"));
});

test("view: block heading, platform-default first option, verified tags, red delisted, readonly via editablePaths", () => {
  const fields = readFileSync(new URL("../src/addons/administration/agents/definition/DefinitionFields.vue", import.meta.url), "utf8");
  const drawer = readFileSync(new URL("../src/addons/administration/agents/definition/DefinitionDrawer.vue", import.meta.url), "utf8");
  assert.match(fields, /label\('genInherit'\)/);
  assert.match(fields, /label\('genVerified'\)/);
  assert.match(fields, /label\('genUnverified'\)/);
  assert.match(fields, /label\('genDelisted'\)/);
  assert.match(drawer, /label\('genModels'\)/);
  assert.match(drawer, /api\.genModels/);
});
