import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let disposeRuntime: () => void;
let disposeCatalog: () => void;
let adapter: { onNew(message: unknown): Promise<void> };
let change: (value: string) => void;
let profileControl: { disabled: boolean; onChange(value: { scope: string; profileId: string }): void };
let settings: ReturnType<typeof app.useSettings>;
let controlsSlot: unknown;
let profilePanel: { name?: string; page: { props: { onChange(profileId: string): void; rows: { id: string }[] } } } | undefined;
let catalogEfforts: string[] = ["low", "medium", "high"];
let creates = 0;
let sends = 0;
let writes = 0;
let preference = { profileId: "", effort: "" };
let putGate: Promise<void> | undefined;
let getGate: Promise<void> | undefined;
let defaultSelection = { executionBackend: "codex", providerId: 7, model: "gpt-6-astra", resolved: true };
let preferenceQuery: unknown;
const puts: { profileId: string; effort: string }[] = [];
let defaultVision: string | undefined;
let composerReady: boolean | undefined;
let workflowDisabled: boolean | undefined;

before(async () => {
  dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true,
    preferenceGateFixture: { capture: (value: typeof adapter) => { adapter = value; }, send: async () => { sends++; } } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [{
      name: "preference-gate-boundaries",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/ChatApp.tsx")) return code.replaceAll('"@assistant-ui/react"', '"preference-gate-runtime"');
      },
      resolveId(source, importer) {
        if (!importer?.endsWith("/ChatApp.tsx")) return;
        if (source === "preference-gate-runtime") return "\0preference-gate-runtime";
        if (source === "./useCoreConversation") return "\0preference-gate-core";
      },
      load(id) {
        if (id === "\0preference-gate-runtime") return `export * from "@assistant-ui/react";
          export function useExternalStoreRuntime(adapter) { globalThis.preferenceGateFixture.capture(adapter); return {}; }`;
        if (id === "\0preference-gate-core") return `import { createConversationState } from "/src/addons/conversation/task-conversation/core/index.ts";
          export function useCoreConversation(id, report, turn) { globalThis.preferenceGateFixture.turn = turn; return id ? { state: createConversationState(id), controller: {
            authoritativeReady: { value: true },
            send: globalThis.preferenceGateFixture.send, stop: async () => {}, loadOlder: async () => {} } } : null; }`;
      },
    }] });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  disposeRuntime = runtime.registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string, config?: { params?: unknown }) => {
      if (url.endsWith("model-selection")) return { data: { data: defaultSelection } };
      if (url.endsWith("model-preferences")) { preferenceQuery = config?.params; await getGate; return { data: { data: { ...preference } } }; }
      const measured = (config?.params as { model?: string })?.model === "gpt-6-astra";
      return { data: { data: url.endsWith("model-profiles") ? [{ id: "quick", enabled: measured, efforts: measured ? catalogEfforts : [] }]
        : url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
        : /\/conversation\/9$/.test(url) ? { id: "9", providerId: 7, model: "gpt-6-astra", executionBackend: "codex" }
        : [] } };
    },
    put: async (_url: string, body: typeof preference) => { writes++; puts.push({ ...body }); await putGate; preference = body; return { data: { data: body } }; },
  } });
  const catalog = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = catalog.registerModelCatalog({
    listProviders: async () => [{ id: 7, name: "fixture", isActive: true, config: { models: ["gpt-6-astra"] } }],
    listTypedModels: async (type: string) => type === "chat" ? [{ providerId: 7, model: "gpt-6-astra", type, capabilities: [], ...(defaultVision ? { vision_in: defaultVision } : {}) }] : [],
    fetchVisibleModels: async () => [],
  });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); dom?.window.close(); delete (globalThis as Record<string, unknown>).preferenceGateFixture; });

function findControl(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(findControl); return; }
  const props = (node as { props?: { placeholder?: string; settings: typeof settings; children?: unknown; controls?: { props: { children: { props: typeof profileControl }[] } } } }).props;
  // design-1123 A: the Composer's only model control is the preset panel; choosing a preset is the preference write.
  if (props?.settings && props.placeholder !== undefined) {
    settings = props.settings;
    composerReady = (props as unknown as { preferenceReady?: boolean }).preferenceReady;
    workflowDisabled = (props as unknown as { workflow?: { props?: { disabled?: boolean } } }).workflow?.props?.disabled;
    profilePanel = (props as unknown as { profile?: typeof profilePanel }).profile;
    change = (value: string) => profilePanel!.page.props.onChange(value);
  }
  if (props?.controls) { controlsSlot = props.controls.props.children[0]; profileControl = (controlsSlot as { props?: typeof profileControl } | false)?.props as typeof profileControl; }
  findControl(props?.children);
}

for (const conversationId of [undefined, "9"]) test(`ChatApp ${conversationId ? "followup" : "create"} blocks synchronously through PUT and GET`, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  preference = { profileId: "", effort: "" };
  creates = sends = writes = 0;
  function Harness() {
    const tree = app.ChatApp({ conversationId, t: (key) => key, strings: {} as never, navigate: () => {},
      create: async () => { creates++; return { id: "9" } as never; } });
    findControl(tree);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  let releasePut!: () => void;
  let releaseGet!: () => void;
  const message = { content: [{ type: "text", text: "hello" }], attachments: [] };
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    if (!conversationId) await React.act(async () => settings.pick({ kind: "chat", model: { providerId: 7, model: "gpt-6-astra" } }));
    assert.equal(typeof change, "function");
    putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const beforeSave = adapter;
    await React.act(async () => {
      change("quick");
      assert.equal(writes, 1, "actual ChatApp control starts the preference PUT");
      await assert.rejects(beforeSave.onNew(message), /preferenceError/);
    });
    assert.equal(creates + sends, 0);
    await React.act(async () => { releasePut(); });
    assert.equal(composerReady, false, "the visible composer waits for preference readback");
    if (!conversationId) assert.equal(workflowDisabled, true, "workflow cannot bypass preference readback");
    await React.act(async () => { await assert.rejects(adapter.onNew(message), /preferenceError/); });
    assert.equal(creates + sends, 0, "PUT success alone must not open create/send");
    await React.act(async () => { releaseGet(); });
    assert.equal(composerReady, true);
    if (!conversationId) assert.equal(workflowDisabled, false);
    await React.act(async () => { await adapter.onNew(message); });
    assert.equal(conversationId ? sends : creates, 1, "confirmed preference reopens the real ChatApp path");
    assert.equal(conversationId ? creates : sends, 0);
    assert.equal(writes, 1);
  } finally {
    await React.act(async () => { releasePut?.(); releaseGet?.(); });
    putGate = getGate = undefined;
    await React.act(async () => root.unmount());
  }
});

for (const resolved of [true, false]) test(`normal fresh chat resolves the authoritative default and keeps its preference operable (${resolved})`, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  preference = { profileId: "", effort: "" };
  creates = sends = writes = 0;
  defaultSelection = { executionBackend: "codex", providerId: resolved ? 7 : 0, model: resolved ? "gpt-6-astra" : "", resolved };
  function Harness() {
    const tree = app.ChatApp({ t: (key) => key, strings: {} as never, navigate: () => {},
      create: async () => { creates++; return { id: "9" } as never; } });
    findControl(tree);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.backend, "codex");
    assert.equal(settings.model?.model ?? "", defaultSelection.model);
    assert.deepEqual(preferenceQuery, { executionBackend: "codex", providerId: resolved ? 7 : undefined, model: defaultSelection.model });
    assert.equal(creates + sends + writes, 0);
    // MUYU-365 exp104 (MUYU-408 default page): the 「预设」 page is there when the default model has presets and its
    // default item saves, also when no level is measured (408: profile saving is not tied to effort support).
    // Unresolved: the catalog still lists quick, disabled (unmeasured) — the 默认 item stays the saveable choice.
    assert.equal(profilePanel?.page.props.rows.map((row) => `${row.id}${(row as { enabled?: boolean }).enabled ? "+" : "-"}`).join(","), resolved ? "quick+" : "quick-");
    await React.act(async () => profilePanel!.page.props.onChange(""));
    assert.equal(writes, 1, "the preference remains saveable even without a measured model/effort");
    assert.equal(preference.profileId, "");
    assert.equal(preference.effort, "");
  } finally {
    await React.act(async () => root.unmount());
  }
});

// design-1123 A: the stored quick is in effect — sent on create/follow-up as { profileId } only (a stored legacy
// effort is no longer sent; strength rides in the preset); choosing 默认（继承） writes both back empty.
for (const conversationId of [undefined, "9"]) test(`profile on: stored quick is sent alone, and choosing the default clears it (${conversationId ? "followup" : "create"})`, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  preference = { profileId: "quick", effort: "medium" };
  catalogEfforts = ["low", "medium"];
  creates = sends = writes = 0;
  puts.length = 0;
  defaultSelection = { executionBackend: "codex", providerId: 7, model: "gpt-6-astra", resolved: true };
  const created: Record<string, unknown>[] = [];
  function Harness() {
    const tree = app.ChatApp({ conversationId, t: (key) => key, strings: {} as never, navigate: () => {},
      create: async (payload: Record<string, unknown>) => { creates++; created.push(payload); return { id: "9" } as never; } });
    findControl(tree);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  const message = { content: [{ type: "text", text: "hello" }], attachments: [] };
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    if (!conversationId) await React.act(async () => settings.pick({ kind: "chat", model: { providerId: 7, model: "gpt-6-astra" } }));
    assert.equal(profilePanel?.name, "chatReact.tier_quick", "the 思考 pill shows the stored choice (MUYU-365 thinking3 tier wording)");
    await React.act(async () => { await adapter.onNew(message); });
    if (conversationId) {
      const turn = (globalThis as unknown as { preferenceGateFixture: { turn(): unknown } }).preferenceGateFixture.turn();
      assert.equal(JSON.stringify(turn), '{"profileId":"quick"}');
    } else {
      assert.equal(created.length, 1);
      assert.equal(String(created[0]!.profileId), "quick", "create carries profileId");
      assert.equal("modelParams" in created[0]!, false, "strength rides in the preset");
      assert.equal("reasoningEffort" in created[0]!, false, "never both");
    }
    await React.act(async () => change(""));
    assert.equal(JSON.stringify(puts), JSON.stringify([{ profileId: "", effort: "" }]), "默认（继承） clears the preset and the legacy effort");
  } finally {
    catalogEfforts = ["low", "medium", "high"];
    await React.act(async () => root.unmount());
  }
});

test("profile UI switch is on (D8A code switch) and ChatApp honours it", async () => {
  const { readFileSync } = await import("node:fs");
  const feature = readFileSync(new URL("../src/chat-react/profileFeature.ts", import.meta.url), "utf8");
  assert.match(feature, /export const PROFILE_UI_ENABLED\s*=\s*true;/);
  const chat = readFileSync(new URL("../src/chat-react/ChatApp.tsx", import.meta.url), "utf8");
  assert.match(chat, /const profile = PROFILE_UI_ENABLED \? preference\.profile : null;/);
  assert.match(chat, /const profilePanel = PROFILE_UI_ENABLED &&/);
});

// MUYU-365 matrix: a fresh chat with no manual pick sends to the server default the pill shows, so the image gate judges
// that model (catalog vision_in), not "null = 默认模型 未验证"; an unsupported default blocks instead of warning.
for (const vision_in of ["unsupported", "supported"]) test(`fresh chat image gate judges the resolved default model (${vision_in})`, async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  preference = { profileId: "", effort: "" };
  defaultSelection = { executionBackend: "codex", providerId: 7, model: "gpt-6-astra", resolved: true };
  defaultVision = vision_in;
  function Harness() {
    findControl(app.ChatApp({ t: (key) => key, strings: {} as never, navigate: () => {}, create: async () => ({ id: "9" }) as never }));
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.model?.model, "gpt-6-astra", "the pill shows the server default");
    const gate = (settings as unknown as { imageGate: { state: string; block: boolean; model: string | null } }).imageGate;
    assert.deepEqual({ state: gate.state, block: gate.block, model: gate.model }, { state: vision_in, block: vision_in === "unsupported", model: "gpt-6-astra" });
  } finally {
    await React.act(async () => root.unmount());
    defaultVision = undefined;
  }
});
