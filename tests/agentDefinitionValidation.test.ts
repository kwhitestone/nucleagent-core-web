import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as validation from "../src/addons/administration/agents/definitionValidation.ts";

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
  const src = readFileSync(new URL("../src/addons/administration/agents/definition/DefinitionDrawer.vue", import.meta.url), "utf8");
  const fields = readFileSync(new URL("../src/addons/administration/agents/definition/useDefinitionFields.ts", import.meta.url), "utf8");
  assert.match(src, /validateChanges\(record\.value\.definition, editor\.changes\)/);
  const control = readFileSync(new URL("../node_modules/@prism-fusion/editor-ui/dist/editor.js", import.meta.url), "utf8");
  assert.match(fields, /const error = shownError\(field.path\)/);
  assert.match(fields, /invalid: !!error \|\| delisted/);
  assert.match(control, /"aria-invalid": !!\w+\.invalid/);
  assert.match(src, /Object\.keys\(errors\)\.length/);
  assert.match(src, /role="alert"/);
});

test("i18n: errIMRequiresModel exists in zh and en", () => {
  for (const locale of ["zh", "en"]) {
    const text = readFileSync(new URL(`../src/i18n/${locale}.ts`, import.meta.url), "utf8");
    assert.match(text, /errIMRequiresModel:/, locale);
  }
});
