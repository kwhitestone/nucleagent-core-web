import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderConfig,
  parseProviderModels,
  providerConfigToForm,
  validateProviderURLs,
  validateProviderModelLimits,
} from "../src/addons/administration/provider/providerConfig.ts";

test("round-trips responses settings without dropping unknown provider config", () => {
  const existing = {
    baseUrl: "https://api.example.com/v4",
    responsesBaseUrl: "https://api.example.com/v1",
    responsesMode: "translate" as const,
  messagesBaseUrl: "https://api.example.com/anthropic",
  messagesMode: "native" as const,
    apiFormat: "openai",
    authScheme: "bearer",
    models: ["model-a"],
    vendorOption: { enabled: true },
  };

  const form = providerConfigToForm(existing);
  assert.equal(form.responsesMode, "translate");
  assert.equal(form.responsesBaseUrl, "https://api.example.com/v1");
  assert.equal(form.messagesMode, "native");
  assert.equal(form.messagesBaseUrl, "https://api.example.com/anthropic");
  form.models = "model-a, model-b\nmodel-a";
  const saved = buildProviderConfig(form, existing);

  assert.deepEqual(saved.models, ["model-a", "model-b"]);
  assert.deepEqual(saved.vendorOption, { enabled: true });
  assert.deepEqual(existing.models, ["model-a"]);
});

test("model budgets round-trip exact names without altering native capabilities or vendor fields", () => {
  const existing = {
    models: ["model-a", "model-b"], modelApiFormats: { "model-a": ["gemini"] },
    modelLimits: { "model-a": { contextWindow: 131072, maxOutputTokens: 8192 } },
    vendorOption: { enabled: true },
  };
  const form = providerConfigToForm(existing);
  assert.deepEqual(form.modelLimits["model-a"], { contextWindow: "131072", maxOutputTokens: "8192" });
  form.modelLimits["model-a"] = { contextWindow: "65536", maxOutputTokens: "4096" };
  form.modelLimits["model-b"] = { contextWindow: "", maxOutputTokens: "" };
  assert.equal(validateProviderModelLimits(form), null);
  const saved = buildProviderConfig(form, existing);
  assert.deepEqual(saved.modelLimits, { "model-a": { contextWindow: 65536, maxOutputTokens: 4096 } });
  assert.deepEqual(existing.modelLimits, { "model-a": { contextWindow: 131072, maxOutputTokens: 8192 } });
  assert.deepEqual(saved.modelApiFormats, existing.modelApiFormats);
  assert.deepEqual(saved.vendorOption, existing.vendorOption);
});

test("unconfigured model budgets stay absent and clearing both inputs removes an override", () => {
  const legacy = providerConfigToForm({ models: ["model-a"] });
  assert.deepEqual(legacy.modelLimits, {});
  assert.equal(buildProviderConfig(legacy).modelLimits, undefined);
  const existing = { models: ["model-a"], modelLimits: { "model-a": { contextWindow: 32768, maxOutputTokens: 4096 } } };
  const form = providerConfigToForm(existing);
  form.modelLimits["model-a"] = { contextWindow: " ", maxOutputTokens: "" };
  assert.equal(validateProviderModelLimits(form), null);
  assert.deepEqual(buildProviderConfig(form, existing).modelLimits, {});
  const reservedNames = providerConfigToForm({ models: ["constructor", "toString", "__proto__"] });
  assert.equal(validateProviderModelLimits(reservedNames), null);
  assert.equal(buildProviderConfig(reservedNames).modelLimits, undefined);
});

test("model budget validation rejects partial, noninteger and out-of-range limits", () => {
  const form = providerConfigToForm({ models: ["model-a"] });
  for (const [contextWindow, maxOutputTokens] of [["", "4096"], ["32768", ""], ["abc", "1"], ["1023", "1"], ["2097153", "1"], ["32768.5", "1"], ["32768", "0"], ["32768", "32768"], ["2097152", "262145"], ["32768", "1.5"]]) {
    const invalid = { ...form, modelLimits: { "model-a": { contextWindow, maxOutputTokens } } };
    assert.deepEqual(validateProviderModelLimits(invalid), { model: "model-a" });
    assert.throws(() => buildProviderConfig(invalid), /Invalid model limits/);
  }
  for (const [contextWindow, maxOutputTokens] of [["1024", "1023"], ["2097152", "262144"], ["32768", "4096"]]) {
    assert.equal(validateProviderModelLimits({ ...form, modelLimits: { "model-a": { contextWindow, maxOutputTokens } } }), null);
  }
});

test("deliberate model removal drops its budget while unrelated edits preserve metadata", () => {
  const existing = { models: ["model-a", "model-b"], modelLimits: {
    "model-a": { contextWindow: 32768, maxOutputTokens: 4096 },
    "model-b": { contextWindow: 65536, maxOutputTokens: 8192 },
  } };
  const form = providerConfigToForm(existing);
  assert.deepEqual(buildProviderConfig(form, existing).modelLimits, existing.modelLimits);
  form.models = "model-b";
  assert.deepEqual(buildProviderConfig(form, existing).modelLimits, { "model-b": existing.modelLimits["model-b"] });
});

test("defaults legacy configs to native responses mode", () => {
  const form = providerConfigToForm({ baseUrl: "https://api.example.com/v1" });
  assert.equal(form.responsesMode, "native");
  assert.equal(form.messagesMode, "");
  assert.equal(form.responsesBaseUrl, "");
  const saved = buildProviderConfig(form);
  assert.equal(saved.messagesMode, "");
  assert.deepEqual(parseProviderModels(" a, b\na "), ["a", "b"]);
});

test("validates HTTPS and same-origin responses URLs", () => {
  assert.equal(validateProviderURLs("", "", ""), "base_required");
  assert.equal(validateProviderURLs("http://api.example.com", "", ""), "base_https");
  assert.equal(validateProviderURLs("https://user@api.example.com", "", ""), "base_https");
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "http://api.example.com/v1", ""),
    "responses_https",
  );
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "https://other.example.com/v1", ""),
    "responses_origin",
  );
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "https://api.example.com/v1", ""),
    null,
  );
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "", "http://api.example.com/anthropic"),
    "messages_https",
  );
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "", "https://other.example.com/anthropic"),
    "messages_origin",
  );
  assert.equal(
    validateProviderURLs("https://api.example.com/v4", "", "https://api.example.com/anthropic"),
    null,
  );
});
