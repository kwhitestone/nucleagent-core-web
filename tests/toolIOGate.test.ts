import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

// MUYU-408: the private tool IO control is a hint under the shell's `*:*:*` snapshot. Core authorizes every read again.
let vite: ViteDevServer;
let unregister: () => void;
let dom: JSDOM;
let admin = false;
const requests: string[] = [];

before(async () => {
  dom = new JSDOM("<div id='root'></div>");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  // jsdom has no ResizeObserver; the thread viewport only needs it to exist.
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    getSessionVersion: () => 1,
    useEmbeddedAuthorization: () => ({ permissions: { value: [] }, can: (permission: string) => admin && permission === "*:*:*" }),
    http: { get: async (url: string) => { requests.push(url); return { data: { data: { available: false, content: "", nextOffset: -1, revision: "" } } }; } },
  });
});
after(async () => { unregister?.(); await vite?.close(); dom?.window.close(); });

test("an ordinary user keeps the tool summary and gets no private IO control or request; an administrator gets a collapsed one", async () => {
  const app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof import("../src/chat-react/ChatApp.tsx");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts") as typeof import("../src/chat-react/externalStore.ts");
  const reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts") as typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const aui = await import("@assistant-ui/react");
  const { ThreadPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts");
  const base = { turnId: "main", lane: "answer", role: "assistant", kind: "text", status: "complete", revision: 1, seq: 1, timestamp: "2026-11-13T00:00:00Z" };
  const items = [
    { ...base, id: "msg-11", streamId: "msg-11", role: "user", content: "q" },
    { ...base, id: "msg-12", streamId: "msg-12", lane: "process", kind: "tool_call", title: "命令执行", content: "public summary", userReadable: true, data: { toolCallId: "c1" } },
    { ...base, id: "msg-13", streamId: "msg-13", content: "答案" },
  ];
  const state = reducer.reduceConversation(reducer.createConversationState("7"), {
    type: "event.received",
    event: { protocolVersion: 2, type: "snapshot", conversationKey: "7", eventId: "s", cursor: "c", turnId: "main", streamId: "snapshot",
      lane: "system", revision: 0, seq: 0, timestamp: base.timestamp, snapshot: { items, status: "completed", hasOlder: false, cursor: "c" } },
  } as Parameters<typeof reducer.reduceConversation>[1]);
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(ThreadPrimitive.Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null,
        ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t: (key: string) => key }))));
  }
  const container = document.getElementById("root")!;
  const show = async (asAdmin: boolean) => {
    admin = asAdmin;
    const root = createRoot(container);
    await React.act(async () => root.render(React.createElement(App)));
    // The control is a lazy chunk: give it the same bounded wait whether or not it is expected.
    for (let i = 0; i < 20 && !container.querySelector(".mc-tool-io"); i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const seen = { summary: container.textContent?.includes("public summary"), control: container.querySelector(".mc-tool-io button")?.getAttribute("aria-expanded") ?? null };
    await React.act(async () => root.unmount());
    return seen;
  };
  assert.deepEqual(await show(false), { summary: true, control: null });
  assert.deepEqual(await show(true), { summary: true, control: "false" });
  assert.deepEqual(requests, [], "nothing is read before an administrator expands the control");
});
