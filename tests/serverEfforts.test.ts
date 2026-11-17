import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp3: with no chat-strategy evidence, the effort selector follows Core /model-profiles `efforts`.
let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
const asked: unknown[] = [];
let efforts: string[] | undefined = ["low", "medium"];

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ http: { get: async (url: string, config: { params: unknown }) => {
    asked.push([url, config.params]);
    return { data: { data: [{ id: "quick", enabled: true, efforts }, { id: "long-context", enabled: false, efforts: [] }] } };
  } } });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

async function render(settings: Parameters<typeof app.useEffort>[0]) {
  let seen: ReturnType<typeof app.useEffort> | undefined;
  const Host = () => { seen = app.useEffort(settings); return null; };
  const root = createRoot(document.getElementById("root")!);
  await React.act(async () => root.render(React.createElement(Host)));
  for (let i = 0; i < 10; i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  root.unmount();
  return seen!;
}

test("codex model without strategy evidence: Core whitelist enables exactly its levels", async () => {
  asked.length = 0;
  const effort = await render({ model: { providerId: 1, model: "deepseek-v4-flash" }, backend: "codex" });
  assert.deepEqual(asked, [["/api/v1/addons/conversation/model-profiles", { executionBackend: "codex", providerId: 1, model: "deepseek-v4-flash" }]]);
  assert.deepEqual([effort.view.disabled, effort.view.off, effort.view.note], [false, ["high"], "server"]);
});

test("strategy evidence wins and non-codex never asks", async () => {
  asked.length = 0;
  const measured = await render({ model: { providerId: 1, model: "m" }, backend: "codex", effortEvidence: { levels: ["low"], effective: true, source: "fixture" } });
  assert.deepEqual([measured.view.off, measured.view.note], [["medium", "high"], "effective"]);
  const other = await render({ model: { providerId: 1, model: "m" }, backend: "hermes" });
  assert.equal(other.view.disabled, true);
  assert.equal(asked.length, 0);
});

test("older Core (no efforts) keeps the selector off as unverified", async () => {
  efforts = undefined;
  const effort = await render({ model: { providerId: 1, model: "x" }, backend: "codex" });
  assert.deepEqual([effort.view.disabled, effort.view.note], [true, "unverified"]);
});
