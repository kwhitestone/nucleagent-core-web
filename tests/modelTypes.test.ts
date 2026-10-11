// MT2-coreweb (Q4 D3 layer 1): chat-only model picker, typed mismatch text,
// admin definition defaults through the picker, gateway type labels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

// Pure modules load natively so the test:unit coverage gate measures them.
import * as options from "../src/addons/conversation/components/modelPickerOptions.ts";
import * as errors from "../src/addons/conversation/composables/modelErrorMessage.ts";
import * as gateway from "../src/addons/administration/provider/gatewayEntry.ts";
import { ApiError } from "../src/contracts/platform-runtime.ts";

let vite: ViteDevServer;
let catalog: any;
let ViteApiError: any;
let zh: any;
let en: any;
const TYPES = ["chat", "image", "video", "audio", "embedding", "rerank", "other"];
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const tOf = (locale: "zh" | "en") => createI18n({ legacy: false, locale, messages: { zh, en } }).global.t;

before(async () => {
  vite = await createServer({ configFile: false, envFile: false, resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } }, appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  catalog = await vite.ssrLoadModule("/src/addons/model-catalog/api/catalog.ts");
  ({ ApiError: ViteApiError } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts"));
  ({ default: zh } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: en } = await vite.ssrLoadModule("/src/i18n/en.ts"));
});
after(async () => { await vite.close(); });

const gw = { id: 1, name: "目鱼网关", isActive: true, config: { models: ["glm-4.7-flash", "gpt-image-2", "kimi-k2.6"] } };
const off = { id: 2, name: "old", isActive: false, config: { models: ["glm-4.7-flash"] } };
const typed = [
  { providerId: 1, model: "glm-4.7-flash", type: "chat", capabilities: [] },
  { providerId: 1, model: "kimi-k2.6", type: "chat", capabilities: [] },
  { providerId: 1, model: "gpt-image-2", type: "image", capabilities: ["t2i"] },
  { providerId: 1, model: "S2V-01", type: "video", capabilities: [] },
];
const flat = (groups: Array<{ id: number; models: string[] }>) => groups.flatMap((g) => g.models.map((m) => `${g.id}:${m}`));

// ---- W1 picker options
test("W1 chat lists only chat models, intersected with config.models", () => {
  assert.deepEqual(flat(options.pickerOptions([gw, off], typed, "chat")), ["1:glm-4.7-flash", "1:kimi-k2.6"]);
  // a chat entry that is not in config.models stays out (intersection)
  assert.deepEqual(flat(options.pickerOptions([gw], [{ providerId: 1, model: "ghost", type: "chat", capabilities: [] }], "chat")), []);
});

test("W1 image lists only image, video only video; nothing from config.models", () => {
  assert.deepEqual(flat(options.pickerOptions([gw], typed, "image")), ["1:gpt-image-2"]);
  assert.deepEqual(flat(options.pickerOptions([gw], typed, "video")), ["1:S2V-01"]);
  assert.deepEqual(flat(options.pickerOptions([gw], typed, "audio")), []);
});

test("W1 old Core (typed=null): chat falls back to config.models, other types list nothing", () => {
  assert.deepEqual(flat(options.pickerOptions([gw, off], null, "chat")), ["1:glm-4.7-flash", "1:gpt-image-2", "1:kimi-k2.6"]);
  assert.deepEqual(flat(options.pickerOptions([gw], null, "image")), []);
  assert.deepEqual(options.pickerOptions([gw], null, "chat")[0].name, "目鱼网关");
});

test("W1 visible-model groups are unchanged for chat and hidden for other types", () => {
  const visible = [
    { configId: 1, model: "fast", alias: "快速", isQuick: true, targetModel: "glm-4.7-flash" },
    { configId: 1, model: "broken", alias: "", isQuick: false, targetModel: "" },
  ];
  assert.deepEqual(options.visiblePickerOptions(visible, "chat").map((m) => m.model), ["fast"]);
  assert.deepEqual(options.visiblePickerOptions(visible, "image"), []);
});

test("W1 ModelPicker: type prop defaults to chat and the template renders pickerOptions", () => {
  const vue = src("addons/conversation/components/ModelPicker.vue");
  assert.match(vue, /type\?: string/);
  assert.match(vue, /type: "chat"/);
  assert.match(vue, /pickerOptions\(providers\.value, typed\.value, props\.type\)/);
  assert.match(vue, /common\.modelNotChat/);
  for (const page of ["views/Home.vue", "views/TaskSetup.vue", "views/Conversation.vue"]) {
    assert.doesNotMatch(src(`addons/conversation/${page}`), /<ModelPicker[^>]*\btype=/, `${page} keeps the chat default`);
  }
});

test("W1 catalog: /provider/models 404 or typesAvailable=false means old Core (null)", async () => {
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  let reply: () => unknown = () => ({ data: { code: 0, typesAvailable: true, data: typed.slice(0, 2) } });
  const urls: string[] = [];
  const unregister = registerPlatformRuntime({ http: { get: async (url: string, cfg: any) => { urls.push(`${url}?type=${cfg?.params?.type}`); return reply(); } } });
  try {
    assert.equal((await catalog.modelCatalog.listTypedModels("chat")).length, 2);
    assert.deepEqual(urls, ["/api/v1/addons/provider/models?type=chat"]);
    reply = () => ({ data: { code: 0, typesAvailable: false, data: [] } });
    assert.equal(await catalog.modelCatalog.listTypedModels("chat"), null);
    reply = () => { throw new ViteApiError("Not Found", "NETWORK_ERROR", 404); };
    assert.equal(await catalog.modelCatalog.listTypedModels("chat"), null);
    reply = () => { throw new ViteApiError("boom", "NETWORK_ERROR", 500); };
    await assert.rejects(catalog.modelCatalog.listTypedModels("chat"));
  } finally {
    unregister();
  }
});

// ---- W2 typed error text
const mismatch = () => new ApiError("模型选择不可用: gpt-image-2 是生图模型", "model_type_mismatch", 400,
  { code: "model_type_mismatch", model: "gpt-image-2", modelType: "image" });

test("W2 model_type_mismatch renders per language", () => {
  const zhText = errors.modelErrorMessage(mismatch(), tOf("zh"));
  const enText = errors.modelErrorMessage(mismatch(), tOf("en"));
  assert.match(zhText, /gpt-image-2/);
  assert.match(zhText, /生图/);
  assert.match(zhText, /聊天模型/);
  assert.match(enText, /gpt-image-2/);
  assert.match(enText, /image/i);
  assert.match(enText, /chat model/i);
  assert.notEqual(zhText, enText);
});

test("W2 other codes and non-API errors are returned as they are", () => {
  const other = new ApiError("模型不在该提供商的可用列表内", "invalid_model", 400, { code: "invalid_model" });
  assert.equal(errors.modelErrorMessage(other, tOf("en")), "模型不在该提供商的可用列表内");
  assert.equal(errors.modelErrorMessage(new Error("x"), tOf("zh"), "创建对话失败"), "创建对话失败");
  assert.equal(errors.modelErrorMessage(new Error("x"), tOf("zh")), "x");
});

test("W2 a mismatch without modelType falls back to the server message", () => {
  const bare = new ApiError("server says no", "model_type_mismatch", 400, { code: "model_type_mismatch", model: "m" });
  assert.equal(errors.modelErrorMessage(bare, tOf("zh")), "server says no");
  const noBody = new ApiError("no body", "model_type_mismatch", 400);
  assert.equal(errors.modelErrorMessage(noBody, tOf("en")), "no body");
});

test("W2 an unknown type value is shown verbatim, not as a missing key", () => {
  const odd = new ApiError("m", "model_type_mismatch", 400, { model: "x-3d", modelType: "mesh3d" });
  assert.match(errors.modelErrorMessage(odd, tOf("en")), /mesh3d/);
});

test("W2 the API error carries the problem body (model, modelType)", () => {
  const http = src("addons/platform-api/api/http.ts");
  assert.match(http, /new ApiError\(message, body\?\.code \?\? "NETWORK_ERROR", status, body\)/);
});

test("W2 Home, TaskSetup and Conversation word errors through modelErrorMessage", () => {
  for (const page of ["Home", "TaskSetup", "Conversation"]) {
    assert.match(src(`addons/conversation/views/${page}.vue`), /modelErrorMessage\(/, page);
  }
});

// ---- W3 i18n
test("W3 new keys exist in zh and en; type names cover all 7 values; key sets stay identical", () => {
  const keys = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
  for (const [name, dict] of [["zh", zh], ["en", en]] as const) {
    assert.ok(dict.model?.typeMismatch, `${name}.model.typeMismatch`);
    assert.ok(dict.common?.modelNotChat, `${name}.common.modelNotChat`);
    for (const type of TYPES) assert.ok(dict.model.types[type], `${name}.model.types.${type}`);
  }
  assert.deepEqual(Object.keys(zh.model.types).sort(), [...TYPES].sort());
  assert.deepEqual(keys(zh).sort(), keys(en).sort());
});

// ---- W4 admin definition defaults
test("W4 a 400 im_invalid_provider_model or model_type_mismatch on save becomes a form error", () => {
  const im = new ApiError("invalid defaults: 模型不可用", "im_invalid_provider_model", 400, { code: "im_invalid_provider_model" });
  assert.equal(errors.modelFieldError(im, tOf("zh")), "invalid defaults: 模型不可用");
  assert.match(errors.modelFieldError(mismatch(), tOf("en")), /chat model/i);
  assert.equal(errors.modelFieldError(new ApiError("slug", "agent_definition_slug_immutable", 400), tOf("zh")), "");
  assert.equal(errors.modelFieldError(new Error("net"), tOf("zh")), "");
});

test("W4 AdminAgents: defaults use authorized chat catalog selectors, save errors land in the form", () => {
  const page = src("addons/administration/agents/definition/DefinitionDrawer.vue");
  const fields = src("addons/administration/agents/definition/DefinitionFields.vue");
  const api = src("addons/administration/agents/definition/api.ts");
  assert.match(api, /provider\/models\?type=chat/);
  assert.match(api, /typesAvailable !== true/);
  assert.match(fields, /<select/);
  assert.match(page, /providerChoices/);
  assert.match(page, /modelChoices/);
  assert.doesNotMatch(page, /v-model="form\.providerId"/, "no free-text provider id");
  assert.doesNotMatch(page, /v-model="form\.model"/, "no free-text model");
  assert.match(page, /editor\.error \|\| status/);
  assert.match(page, /role="alert"/);
});

// ---- W5 gateway type labels
test("W5 gateway chips: every typed model labelled with its own type, counts per type", () => {
  const byType: Record<string, any[]> = {};
  TYPES.forEach((type, i) => {
    byType[type] = Array.from({ length: i + 1 }, (_, n) => ({ providerId: 1, model: `${type}-${n}`, type, capabilities: [] }));
  });
  const chips = gateway.typedChips(byType);
  assert.equal(chips.length, 28);
  for (const chip of chips) assert.equal(chip.model.split("-")[0], chip.type, chip.model);
  assert.deepEqual(gateway.typeCounts(byType), { chat: 1, image: 2, video: 3, audio: 4, embedding: 5, rerank: 6, other: 7 });
  assert.deepEqual(chips.slice(0, 3).map((c) => c.type), ["chat", "image", "image"], "chat first, then the enum order");
});

test("W5 Providers page shows the type label on each chip and stays read-only", () => {
  const view = src("addons/administration/views/Providers.vue");
  assert.match(view, /typedChips\(/);
  assert.match(view, /model\.types\.\$\{chip\.type\}/);
  assert.match(view, /data-testid="provider-model-type"/);
});
