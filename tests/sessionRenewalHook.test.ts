import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-365 exp98 W1: useCoreConversation re-initializes once when a same-account renewal
// arrives while the stream/snapshot is broken; a healthy view is left alone.
let vite: ViteDevServer;
let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let hook: typeof import("../src/chat-react/useCoreConversation.ts");
let emit: (authenticated: boolean, boundary?: boolean) => void;
type Stub = { inits: number; disposes: number; ready: boolean; connection: string; snapshot: string };
const stub: Stub = { inits: 0, disposes: 0, ready: true, connection: "connected", snapshot: "ready" };

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, renewalStub: stub });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, plugins: [{
      name: "renewal-controller-boundary",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/useCoreConversation.ts")) return code.replace('"@/addons/conversation/composables/useConversationAdapter"', '"renewal-adapter"').replace('"@/addons/conversation/task-conversation/conversationController"', '"renewal-controller"');
      },
      resolveId(source, importer) {
        if (!importer?.endsWith("/useCoreConversation.ts")) return;
        if (source === "renewal-adapter") return "\0renewal-adapter";
        if (source === "renewal-controller") return "\0renewal-controller";
      },
      load(id) {
        if (id === "\0renewal-adapter") return `export function createConversationAdapter() { return {}; }`;
        if (id === "\0renewal-controller") return `export function createConversationController() {
          const s = globalThis.renewalStub;
          return {
            state: { get value() { if (s.view?.connection.status !== s.connection) s.view = { connection: { status: s.connection } }; return s.view; } },
            snapshotStatus: { get value() { return s.snapshot; } },
            authoritativeReady: { get value() { return s.ready; } },
            initialize: async () => { s.inits++; }, dispose: () => { s.disposes++; },
          };
        }`;
      },
    }] });
  await initializeRuntimeFixture(vite);
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  emit = (authenticated, businessBoundaryChanged = false) => dom.window.dispatchEvent(
    new dom.window.CustomEvent(runtime.SESSION_CHANGE_EVENT, { detail: { authenticated, businessBoundaryChanged } }));
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  hook = await vite.ssrLoadModule("/src/chat-react/useCoreConversation.ts") as typeof hook;
});
after(async () => { await vite?.close(); dom?.window.close(); delete (globalThis as Record<string, unknown>).renewalStub; });

test("same-account renewal re-initializes a broken stream once and leaves a healthy one alone", async () => {
  function Harness() { hook.useCoreConversation("1007", () => {}); return null; }
  const root = createRoot(document.getElementById("root")!);
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(stub.inits, 1, "mount");
    emit(true, false);
    assert.equal(stub.inits, 1, "healthy ready view is kept across a renewal");
    stub.connection = "reconnecting";
    emit(true, false);
    assert.equal(stub.inits, 2, "renewal recovers a reconnecting stream");
    stub.connection = "error";
    emit(true, false);
    assert.equal(stub.inits, 3, "renewal recovers an errored stream");
    stub.connection = "connected"; stub.snapshot = "error";
    emit(true, false);
    assert.equal(stub.inits, 4, "renewal recovers a failed snapshot");
    stub.snapshot = "ready";
    emit(false, false);
    assert.equal(stub.disposes, 1, "sign-out still drops the history");
  } finally { await React.act(async () => root.unmount()); }
});
