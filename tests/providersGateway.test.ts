import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { gatewayModels } from "../src/addons/administration/provider/gatewayEntry.ts";

// UNI-UI-GAP gap 1: the Providers page is one read-only 目鱼网关 entry.
test("the gateway entry lists the active rows' models once; collapsed and A2A rows are hidden", () => {
  const row = (id: number, name: string, isActive: boolean, models: unknown) =>
    ({ id, name, isActive, config: { models } as never });
  assert.deepEqual(gatewayModels([
    row(1, "OpenAI", true, ["gpt-4o", " glm-5.2 "]),
    row(2, "glm", true, ["glm-5.2", "", 7]),
    row(3, "everai", false, ["kimi-k2.6"]),
    row(4, "ext:a2a:peer", true, ["peer-model"]),
    { id: 5, name: "bare", isActive: true },
  ]), ["gpt-4o", "glm-5.2"]);
  assert.deepEqual(gatewayModels([]), []);
});

test("the Providers page has no create, edit, toggle or delete path", () => {
  const view = readFileSync("src/addons/administration/views/Providers.vue", "utf8");
  assert.doesNotMatch(view, /createProvider|updateProvider|deleteProvider|api\/provider|<input|<form|@click/);
  assert.match(view, /provider\.gatewayName/);
  assert.match(view, /data-testid="provider-gateway"/);
  assert.doesNotMatch(view, /v-for="p in providers"/, "old rows are not listed");
});
