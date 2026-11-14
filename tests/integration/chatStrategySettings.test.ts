import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "../fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let app: typeof import("../../src/chat-react/ChatApp.tsx");
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let settings: ReturnType<typeof app.useSettings>;
const origin = "https://test.example.com";
const candidate = { providerId: 1, model: "candidate" };
const selected = { providerId: 1, model: "slow-selected" };
const config = { scope: "test-react-ordinary", origin, backend: "codex", candidate, measurements: [{ ...candidate,
  n: 6, medianMs: 1929.75, maxMs: 3104.5, date: "2026-11-15", versions: "Core test / Executor test", quality: "short prompts only", thinking: null, vision: null }] };
const cleanups: (() => void)[] = [];
const originalFetch = globalThis.fetch;

before(async () => {
  const dom = new JSDOM("", { url: origin });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  cleanups.push(registerModelCatalog({
    listProviders: async () => [{ id: 1, name: "provider", isActive: true, config: { apiFormat: "openai", models: [candidate.model, selected.model] } }],
    listTypedModels: async (type: string) => type === "chat" ? [candidate, selected].map((model) => ({ ...model, type, capabilities: [] })) : [],
  }));
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  cleanups.push(registerPlatformRuntime({ getAccessToken: () => null, getSessionVersion: () => 0, http: { get: async (url: string) => ({ data: { data: url.endsWith("/execution-backends")
    ? [{ id: "codex", type: "agent", displayName: "Executor", default: true, streaming: true }]
    : { id: 1243, ...selected, executionBackend: "codex" } } }) } }));
  globalThis.fetch = async () => Response.json(config);
});

after(async () => {
  cleanups.forEach((cleanup) => cleanup());
  globalThis.fetch = originalFetch;
  await vite.close();
  window.close();
});

test("React settings apply scoped candidate, retain all options and preserve explicit/default/history choices", async () => {
  const root = createRoot(document.createElement("div"));
  function Harness({ id }: { id?: string }) {
    settings = app.useSettings(id, (key) => key);
    return null;
  }
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.busy, false);
    assert.deepEqual(settings.model, candidate);
    assert.equal(settings.groups.find((group) => group.kind === "chat")?.options.length, 2);
    assert.match(settings.modelHint!, /n=6/);
    assert.match(settings.imageHint, /未启用目录 vision_in/);
    await React.act(async () => settings.pick({ kind: "chat", model: selected }));
    assert.deepEqual(settings.model, selected);
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(settings.model, selected);
    await React.act(async () => settings.pick(null));
    assert.equal(settings.model, null);
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.model, null);
    await React.act(async () => root.render(React.createElement(Harness, { id: "1243" })));
    assert.deepEqual(settings.model, selected);
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(settings.model, candidate);
  } finally { await React.act(async () => root.unmount()); }
});

test("late strategy response cannot overwrite an explicit choice", async () => {
  const root = createRoot(document.createElement("div"));
  let resolveConfig!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => { resolveConfig = resolve; });
  function Harness() {
    settings = app.useSettings(undefined, (key) => key);
    return null;
  }
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.busy, false, "optional config must not delay sending after the catalog is ready");
    await React.act(async () => settings.pick({ kind: "chat", model: selected }));
    await React.act(async () => resolveConfig(Response.json(config)));
    assert.equal(settings.busy, false);
    assert.deepEqual(settings.model, selected);
  } finally {
    globalThis.fetch = async () => Response.json(config);
    await React.act(async () => root.unmount());
  }
});

test("late configuration preserves the server default without a user selection", async () => {
  const root = createRoot(document.createElement("div"));
  let resolveConfig!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => { resolveConfig = resolve; });
  function Harness() {
    settings = app.useSettings(undefined, (key) => key);
    return null;
  }
  try {
    const started = performance.now();
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.busy, false);
    assert.equal(settings.model, null);
    console.log(`pending config: catalog-ready/send-ready ${performance.now() - started}ms`);
    await React.act(async () => resolveConfig(Response.json(config)));
    assert.equal(settings.model, null);
  } finally {
    globalThis.fetch = async () => Response.json(config);
    await React.act(async () => root.unmount());
  }
});

test("failed configuration does not delay settings and preloaded policy is reused", async () => {
  const root = createRoot(document.createElement("div"));
  function Harness() {
    settings = app.useSettings(undefined, (key) => key);
    return null;
  }
  try {
    globalThis.fetch = async () => { throw new Error("offline"); };
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.busy, false);
    assert.equal(settings.model, null);
    await React.act(async () => root.render(null));
    let requests = 0;
    globalThis.fetch = async () => { requests += 1; return Response.json(config); };
    const loader = await vite.ssrLoadModule("/src/chat-react/chatStrategy.ts");
    await loader.preloadChatStrategy(origin);
    await loader.preloadChatStrategy(origin);
    const started = performance.now();
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(settings.busy, false);
    assert.deepEqual(settings.model, candidate);
    assert.equal(requests, 1);
    console.log(`preloaded config: catalog-ready/send-ready ${performance.now() - started}ms; fetches=${requests}`);
  } finally {
    globalThis.fetch = async () => Response.json(config);
    await React.act(async () => root.unmount());
  }
});
