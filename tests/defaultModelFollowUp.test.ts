import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let dom: JSDOM;
let unregister: () => void;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let hook: typeof import("../src/chat-react/useCoreConversation.ts");
let send: (input: string) => Promise<unknown>;
const bodies: unknown[] = [];

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, defaultModelAdapter: { capture: (value: typeof send) => { send = value; } } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [{
      name: "default-model-controller-boundary",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/useCoreConversation.ts")) return code.replace('"@/addons/conversation/composables/useConversationAdapter"', '"default-model-adapter"').replace('"@/addons/conversation/task-conversation/conversationController"', '"default-model-controller"');
      },
      resolveId(source, importer) {
        if (!importer?.endsWith("/useCoreConversation.ts")) return;
        if (source === "default-model-adapter") return "\0default-model-adapter";
        if (source === "default-model-controller") return "\0default-model-controller";
      },
      load(id) {
        if (id === "\0default-model-adapter") return `export function createConversationAdapter(id, options) { globalThis.defaultModelAdapter.capture(options.send); return {}; }`;
        if (id === "\0default-model-controller") return `export function createConversationController() { return { state: { value: null }, initialize: async () => {}, dispose: () => {} }; }`;
      },
    }] });
  await initializeRuntimeFixture(vite);
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = runtime.registerPlatformRuntime({ http: { post: async (_url: string, body: unknown) => { bodies.push(body); return { data: { data: { id: 9 } } }; } } });
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  hook = await vite.ssrLoadModule("/src/chat-react/useCoreConversation.ts") as typeof hook;
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); delete (globalThis as Record<string, unknown>).defaultModelAdapter; });

test("real conversation hook pins resolved defaults through the existing follow-up transport", async () => {
  let model: { providerId: number; model: string } | undefined = { providerId: 7, model: "gpt-6-astra" };
  let turn: { profileId: string; modelParams?: { reasoningEffort: string } } = { profileId: "quick" };
  function Harness() { hook.useCoreConversation("9", () => {}, () => turn, () => model); return null; }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    await send("configured default");
    model = undefined;
    turn = { profileId: "" };
    await send("native default");
    assert.deepEqual(bodies, [
      { input: "configured default", providerId: 7, model: "gpt-6-astra", profileId: "quick" },
      { input: "native default", profileId: "" },
    ]);
  } finally { await React.act(async () => root.unmount()); }
});
