import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp113 — boundaries of the stage-2 controls through the real ChatApp (design exp109 §5/§6):
// design-1123 A: protocol + level ride inside the preset; selectable=0 or a declaration that no longer offers the
// preset's combination sends only profileId (stale, said in the UI);
// unverified parameters are never sent; 409/422 handling; settled shells + ¥ display unchanged.

const PROD = JSON.parse(readFileSync(new URL("./fixtures/model-capability-prod.json", import.meta.url), "utf8")) as {
  models: { model: string; modelCapability: Record<string, any> }[];
};
const LEVELS = ["off", "low", "medium", "high"];
function opened(revision = 7, model = "gpt-6-astra") {
  const closed = { selectable: false, reason_code: "native_protocol_unsupported", reason: "本原生后端尚未验证此调用协议，不能转换或直连",
    thinking_levels: Object.fromEntries(LEVELS.map((l) => [l, { status: "unverified", reason_code: "capability_unverified", reason: "未验证" }])) };
  return { model_type: "chat", model, upstream_id: 2, environment: "", capability_revision: revision, operator_default: null, protocols: {
    "chat.completions": closed, "gemini.generateContent": closed, messages: closed,
    responses: { selectable: true, reason_code: "", reason: "", thinking_levels: { off: { status: "unverified", reason: "未验证" },
      low: { status: "supported" }, medium: { status: "supported" }, high: { status: "supported" } } },
  } };
}
/** PROD shape (selectable=0) re-scoped to the fixture model. */
const prodHidden = () => ({ ...PROD.models[0]!.modelCapability, model: "gpt-6-astra" });

let vite: ViteDevServer;
let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let sel: typeof import("../src/chat-react/modelSelection.ts");
let disposeRuntime: () => void;
let disposeCatalog: () => void;
let adapter: { onNew(message: unknown): Promise<void> };
let composer: { settings: { pick(choice: unknown): void }; profile?: { name?: string; stale?: boolean } };
let presetParams: Record<string, string> | undefined;
let capability: unknown;
let capabilityGets: unknown[] = [];
let otherGets: string[] = [];
let preference = { profileId: "", effort: "high" };
const creates: Record<string, unknown>[] = [];
let createImpl: (body: Record<string, unknown>) => Promise<unknown> = async () => ({ id: "9" });

before(async () => {
  dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, stage2Fixture: { capture: (value: typeof adapter) => { adapter = value; } } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [{
      name: "stage2-boundaries", enforce: "pre",
      transform(code, id) { if (id.endsWith("/ChatApp.tsx")) return code.replaceAll('"@assistant-ui/react"', '"stage2-runtime"'); },
      resolveId(source, importer) {
        if (!importer?.endsWith("/ChatApp.tsx")) return;
        if (source === "stage2-runtime") return "\0stage2-runtime";
        if (source === "./useCoreConversation") return "\0stage2-core";
      },
      load(id) {
        if (id === "\0stage2-runtime") return `export * from "@assistant-ui/react";
          export function useExternalStoreRuntime(adapter) { globalThis.stage2Fixture.capture(adapter); return {}; }`;
        if (id === "\0stage2-core") return `export function useCoreConversation(id, report, turn, model, wrap) { globalThis.stage2Fixture.turn = turn; globalThis.stage2Fixture.wrap = wrap; return null; }`;
      },
    }] });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  disposeRuntime = runtime.registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === "/api/v1/addons/provider/models" && config?.params?.executionBackend) {
        capabilityGets.push(config.params);
        return { data: { data: [{ providerId: 7, model: "gpt-6-astra", type: "chat", capabilities: [], ...(capability === undefined ? {} : { modelCapability: capability }) }] } };
      }
      otherGets.push(url);
      if (url.endsWith("model-preferences")) return { data: { data: { ...preference } } };
      return { data: { data: url.endsWith("model-profiles") ? [{ id: "quick", displayName: "快速", enabled: true, efforts: ["low", "medium", "high"], ...(presetParams ? { params: presetParams } : {}) }]
        : url.endsWith("execution-backends") ? [{ id: "codex", default: true }] : [] } };
    },
    put: async (_url: string, body: typeof preference) => { preference = body; return { data: { data: body } }; },
  } });
  const catalog = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = catalog.registerModelCatalog({
    listProviders: async () => [{ id: 7, name: "fixture", isActive: true, config: { models: ["gpt-6-astra"] } }],
    listTypedModels: async (type: string) => type === "chat" ? [{ providerId: 7, model: "gpt-6-astra", type, capabilities: [] }] : [],
    fetchVisibleModels: async () => [],
  });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  sel = await vite.ssrLoadModule("/src/chat-react/modelSelection.ts") as typeof sel;
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); dom?.window.close(); delete (globalThis as Record<string, unknown>).stage2Fixture; });

function find(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(find); return; }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (props?.settings && props.placeholder !== undefined) composer = props as unknown as typeof composer;
  find(props?.children);
}

async function mount(context: { mock: { method: Function } }, backend: "codex" | null = "codex") {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  creates.length = 0; capabilityGets = []; otherGets = [];
  await React.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  function Harness() {
    const tree = app.ChatApp({ t: (key) => key, strings: {} as never, navigate: () => {},
      create: async (body: Record<string, unknown>) => { creates.push(body); return createImpl(body) as never; } });
    find(tree);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => root.render(React.createElement(Harness)));
  if (backend) await React.act(async () => composer.settings.pick({ kind: "chat", model: { providerId: 7, model: "gpt-6-astra" } }));
  for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const send = () => React.act(async () => { await adapter.onNew({ content: [{ type: "text", text: "hi" }], attachments: [] }); });
  return { root, send, unmount: () => React.act(async () => root.unmount()) };
}

// design-1123 A: presets are the only control; a stored legacy effort is no longer sent on its own.
test("selectable=0 (PROD shape), no preset: no modelSelection, no stray effort, no effective-selection GET", async (context) => {
  capability = prodHidden(); preference = { profileId: "", effort: "high" }; presetParams = undefined;
  const ui = await mount(context);
  try {
    assert.deepEqual(capabilityGets.at(-1), { type: "chat", executionBackend: "codex" }, "read for the actual backend");
    await ui.send();
    assert.equal(creates.length, 1);
    assert.deepEqual(Object.keys(creates[0]!).filter((k) => /effort|profile|modelParams|modelSelection/i.test(k)), []);
    assert.equal(otherGets.some((u) => u.includes("effective-selection")), false);
  } finally { await ui.unmount(); }
});

test("missing modelCapability (old Core) behaves exactly like selectable=0", async (context) => {
  capability = undefined; preference = { profileId: "", effort: "medium" }; presetParams = undefined;
  const ui = await mount(context);
  try {
    await ui.send();
    assert.deepEqual(Object.keys(creates[0]!).filter((k) => /effort|profile|modelParams|modelSelection/i.test(k)), []);
  } finally { await ui.unmount(); }
});

test("a preset without protocol/level goes out as profileId only (hidden or visible declaration)", async (context) => {
  for (const cap of [prodHidden(), opened()]) {
    capability = cap; preference = { profileId: "quick", effort: "low" }; presetParams = { reasoningEffort: "low" };
    const ui = await mount(context);
    try {
      await ui.send();
      assert.deepEqual(Object.keys(creates[0]!).filter((k) => /effort|profile|modelParams|modelSelection/i.test(k)), ["profileId"]);
      assert.equal(creates[0]!.profileId, "quick");
      assert.equal(composer.profile?.name, "快速");
      assert.equal(composer.profile?.stale, false);
    } finally { await ui.unmount(); }
  }
});

test("no backend: no capability read, nothing new", async (context) => {
  capability = opened(); presetParams = undefined;
  const ui = await mount(context, null);
  try {
    assert.equal(capabilityGets.length, 0);
  } finally { await ui.unmount(); }
});

test("a preset whose protocol + level the declaration offers sends only modelSelection with Core's revision (D-2)", async (context) => {
  capability = opened(7); preference = { profileId: "quick", effort: "high" }; presetParams = { callProtocol: "responses", thinkingLevel: "high" };
  const ui = await mount(context);
  try {
    await ui.send();
    assert.deepEqual(Object.keys(creates[0]!).filter((k) => /effort|profile|modelParams|modelSelection/i.test(k)), ["modelSelection"]);
    assert.deepEqual(creates[0]!.modelSelection, { callProtocol: "responses", thinkingLevel: "high", capabilityRevision: 7 });
    assert.equal(composer.profile?.stale, false);
  } finally { await ui.unmount(); }
});

test("a stale preset (unverified level / hidden declaration) sends only profileId and is marked stale; never silently swapped", async (context) => {
  for (const cap of [opened(7), prodHidden()]) {
    capability = cap; preference = { profileId: "quick", effort: "" }; presetParams = { callProtocol: "responses", thinkingLevel: "off" };
    const ui = await mount(context);
    try {
      assert.equal(composer.profile?.stale, true);
      assert.equal(composer.profile?.name, "快速", "the choice stays");
      await ui.send();
      assert.deepEqual(Object.keys(creates[0]!).filter((k) => /effort|profile|modelParams|modelSelection/i.test(k)), ["profileId"]);
    } finally { await ui.unmount(); }
  }
  presetParams = undefined;
});

test("409 stale_capability_revision: re-read once and resend with the new revision", async (context) => {
  capability = opened(7); preference = { profileId: "quick", effort: "" }; presetParams = { callProtocol: "responses", thinkingLevel: "medium" };
  let calls = 0;
  createImpl = async () => {
    if (++calls === 1) { capability = opened(8); throw Object.assign(new Error("stale"), { status: 409, problem: { reason_code: "stale_capability_revision", supported_values: [] } }); }
    return { id: "9" };
  };
  const ui = await mount(context);
  try {
    await ui.send();
    assert.equal(creates.length, 2);
    assert.equal((creates[1]!.modelSelection as { capabilityRevision: number }).capabilityRevision, 8);
  } finally { createImpl = async () => ({ id: "9" }); presetParams = undefined; await ui.unmount(); }
});

test("sendWithSelection: second 409 resets, 422 shows Core's reason + supported values, neither reaches the 409 queue", async () => {
  const t = (k: string) => k === "chatReact.selectionSupported" ? "可选：{values}" : k;
  const fields = { modelSelection: { callProtocol: "responses", thinkingLevel: "high" as const, capabilityRevision: 7 } };
  const stale = Object.assign(new Error("x"), { status: 409, problem: { reason_code: "stale_capability_revision" } });
  let resets = 0, refetches = 0, sends = 0;
  const ctl = { t, reset: () => { resets++; }, refetch: async () => { refetches++; return fields; } };
  await assert.rejects(sel.sendWithSelection(async () => { sends++; throw stale; }, fields, ctl),
    (e: { status: number; message: string }) => e.status === 0 && e.message === "chatReact.selectionStale");
  assert.deepEqual([sends, refetches, resets], [2, 1, 1], "only one retry");
  sends = refetches = resets = 0;
  const bad = Object.assign(new Error("x"), { status: 422, problem: { reason_code: "unsupported_thinking_level", detail: "此档位不可用", supported_values: ["low", "medium"] } });
  await assert.rejects(sel.sendWithSelection(async () => { sends++; throw bad; }, fields, ctl),
    (e: { status: number; message: string }) => e.status === 0 && e.message === "此档位不可用 可选：low、medium");
  assert.deepEqual([sends, refetches, resets], [1, 1, 0]);
  // A stale 409 whose re-read is no longer selectable resets without resending.
  sends = 0;
  await assert.rejects(sel.sendWithSelection(async () => { sends++; throw stale; }, fields, { ...ctl, refetch: async () => "" }), /selectionStale/);
  assert.equal(sends, 1);
  // A plain 409 (run in progress) is rethrown untouched for the single-slot queue.
  const busy = Object.assign(new Error("busy"), { status: 409, problem: { detail: "busy" } });
  await assert.rejects(sel.sendWithSelection(async () => { throw busy; }, "high", ctl), (e) => e === busy);
});

test("settled shells + ¥ usage line is unchanged next to the new code", async () => {
  const { TurnUsage } = app;
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(TurnUsage, { t: (k: string) => k, locale: "zh-CN",
      usage: { state: "settled", points: "300", shells: "3", cny: "0.0057", name: { "zh-CN": "贝壳" } } as never })));
    assert.equal(document.querySelector("[data-testid=mc-turn-usage]")!.textContent, "3 贝壳（≈¥0.0057）");
    assert.equal(document.querySelector("[data-testid=mc-effective-selection]"), null);
  } finally { await React.act(async () => root.unmount()); }
});
