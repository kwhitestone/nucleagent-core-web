import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import type { ConversationAdapter, ConversationEvent, ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 React chat island: switch, Core → assistant-ui mapping, streaming, cancel, model groups.
let vite: ViteDevServer;
let chatUi: typeof import("../src/chat-react/chatUi.ts").chatUi;
let toThreadMessages: typeof import("../src/chat-react/threadMessages.ts").toThreadMessages;
let isRunning: typeof import("../src/chat-react/threadMessages.ts").isRunning;
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let modelGroups: typeof import("../src/chat-react/modelGroups.ts").modelGroups;
let useConversation: typeof import("../src/addons/conversation/task-conversation/vue/useConversation.ts").useConversation;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let renderToString: typeof import("react-dom/server").renderToString;
let React: typeof import("react");
let aui: typeof import("@assistant-ui/react");

before(async () => {
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  ({ chatUi } = await vite.ssrLoadModule("/src/chat-react/chatUi.ts"));
  ({ toThreadMessages, isRunning } = await vite.ssrLoadModule("/src/chat-react/threadMessages.ts"));
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts"));
  ({ modelGroups } = await vite.ssrLoadModule("/src/chat-react/modelGroups.ts"));
  ({ useConversation } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/vue/useConversation.ts"));
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");
  ({ renderToString } = await import("react-dom/server"));
  React = await import("react");
  aui = await import("@assistant-ui/react");
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
});

const item = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "answer", role: "assistant", kind: "text", content: id,
  status: "complete", revision: 1, seq: 1, timestamp: "2026-11-13T00:00:00Z", ...over,
});
const stateOf = (items: ConversationItem[], status: "idle" | "running" | "completed" | "cancelled" = "completed") =>
  reducer.reduceConversation(reducer.createConversationState("7"), {
    type: "event.received",
    event: { protocolVersion: 2, type: "snapshot", conversationKey: "7", eventId: "s", cursor: "c", turnId: "main",
      streamId: "snapshot", lane: "system", revision: 0, seq: 0, timestamp: "2026-11-13T00:00:00Z",
      snapshot: { items, status, hasOlder: false, cursor: "c" } },
  });

test("switch: default vue; query beats storage; junk values ignored", () => {
  const store = (v: string | null) => ({ getItem: () => v });
  assert.equal(chatUi("", store(null)), "vue");
  assert.equal(chatUi("", store("react")), "react");
  assert.equal(chatUi("?chatUi=vue", store("react")), "vue");
  assert.equal(chatUi("?chatUi=react", store(null)), "react");
  assert.equal(chatUi("?chatUi=svelte", store("nope")), "vue");
  assert.equal(chatUi("", { getItem: () => { throw new Error("blocked"); } }), "vue");
});

test("adapter: user items split turns; process → reasoning, answer → text; hidden lanes dropped", () => {
  const messages = toThreadMessages(stateOf([
    item("u1", { role: "user", content: "hi" }),
    item("t1", { lane: "process", title: "思考过程", content: "plan", userReadable: true }),
    item("tool-hidden", { lane: "tool", content: "secret" }),
    item("a1", { content: "**hello**" }),
    item("u2", { role: "user", content: "again" }),
    item("e1", { lane: "system", status: "failed", content: "boom" }),
  ]));
  assert.deepEqual(messages.map((m) => [m.id, m.role]), [["u1", "user"], ["t1", "assistant"], ["u2", "user"], ["e1", "assistant"]]);
  assert.deepEqual(messages[1].content, [{ type: "reasoning", text: "思考过程\nplan" }, { type: "text", text: "**hello**" }]);
  assert.deepEqual(messages[1].status, { type: "complete", reason: "stop" });
  assert.deepEqual(messages[3].status, { type: "incomplete", reason: "error" });
  assert.equal((messages[3].metadata?.custom as { failed: boolean }).failed, true);
});

function streamingAdapter() {
  const sent: string[] = [];
  let push: ((e: ConversationEvent) => void) | undefined;
  const queue: ConversationEvent[] = [];
  let stopped = false;
  const adapter: ConversationAdapter = {
    async loadSnapshot() {
      return stopped
        ? { items: [item("u1", { role: "user", content: "q" }), item("a1", { content: "Hel", status: "cancelled" })], status: "cancelled", hasOlder: false, cursor: "1" }
        : { items: [], status: "idle", hasOlder: false, cursor: "0" };
    },
    async loadOlder() { return { items: [], hasOlder: false }; },
    async *subscribe(request) {
      while (!request.signal.aborted) {
        const next = queue.shift() ?? await new Promise<ConversationEvent | undefined>((resolve) => {
          push = resolve;
          request.signal.addEventListener("abort", () => resolve(undefined), { once: true });
        });
        if (next) yield next;
      }
    },
    async execute(command) {
      if (command.type === "send") sent.push(command.content);
      if (command.type === "stop") stopped = true;
      return { accepted: true };
    },
  };
  const emit = (e: ConversationEvent) => (push ? (push(e), push = undefined) : queue.push(e));
  return { adapter, sent, emit };
}
const upsert = (it: ConversationItem): ConversationEvent => ({
  protocolVersion: 2, type: "item.upsert", conversationKey: "7", eventId: `${it.id}-${it.revision}`, cursor: String(it.revision),
  turnId: it.turnId, streamId: it.streamId, lane: it.lane, seq: it.seq, revision: it.revision, timestamp: it.timestamp, item: it,
});
const tick = () => new Promise((r) => setTimeout(r, 5));

test("streaming + cancel through the real controller (outside a Vue component) and ExternalStore adapter", async () => {
  const { adapter, sent, emit } = streamingAdapter();
  const errors: Error[] = [];
  const c = useConversation({ conversationKey: () => "7", adapter: () => adapter, onConnectionChange() {}, onStatusChange() {}, onError: (e) => errors.push(e) });
  await c.initialize();
  const store = () => externalStore(c.state.value, c);
  assert.equal(store().messages.length, 0);

  await store().onNew({ role: "user", content: [{ type: "text", text: "q" }] } as never);
  assert.deepEqual(sent, ["q"]);
  assert.equal(store().messages[0].role, "user", "optimistic user bubble");

  // Every SSE frame is the whole row: the adapter shows the latest content, running until terminal.
  emit(upsert(item("a1", { content: "He", status: "streaming", revision: 1, seq: 1 })));
  await tick();
  emit(upsert(item("a1", { content: "Hel", status: "streaming", revision: 2, seq: 2 })));
  await tick();
  const live = store();
  assert.equal(live.isRunning, true);
  assert.deepEqual(live.messages.at(-1)?.content, [{ type: "text", text: "Hel" }]);
  assert.deepEqual(live.messages.at(-1)?.status, { type: "running" });

  await live.onCancel!();
  await tick();
  const done = store();
  assert.equal(done.isRunning, false, "Stop clears the running state");
  assert.deepEqual(done.messages.at(-1)?.status, { type: "incomplete", reason: "cancelled" });
  assert.deepEqual(errors, []);
  c.dispose();
});

test("failed send hands the draft back to the composer (MessageNotSentError)", async () => {
  const store = externalStore(stateOf([]), { send: async () => { throw new Error("409 busy"); }, stop: async () => {} });
  await assert.rejects(store.onNew({ role: "user", content: [{ type: "text", text: "x" }] } as never),
    (e: unknown) => aui.isMessageNotSentError(e) && (e as Error).message === "409 busy");
  assert.equal(isRunning(stateOf([item("a", { status: "streaming" })], "completed")), true);
});

test("model groups: chat/image/video from the typed catalog, executors from Core, empty groups dropped", () => {
  const providers = [
    { id: 1, name: "P1", isActive: true, config: { models: ["c1", "img-as-chat"] } },
    { id: 2, name: "Off", isActive: false, config: { models: ["x"] } },
  ] as never;
  const typed = {
    chat: [{ providerId: 1, model: "c1", type: "chat" }],
    image: [{ providerId: 1, model: "i1", type: "image" }],
    video: [], audio: [], embedding: [], rerank: [], other: [],
  } as never;
  const groups = modelGroups(providers, typed, [{ id: "codex", displayName: "Codex", type: "a2a", streaming: true, default: true }]);
  assert.deepEqual(groups.map((g) => [g.kind, g.options.map((o) => o.value)]), [
    ["chat", ["chat:1:c1"]], ["image", ["image:1:i1"]], ["executor", ["executor:codex"]],
  ]);
  // Old Core without typed lists: chat falls back to config.models; media groups disappear.
  assert.deepEqual(modelGroups(providers, null, []).map((g) => g.kind), ["chat"]);
});

test("component: assistant-ui renders the converted Core history through ExternalStoreRuntime", () => {
  const { createElement: h } = React;
  const state = stateOf([item("u1", { role: "user", content: "question" }), item("a1", { content: "answer **bold**" })]);
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) =>
        h(aui.MessagePrimitive.Root, { "data-role": message.role } as never,
          h(aui.MessagePrimitive.Parts, null, ({ part }: { part: { type: string; text?: string } }) => (part.type === "text" ? h("p", null, part.text) : null)))));
  }
  const html = renderToString(h(App));
  assert.match(html, /data-role="user"[^>]*>.*question/s);
  assert.match(html, /data-role="assistant"[^>]*>.*answer \*\*bold\*\*/s);
});
