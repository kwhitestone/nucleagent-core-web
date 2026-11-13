import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { composerActions, moveFocus } from "../src/chat-react/composerState.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 leg 6: composer state machine, model menu, process row, hover action bar (react-dom/server).
let vite: ViteDevServer;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let renderToString: typeof import("react-dom/server").renderToString;
let React: typeof import("react");
let aui: typeof import("@assistant-ui/react");
let Viewport: import("react").ElementType;

before(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new JSDOM("").window });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts") as { externalStore: typeof externalStore });
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts") as typeof reducer;
  ({ renderToString } = await import("react-dom/server"));
  React = await import("react");
  aui = await import("@assistant-ui/react");
  Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
});
after(async () => { await vite.close(); });

const t = (key: string) => key;
const item = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "answer", role: "assistant", kind: "text", content: id,
  status: "complete", revision: 1, seq: 1, timestamp: "2026-11-13T00:00:00Z", ...over,
});
const stateOf = (items: ConversationItem[], status: "idle" | "running" | "completed" = "completed") =>
  reducer.reduceConversation(reducer.createConversationState("7"), {
    type: "event.received",
    event: { protocolVersion: 2, type: "snapshot", conversationKey: "7", eventId: "s", cursor: "c", turnId: "main",
      streamId: "snapshot", lane: "system", revision: 0, seq: 0, timestamp: "2026-11-13T00:00:00Z",
      snapshot: { items, status, hasOlder: false, cursor: "c" } },
  });
/** Renders `child` inside an aui runtime over a mock Core state. */
function render(state: ReturnType<typeof stateOf>, child: () => import("react").ReactNode) {
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null, child()));
  }
  return renderToString(React.createElement(App));
}
const settings = { groups: [], model: null, backend: null, busy: false, pick: async () => {} };

test("composer state machine: idle send; running empty → stop only; running with text → queue + stop", () => {
  assert.deepEqual(composerActions(false, true), ["send"]);
  assert.deepEqual(composerActions(false, false), ["send"]);
  assert.deepEqual(composerActions(true, true), ["stop"]);
  assert.deepEqual(composerActions(true, false), ["queue", "stop"]);
});

test("model menu roving focus: arrows wrap, Home/End jump, other keys ignored, empty list inert", () => {
  assert.equal(moveFocus(3, -1, "ArrowDown"), 0);
  assert.equal(moveFocus(3, 2, "ArrowDown"), 0);
  assert.equal(moveFocus(3, 0, "ArrowUp"), 2);
  assert.equal(moveFocus(3, -1, "ArrowUp"), 2);
  assert.equal(moveFocus(3, 1, "Home"), 0);
  assert.equal(moveFocus(3, 1, "End"), 2);
  assert.equal(moveFocus(3, 1, "a"), null);
  assert.equal(moveFocus(0, -1, "ArrowDown"), null);
});

test("composer: empty idle send is a disabled aui button; hint, + attach, media pills (aria-disabled), model trigger", () => {
  const html = render(stateOf([]), () => React.createElement(app.Composer, { t, settings, placeholder: "p" }));
  assert.match(html, /<button[^>]*data-testid="mc-send"[^>]*disabled=""/, "empty input → send disabled");
  assert.match(html, /aria-label="common.send"/);
  assert.doesNotMatch(html, /mc-stop/);
  assert.match(html, /<textarea[^>]*aria-label="p"/);
  assert.match(html, /chatReact.hint/);
  assert.match(html, /data-testid="mc-attach"[^>]*aria-label="chatReact.attach"|aria-label="chatReact.attach"[^>]*data-testid="mc-attach"/);
  assert.equal(html.match(/aria-disabled="true"[^>]*data-testid="mc-gen-(image|video)"/g)?.length, 2);
  assert.match(html, /data-testid="mc-model"[^>]*aria-haspopup="menu"/);
});

test("composer: running with an empty input shows only the stop square", () => {
  const html = render(stateOf([item("u1", { role: "user" }), item("a1", { status: "streaming" })], "running"),
    () => React.createElement(app.Composer, { t, settings, placeholder: "p" }));
  assert.match(html, /data-testid="mc-stop"[^>]*aria-label="chatReact.stop"/);
  assert.doesNotMatch(html, /data-testid="mc-send"/);
});

test("model menu: groups, current choice checked, image/video listed but not pickable, closed by default", () => {
  const model = { providerId: "p", model: "m1" };
  const groups = [
    { kind: "chat" as const, options: [{ value: "chat:p:m1", label: "P · m1", choice: { kind: "chat" as const, model } }, { value: "chat:p:m2", label: "P · m2", choice: { kind: "chat" as const, model: { providerId: "p", model: "m2" } } }] },
    { kind: "image" as const, options: [{ value: "image:p:i", label: "P · i", choice: { kind: "image" as const, model: { providerId: "p", model: "i" } } }] },
    { kind: "executor" as const, options: [{ value: "executor:x", label: "执行器 X", choice: { kind: "executor" as const, backend: "x" } }] },
  ];
  const props = { t, groups, value: "chat:p:m1", backend: "x", disabled: false, onPick: () => {} };
  const closed = renderToString(React.createElement(app.ModelMenu, props));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /role="menu"[^>]*hidden=""/);
  assert.match(closed, /mc-model-name">m1</, "trigger shows the model, not the provider prefix");
  assert.match(closed, /执行器 X/);
  const open = renderToString(React.createElement(app.ModelMenu, { ...props, defaultOpen: true }));
  assert.doesNotMatch(open, /role="menu"[^>]*hidden=""/);
  assert.deepEqual([...open.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]), ["chat", "image", "executor"]);
  assert.equal(open.match(/aria-checked="true"/g)?.length, 2, "current model and executor");
  assert.match(open, /aria-checked="false" aria-disabled="true"[^>]*><span class="mc-menu-text">P · i/, "image model not pickable");
});
