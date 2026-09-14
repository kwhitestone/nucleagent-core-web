import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("core web is composed from scoped V2 addons", () => {
  const main = source("main.ts");
  const router = source("router/index.ts");
  const conversation = source("addons/conversation/index.ts");
  const administration = source("addons/administration/index.ts");
  const modelCatalog = source("addons/model-catalog/index.ts");
  const platformApi = source("addons/platform-api/index.ts");
  const shellBridge = source("addons/conversation/composables/useShellBridge.ts");

  assert.match(main, /@prism-fusion\/plugin-runtime/);
  assert.match(main, /await nextHost\.install\(\)[\s\S]*nextApp\.use\(router\)/);
  assert.doesNotMatch(router, /views\//);
  assert.doesNotMatch(router, /beforeEach/);
  assert.match(conversation, /routeScopes:\s*\[[^\]]*["']\/chat["']/s);
  assert.match(conversation, /requires:\s*\[[^\]]*model-catalog/s);
  assert.match(administration, /requires:\s*\[[^\]]*model-catalog/s);
  assert.match(administration, /routeScopes:\s*\[[^\]]*["']\/admin["']/s);
  assert.match(modelCatalog, /routeScopes:\s*\[\]/);
  assert.match(platformApi, /router\.beforeEach/);
  assert.match(shellBridge, /createRemoteChildChannel/);
  assert.doesNotMatch(shellBridge, /window\.parent\.postMessage/);
  assert.equal(existsSync(new URL("../src/views", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/task-conversation", import.meta.url)), false);
});
