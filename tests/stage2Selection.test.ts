import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp109 B — RED for the stage-2 call-protocol / thinking-level controls (MUYU-418 WEB-CONTRACT, Core v0.1.75).
// Design: exp109/WEB-STAGE2-DESIGN.md. Nothing here is implemented yet: src/chat-react/modelSelection.ts does not exist
// and ModelControls has no `selection` prop. Every test below is expected to fail until the B implementation lands.
// The only switch is protocols.<p>.selectable (vendor_verified etc. are never read); today all four environments have 0.

const PROD = JSON.parse(readFileSync(new URL("./fixtures/model-capability-prod.json", import.meta.url), "utf8")) as {
  selectableCount: number; models: { model: string; modelCapability: Record<string, any> }[];
};
const LEVELS = ["off", "low", "medium", "high"] as const;
type Cap = Record<string, any>;
const level = (status: string, reason = "精确模型、上游、环境或原生执行链未验证") =>
  status === "supported" ? { status, effective_semantics: "reasoning.effort" } : { status, reason_code: "capability_unverified", reason };
/** A declaration shaped like the PROD read-back, with one protocol switched on by Core (selectable after evidence + backend check). */
function opened(model = "gpt-6-astra", revision = 7): Cap {
  const off = { native_backend: "", vendor_verified: true, upstream_verified: true, native_verified: false, selectable: false,
    reason_code: "native_protocol_unsupported", reason: "本原生后端尚未验证此调用协议，不能转换或直连", official_default: null,
    thinking_levels: Object.fromEntries(LEVELS.map((l) => [l, level("unverified", "本原生后端尚未验证此调用协议，不能转换或直连")])) };
  return { model_type: "chat", model, upstream_id: 2, environment: "", capability_revision: revision, operator_default: null, protocols: {
    "chat.completions": off,
    responses: { native_backend: "codex", vendor_verified: true, upstream_verified: true, native_verified: true, selectable: true, reason_code: "", reason: "",
      official_default: null, thinking_levels: { off: level("unverified"), low: level("supported"), medium: level("supported"), high: level("supported") } },
    "gemini.generateContent": off, messages: off,
  } };
}

let vite: ViteDevServer;
let dom: JSDOM;
let unregister: () => void;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let mod: Record<string, any>;
let app: typeof import("../src/chat-react/ChatApp.tsx");

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: { get: async () => ({ data: { data: [] } }), post: async () => ({ data: { data: { id: 1 } } }) } });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  mod = await vite.ssrLoadModule("/src/chat-react/modelSelection.ts").catch(() => ({}));
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

const need = (name: string) => { assert.equal(typeof mod[name], "function", `modelSelection.${name} is not implemented`); return mod[name]; };

// ── gate ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("selectable=0 (the PROD read-back today) hides every new control", () => {
  const capabilityView = need("capabilityView");
  assert.equal(PROD.selectableCount, 0);
  for (const { modelCapability } of PROD.models) assert.deepEqual(capabilityView(modelCapability, "codex"), { state: "hidden" });
});

test("a missing, null, malformed or other-model modelCapability renders nothing", () => {
  const capabilityView = need("capabilityView");
  for (const capability of [undefined, null, {}, { protocols: null }, { protocols: [] }, "x", 3]) {
    assert.deepEqual(capabilityView(capability, "codex"), { state: "hidden" }, JSON.stringify(capability));
  }
  // Exact scope: a declaration for another model name is not borrowed.
  assert.deepEqual(capabilityView(opened("gpt-6-astra"), "codex", { model: "gpt-6-astra-mini" }), { state: "hidden" });
});

test("no executionBackend is never inferred as codex", () => {
  const capabilityView = need("capabilityView");
  for (const backend of [undefined, null, ""]) assert.deepEqual(capabilityView(opened(), backend), { state: "hidden" });
});

test("only protocols.*.selectable opens a control, never vendor_verified / native_verified alone", () => {
  const capabilityView = need("capabilityView");
  const allVerifiedButClosed = opened();
  allVerifiedButClosed.protocols.responses.selectable = false;
  allVerifiedButClosed.protocols.responses.reason_code = "native_backend_unverified";
  allVerifiedButClosed.protocols.responses.reason = "此原生后端尚未验证";
  assert.deepEqual(capabilityView(allVerifiedButClosed, "codex"), { state: "hidden" });

  const view = capabilityView(opened(), "codex", { model: "gpt-6-astra" });
  assert.equal(view.state, "visible");
  assert.equal(view.revision, 7);
  assert.deepEqual(view.protocols.map((p: any) => [p.name, p.selectable]),
    [["chat.completions", false], ["responses", true], ["gemini.generateContent", false], ["messages", false]]);
  // Disabled rows carry Core's Chinese reason; the machine code and evidence fields never reach the view.
  const closed = view.protocols.find((p: any) => p.name === "messages");
  assert.equal(closed.reason, "本原生后端尚未验证此调用协议，不能转换或直连");
  const serialized = JSON.stringify(view);
  for (const leak of ["reason_code", "evidence_ref", "vendor_verified", "native_verified", "upstream_verified", "native_protocol_unsupported"]) {
    assert.doesNotMatch(serialized, new RegExp(leak), leak);
  }
  const responses = view.protocols.find((p: any) => p.name === "responses");
  assert.deepEqual(responses.levels.map((l: any) => [l.level, l.selectable]), [["off", false], ["low", true], ["medium", true], ["high", true]]);
  assert.equal(responses.levels[0].reason, "精确模型、上游、环境或原生执行链未验证");
});

test("unknown protocol names and levels are ignored, not offered", () => {
  const capabilityView = need("capabilityView");
  const cap = opened();
  cap.protocols["openai.realtime"] = { ...cap.protocols.responses };
  cap.protocols.responses.thinking_levels.xhigh = level("supported");
  const view = capabilityView(cap, "codex");
  assert.deepEqual(view.protocols.map((p: any) => p.name), ["chat.completions", "responses", "gemini.generateContent", "messages"]);
  assert.deepEqual(view.protocols[1].levels.map((l: any) => l.level), ["off", "low", "medium", "high"]);
});

// ── request ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test("modelSelection is sent only for an explicit selectable choice, per turn, with Core's own revision", () => {
  const capabilityView = need("capabilityView"), selectionRequest = need("selectionRequest");
  const hidden = capabilityView(PROD.models[0]!.modelCapability, "codex");
  assert.deepEqual(selectionRequest(hidden, { protocol: "responses", level: "high" }), {}, "hidden: the key is absent, not null");
  const view = capabilityView(opened("gpt-6-astra", 7), "codex");
  assert.deepEqual(selectionRequest(view, null), {}, "default item: Core uses operator_default / legacy");
  assert.deepEqual(selectionRequest(view, { protocol: "responses", level: "high" }),
    { modelSelection: { callProtocol: "responses", thinkingLevel: "high", capabilityRevision: 7 } });
  assert.deepEqual(selectionRequest(view, { protocol: "responses", level: null }),
    { modelSelection: { callProtocol: "responses", thinkingLevel: null, capabilityRevision: 7 } }, "null level = inherit, not off");
  for (const bad of [{ protocol: "messages", level: "high" }, { protocol: "responses", level: "off" }, { protocol: "responses", level: "xhigh" }]) {
    assert.deepEqual(selectionRequest(view, bad), {}, JSON.stringify(bad));
  }
});

test("a turn with modelSelection never also carries reasoningEffort, modelParams or profileId", () => {
  const capabilityView = need("capabilityView"), turnFields = need("turnFields");
  const view = capabilityView(opened(), "codex");
  // legacy turn (from profileRequest): a profile with its effort, or the effort string alone
  for (const legacy of ["high", { profileId: "quick", modelParams: { reasoningEffort: "low" } }, { profileId: "quick" }]) {
    const fields = turnFields(view, { protocol: "responses", level: "medium" }, legacy);
    assert.deepEqual(fields, { modelSelection: { callProtocol: "responses", thinkingLevel: "medium", capabilityRevision: 7 } }, JSON.stringify(legacy));
  }
  // hidden: the legacy turn goes through untouched (v0.1.44 behaviour)
  const hidden = capabilityView(undefined, "codex");
  assert.equal(turnFields(hidden, { protocol: "responses", level: "medium" }, "high"), "high");
  assert.deepEqual(turnFields(hidden, null, { profileId: "quick" }), { profileId: "quick" });
});

// ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("409 stale_capability_revision: re-read and retry once; anything else is not retried", () => {
  const classify = need("classifySelectionError");
  const problem = (status: number, reason_code: string, supported_values: string[] = [], detail = "x") =>
    Object.assign(new Error(detail), { status, body: { status, title: "", detail, reason_code, supported_values } });
  assert.deepEqual(classify(problem(409, "stale_capability_revision"), 0), { action: "refetch-retry" });
  assert.deepEqual(classify(problem(409, "stale_capability_revision"), 1), { action: "reset", message: "chatReact.selectionStale" }, "only one retry");
  // A plain 409 (run in progress) keeps today's single-slot queue path.
  assert.deepEqual(classify(Object.assign(new Error("busy"), { status: 409, body: { detail: "busy" } }), 0), { action: "default" });
  assert.deepEqual(classify(problem(422, "unsupported_thinking_level", ["low", "medium"], "此档位不可用"), 0),
    { action: "show", message: "此档位不可用", supported: ["low", "medium"], refetch: true });
  assert.deepEqual(classify(problem(422, "capability_unverified", [], "精确模型缺少能力声明"), 0),
    { action: "show", message: "精确模型缺少能力声明", supported: [], refetch: true });
  assert.deepEqual(classify(problem(422, "ambiguous_thinking_parameters", [], "旧强度参数与本轮能力选择冲突"), 0),
    { action: "show", message: "common.operationFailed", supported: [], refetch: false }, "a Web bug: generic text, no retry");
  assert.deepEqual(classify(new Error("network"), 0), { action: "default" });
});

test("supported_values are listed as Core named them, never translated or inferred", () => {
  const supportedHint = need("supportedHint");
  assert.equal(supportedHint(["responses", "messages"], (k: string) => k === "chatReact.selectionSupported" ? "可选：{values}" : k), "可选：responses、messages");
  assert.equal(supportedHint([], (k: string) => k), "");
});

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────
// design-1123 A: the input area has no 调用协议/思考档位 controls at all — protocol + level ride in the preset.
test("rendering: Controls never shows protocol/level/effort rows, whatever the declaration", async () => {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(app.ModelControls as any, {
      t: (key: string) => key, defaultOpen: true, profile: { page: React.createElement("p", null, "presets") },
    })));
    for (const id of ["mc-ctl-effort", "mc-ctl-protocol", "mc-ctl-level", "mc-protocol-page", "mc-level-page"]) assert.equal(container.querySelector(`[data-testid=${id}]`), null, id);
    assert.doesNotMatch(container.innerHTML, /reason|native_|evidence/);
  } finally { await React.act(async () => root.unmount()); }
});
