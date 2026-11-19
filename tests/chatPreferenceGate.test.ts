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
let creates = 0;
let sends = 0;
let writes = 0;
let preference = { profileId: "", effort: "" };
let putGate: Promise<void> | undefined;
let getGate: Promise<void> | undefined;
let defaultSelection = { executionBackend: "codex", providerId: 7, model: "gpt-6-astra", resolved: true };
let preferenceQuery: unknown;

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
          export function useCoreConversation(id) { return id ? { state: createConversationState(id), controller: {
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
      return { data: { data: url.endsWith("model-profiles") ? [{ id: "quick", enabled: measured, efforts: measured ? ["low", "medium", "high"] : [] }]
        : url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
        : /\/conversation\/9$/.test(url) ? { id: "9", providerId: 7, model: "gpt-6-astra", executionBackend: "codex" }
        : [] } };
    },
    put: async (_url: string, body: typeof preference) => { writes++; await putGate; preference = body; return { data: { data: body } }; },
  } });
  const catalog = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = catalog.registerModelCatalog({
    listProviders: async () => [{ id: 7, name: "fixture", isActive: true, config: { models: ["gpt-6-astra"] } }],
    listTypedModels: async (type: string) => type === "chat" ? [{ providerId: 7, model: "gpt-6-astra", type, capabilities: [] }] : [],
    fetchVisibleModels: async () => [],
  });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); dom?.window.close(); delete (globalThis as Record<string, unknown>).preferenceGateFixture; });

function findControl(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(findControl); return; }
  const props = (node as { props?: { effort?: { set: typeof change }; settings: typeof settings; children?: unknown; controls?: { props: { children: { props: typeof profileControl }[] } } } }).props;
  if (props?.effort) { change = props.effort.set; settings = props.settings; }
  if (props?.controls) profileControl = props.controls.props.children[0]!.props;
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
      change("medium");
      assert.equal(writes, 1, "actual ChatApp control starts the preference PUT");
      await assert.rejects(beforeSave.onNew(message), /preferenceError/);
    });
    assert.equal(creates + sends, 0);
    await React.act(async () => { releasePut(); });
    await React.act(async () => { await assert.rejects(adapter.onNew(message), /preferenceError/); });
    assert.equal(creates + sends, 0, "PUT success alone must not open create/send");
    await React.act(async () => { releaseGet(); });
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

for (const resolved of [true, false]) test(`normal fresh chat resolves the authoritative default and keeps its default profile operable (${resolved})`, async (context) => {
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
    assert.equal(profileControl.disabled, false, "normal server-default selection must not permanently disable every profile");
    await React.act(async () => profileControl.onChange({ scope: "new", profileId: "" }));
    assert.equal(writes, 1, "default profile remains saveable even without a measured model/effort");
    assert.equal(preference.profileId, "");
    assert.equal(preference.effort, "");
  } finally {
    await React.act(async () => root.unmount());
  }
});
