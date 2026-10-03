import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let validation: any;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  validation = await vite.ssrLoadModule("/src/addons/administration/agents/definitionValidation.ts");
});
after(async () => { await vite.close(); });

test("definitionIMRequiresModel: IM identity without a model is blocked", () => {
  assert.equal(validation.definitionIMRequiresModel("42", ""), true);
  assert.equal(validation.definitionIMRequiresModel("42", "  "), true);
});

test("definitionIMRequiresModel: IM identity with a model is allowed", () => {
  assert.equal(validation.definitionIMRequiresModel("42", "gpt-test"), false);
});

test("definitionIMRequiresModel: no IM identity never requires a model (unchanged behavior)", () => {
  assert.equal(validation.definitionIMRequiresModel("", ""), false);
  assert.equal(validation.definitionIMRequiresModel("  ", "anything"), false);
});

test("form: inline error field and disabled save wire to the shared guard", () => {
  const src = readFileSync(new URL("../src/addons/administration/views/admin/AdminAgents.vue", import.meta.url), "utf8");
  assert.match(src, /definitionIMRequiresModel/, "component reuses the shared validation, not a second copy");
  assert.match(src, /data-testid="agent-model-error"/, "inline error renders next to the model field");
  assert.match(src, /:disabled="saving \|\| !!modelError"/, "save is blocked while the error is active");
  assert.match(src, /errorText\(error\)/, "server rejection message is surfaced via the existing ApiError toast path");
});

test("i18n: errIMRequiresModel exists in zh and en", () => {
  for (const locale of ["zh", "en"]) {
    const text = readFileSync(new URL(`../src/i18n/${locale}.ts`, import.meta.url), "utf8");
    assert.match(text, /errIMRequiresModel:/, locale);
  }
});
