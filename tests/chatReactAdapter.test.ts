import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import type { ConversationAdapter, ConversationEvent, ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 React chat island: switch, Core → assistant-ui mapping, streaming, cancel, model groups.
let vite: ViteDevServer;
let chatUi: typeof import("../src/chat-react/chatUi.ts").chatUi;
let chatUiModule: typeof import("../src/chat-react/chatUi.ts");
let toThreadMessages: typeof import("../src/chat-react/threadMessages.ts").toThreadMessages;
let isRunning: typeof import("../src/chat-react/threadMessages.ts").isRunning;
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let createSingleSlot: typeof import("../src/chat-react/singleSlotQueue.ts").createSingleSlot;
let modelGroups: typeof import("../src/chat-react/modelGroups.ts").modelGroups;
let observableBoxes: typeof import("../src/chat-react/observableBox.ts").observableBoxes;
let createConversationController: typeof import("../src/addons/conversation/task-conversation/conversationController.ts").createConversationController;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let renderToString: typeof import("react-dom/server").renderToString;
let React: typeof import("react");
let aui: typeof import("@assistant-ui/react");

before(async () => {
  // DOMPurify (markdown.ts) needs a DOM; installed before the module loads so the real policy runs.
  Object.defineProperty(globalThis, "window", { configurable: true, value: new JSDOM("").window });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  chatUiModule = await vite.ssrLoadModule("/src/chat-react/chatUi.ts");
  ({ chatUi } = chatUiModule);
  ({ toThreadMessages, isRunning } = await vite.ssrLoadModule("/src/chat-react/threadMessages.ts"));
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts"));
  ({ createSingleSlot } = await vite.ssrLoadModule("/src/chat-react/singleSlotQueue.ts"));
  ({ modelGroups } = await vite.ssrLoadModule("/src/chat-react/modelGroups.ts"));
  ({ observableBoxes } = await vite.ssrLoadModule("/src/chat-react/observableBox.ts"));
  ({ createConversationController } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/conversationController.ts"));
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
  const store = (v: string | null) => ({ getItem: () => v, setItem: (_k: string, next: string) => { v = next; } });
  assert.equal(chatUi("", store(null)), "vue");
  assert.equal(chatUi("", store("react")), "react");
  assert.equal(chatUi("?chatUi=vue", store("react")), "vue");
  assert.equal(chatUi("?chatUi=react", store(null)), "react");
  assert.equal(chatUi("?chatUi=svelte", store("nope")), "vue");
  assert.equal(chatUi("", { getItem: () => { throw new Error("blocked"); } }), "vue");
  // Priority: URL > localStorage > runtime-config CHAT_UI_DEFAULT > old (vue).
  const env = () => "react" as const;
  assert.equal(chatUi("", store(null), env), "react");
  assert.equal(chatUi("", store("vue"), env), "vue");
  assert.equal(chatUi("?chatUi=vue", store(null), env), "vue");
  assert.equal(chatUi("", store(null), () => undefined), "vue");
  // Default fallback reads the loaded runtime config (fixture has no key → old).
  assert.equal(chatUi("", store(null)), "vue");
});

test("switch: hash query (shell forwards #/chat?chatUi=react) and persistence", () => {
  const writes: string[] = [];
  const memory = (v: string | null = null) => ({
    getItem: () => v,
    setItem: (k: string, next: string) => { writes.push(`${k}=${next}`); v = next; },
  });
  const none = () => undefined;
  // Hash variants; URLSearchParams never sees the route path.
  assert.equal(chatUi("", memory(), none, "#/chat?chatUi=react"), "react");
  assert.equal(chatUi("", memory(), none, "#/c/1133?chatUi=react"), "react");
  assert.equal(chatUi("", memory(), none, "#/c/1133?foo=1&chatUi=react&bar=2"), "react");
  assert.equal(chatUi("", memory(), none, "#/chatUi=react"), "vue");
  assert.equal(chatUi("", memory(), none, "#chatUi=react"), "vue");
  assert.equal(chatUi("", memory(), none, "#/chat?chatUi=svelte"), "vue");
  // search beats hash; hash beats storage and runtime default.
  assert.equal(chatUi("?chatUi=vue", memory(), none, "#/chat?chatUi=react"), "vue");
  assert.equal(chatUi("?chatUi=svelte", memory(), none, "#/chat?chatUi=react"), "react");
  assert.equal(chatUi("", memory("react"), () => "react", "#/chat?chatUi=vue"), "vue");
  // A valid URL value is persisted, so the next load (hash rewritten by routing) keeps it.
  writes.length = 0;
  const kept = memory();
  assert.equal(chatUi("", kept, none, "#/chat?chatUi=react"), "react");
  assert.equal(chatUi("", kept, none, "#/c/7"), "react");
  // ?chatUi=vue writes vue (not a clear), so it also overrides CHAT_UI_DEFAULT=react.
  assert.equal(chatUi("?chatUi=vue", kept, none, ""), "vue");
  assert.equal(chatUi("", kept, () => "react", "#/c/7"), "vue");
  assert.deepEqual(writes, ["nucleagent_chat_ui=react", "nucleagent_chat_ui=vue"]);
  // Junk and absent values never write.
  writes.length = 0;
  chatUi("?chatUi=svelte", memory(), none, "#/chat?chatUi=x");
  chatUi("", memory(), none, "");
  assert.deepEqual(writes, []);
  // Storage throwing (read or write): URL choice applies to this load only; else runtime default.
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(chatUi("", blocked, none, "#/chat?chatUi=react"), "react");
  assert.equal(chatUi("?chatUi=vue", blocked, () => "react", ""), "vue");
  assert.equal(chatUi("", blocked, () => "react", ""), "react");
  assert.equal(chatUi("", blocked, none, ""), "vue");
  assert.equal(chatUi("", undefined, none, "#/chat?chatUi=react"), "react");
  // No params, no storage, no runtime default: old view.
  assert.equal(chatUi("", memory(), none, ""), "vue");
});

test("switch: shell query arriving after boot locks or reloads, once per page load", () => {
  const { followChatUiQuery, loadedChatUi } = chatUiModule;
  let reloads = 0;
  const reload = () => { reloads++; };
  followChatUiQuery(undefined, reload);
  followChatUiQuery("svelte", reload);
  followChatUiQuery(["react"], reload);
  // Nothing loaded yet: the query decides, no reload.
  followChatUiQuery("react", reload);
  assert.equal(loadedChatUi(), "react");
  followChatUiQuery("react", reload);
  assert.equal(reloads, 0);
  // Already resolved, other UI asked: reload (the reloaded URL carries the query, so no loop).
  followChatUiQuery("vue", reload);
  assert.equal(reloads, 1);
  assert.equal(loadedChatUi(), "react");
});

test("adapter: user items split turns; process → data-process header + one part per step, answer → text; hidden lanes dropped", () => {
  const messages = toThreadMessages(stateOf([
    item("u1", { role: "user", content: "hi" }),
    item("t1", { lane: "process", title: "思考过程", content: "plan", userReadable: true }),
    item("tool-hidden", { lane: "tool", content: "secret" }),
    item("a1", { content: "**hello**" }),
    item("u2", { role: "user", content: "again" }),
    item("e1", { lane: "system", status: "failed", content: "boom" }),
  ]));
  assert.deepEqual(messages.map((m) => [m.id, m.role]), [["u1", "user"], ["t1", "assistant"], ["u2", "user"], ["e1", "assistant"]]);
  const [process, step, answer] = messages[1].content as readonly { type: string; text?: string; data?: { summary: string } }[];
  assert.equal(process.type, "data-process");
  assert.equal(process.data?.summary, "1 个步骤 · 已完成");
  assert.deepEqual(step, { type: "reasoning", id: "t1", text: "思考过程\nplan", providerMetadata: { core: { status: "complete" } },
    timing: { startedAt: Date.parse("2026-11-13T00:00:00Z"), completedAt: Date.parse("2026-11-13T00:00:00Z") } });
  assert.deepEqual(answer, { type: "text", text: "**hello**" });
  assert.equal(JSON.stringify(messages).includes("secret"), false, "hidden tool lane never reaches aui");
  assert.deepEqual(messages[1].status, { type: "complete", reason: "stop" });
  assert.deepEqual(messages[3].status, { type: "incomplete", reason: "error" });
  assert.equal((messages[3].metadata?.custom as { failed: boolean }).failed, true);
});

test("adapter: Core tool steps → aui tool-call parts (result only once settled); media → data-media; produced files → data-files", () => {
  const tool = (id: string, over: Partial<ConversationItem>) =>
    item(id, { lane: "process", kind: "tool_call", userReadable: true, title: "联网搜索", ...over });
  const [, reply] = toThreadMessages(stateOf([
    item("u1", { role: "user", content: "q" }),
    tool("s1", { content: "找到 2 条", data: { toolCallId: "call-1", toolDetails: { query: "aui", sources: [{ title: "A", url: "https://a.example" }] } } }),
    tool("s2", { status: "streaming", content: "", data: { toolCallId: "call-2" } }),
    tool("s3", { status: "failed", content: "超时" }),
    item("a1", { content: "done", attachments: [{ id: "f9", name: "report.pdf" }] }),
    item("m1", { content: "提示词：「猫」", data: { media: { kind: "image", taskId: 7 } } }),
  ], "running"));
  const parts = reply.content as readonly Record<string, unknown>[];
  assert.deepEqual(parts.map((p) => p.type), ["data-process", "tool-call", "tool-call", "tool-call", "text", "data-files", "data-media"]);
  const { timing, ...first } = parts[1] as { timing?: unknown };
  assert.deepEqual(first, { type: "tool-call", toolCallId: "call-1", toolName: "联网搜索", args: {},
    result: { content: "找到 2 条", query: "aui", sources: [{ title: "A", url: "https://a.example" }] }, isError: false });
  assert.ok(timing, "settled tool step carries aui timing");
  assert.equal("timing" in parts[2], false, "a running step has no duration yet");
  assert.equal("result" in parts[2], false, "a running tool has no result yet (aui shows it as running)");
  assert.deepEqual([parts[3].toolCallId, parts[3].isError], ["s3", true]);
  assert.deepEqual(parts[5].data, [{ id: "f9", name: "report.pdf", verified: false }]);
  assert.deepEqual(parts[6].data, { media: { kind: "image", taskId: 7 }, prompt: "提示词：「猫」", failed: false });
});

test("adapter: 重新生成 resends the question; earlier history pages through loadOlder", async () => {
  const sent: string[] = [];
  let older = 0;
  const state = { ...stateOf([item("u1", { role: "user", content: "question" }), item("a1", { content: "answer" })]), hasOlder: true };
  const store = externalStore(state, { send: async (text) => { sent.push(text); }, stop: async () => {}, loadOlder: async () => { older += 1; } });
  await store.onReload!("u1", {} as never);
  await store.onReload!("missing", {} as never);
  assert.deepEqual(sent, ["question"]);
  assert.equal(store.hasEarlier, true);
  await store.onLoadEarlier!();
  assert.equal(older, 1);
  assert.equal("onLoadEarlier" in externalStore(state, { send: async () => {}, stop: async () => {} }), false);
});

test("suggestions: home cards → aui suggestions (locale, prefill vs title, disabled and media cards dropped)", async () => {
  const { toSuggestions } = await vite.ssrLoadModule("/src/chat-react/suggestions.ts") as typeof import("../src/chat-react/suggestions.ts");
  const data = { items: [
    { id: "a", titleZh: "写周报", descZh: "整理本周", action: "fill-title", titleEn: "Weekly", descEn: "Sum up" },
    { id: "b", titleZh: "翻译", descZh: "", action: "prefill", promptZh: "请翻译：" },
    { id: "c", titleZh: "关掉的", enabled: false },
    { id: "generateImage", titleZh: "生成图片" },
    { titleZh: "无 id" }, null, "junk",
  ] };
  assert.deepEqual(toSuggestions(data, "zh-CN"), [
    { title: "写周报", label: "整理本周", prompt: "写周报：" },
    { title: "翻译", label: "", prompt: "请翻译：" },
  ]);
  assert.equal(toSuggestions(data, "en-US")[0].title, "Weekly");
  assert.deepEqual(toSuggestions(null, "zh-CN"), []);
});

test("adapter: step durations follow the Vue rule (until the next step / the answer; explicit durationMs wins)", () => {
  const at = (sec: number) => `2026-11-13T00:00:${String(sec).padStart(2, "0")}Z`;
  const [, reply] = toThreadMessages(stateOf([
    item("u1", { role: "user", content: "q", timestamp: at(0) }),
    item("p1", { lane: "process", title: "排队", userReadable: true, timestamp: at(1) }),
    item("p2", { lane: "process", kind: "tool_call", title: "命令", status: "failed", userReadable: true, timestamp: at(4), data: { toolCallId: "c" } }),
    item("p3", { lane: "process", title: "收尾", userReadable: true, timestamp: at(5), data: { durationMs: 250 } }),
    item("a1", { content: "done", timestamp: at(9) }),
  ]));
  const spans = (reply.content as readonly { timing?: { startedAt: number; completedAt?: number } }[]).slice(1, 4)
    .map((p) => p.timing && (p.timing.completedAt ?? 0) - p.timing.startedAt);
  assert.deepEqual(spans, [3000, 1000, 250]);
  const p2 = (reply.content as readonly Record<string, unknown>[])[2];
  assert.equal(p2.isError, true, "failed tool step is an aui error result");
});

test("adapter: contiguous process steps merge into one 执行过程 summary with the run's total time", () => {
  const at = (s: number) => `2026-11-13T00:00:${String(s).padStart(2, "0")}Z`;
  const proc = (id: string, s: number, over: Partial<ConversationItem> = {}) =>
    item(id, { lane: "process", role: "assistant", kind: "status", userReadable: true, timestamp: at(s), ...over });
  const state = stateOf([
    item("u1", { role: "user", content: "hi", timestamp: at(0) }),
    proc("q", 1, { title: "排队等待" }),
    proc("i", 2, { title: "Agent 初始化" }),
    item("a1", { content: "done", kind: "result", timestamp: at(12) }),
    proc("late", 13, { title: "思考过程" }),
  ]);
  const [, reply] = toThreadMessages(state, { locale: "zh-CN", nowMs: Date.parse(at(30)) });
  const parts = reply.content as readonly { type: string; data?: { summary: string; timing: string } }[];
  assert.deepEqual(parts.map((p) => p.type), ["data-process", "reasoning", "reasoning", "reasoning", "text"], "late process joins the run before the answer");
  assert.equal(parts[0].data?.summary, "3 个步骤 · 已完成");
  assert.equal(parts[0].data?.timing, "总耗时 12.0 秒");
  const en = toThreadMessages(state, { locale: "en-US", nowMs: Date.parse(at(30)) })[1].content as readonly { data?: { summary: string; timing: string } }[];
  assert.deepEqual([en[0].data?.summary, en[0].data?.timing], ["3 steps · Completed", "Total time 12.0s"]);
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

test("streaming + cancel through the framework-free controller and ExternalStore adapter", async () => {
  const { adapter, sent, emit } = streamingAdapter();
  const errors: Error[] = [];
  const { box, subscribe } = observableBoxes();
  const c = createConversationController({ conversationKey: () => "7", adapter: () => adapter, onConnectionChange() {}, onStatusChange() {}, onError: (e) => errors.push(e) }, box);
  let notified = 0;
  const unsubscribe = subscribe(() => { notified += 1; });
  await c.initialize();
  assert.ok(notified > 0 && c.authoritativeReady.value, "subscribe fires on snapshot (useSyncExternalStore contract)");
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
  const before = notified;
  unsubscribe();
  c.dispose();
  assert.equal(notified, before, "unsubscribed listener is not called");
});

test("React island and the controller do not import Vue at runtime", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const files = [
    ...readdirSync(new URL("../src/chat-react/", import.meta.url)).filter((f) => /\.tsx?$/.test(f)).map((f) => `../src/chat-react/${f}`),
    "../src/addons/conversation/task-conversation/conversationController.ts",
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /^import (?!type )[^;]*from "vue"/m, f);
  }
});

test("failed send hands the draft back to the composer (MessageNotSentError)", async () => {
  const store = externalStore(stateOf([]), { send: async () => { throw new Error("409 busy"); }, stop: async () => {} });
  await assert.rejects(store.onNew({ role: "user", content: [{ type: "text", text: "x" }] } as never),
    (e: unknown) => aui.isMessageNotSentError(e) && (e as Error).message === "409 busy");
  assert.equal(isRunning(stateOf([item("a", { status: "streaming" })], "completed")), true);
});

test("queue: onNew 409 parks the message in the single slot instead of MessageNotSentError", async () => {
  const slot = createSingleSlot(async () => {}, () => true, () => {});
  const msg = (text: string) => ({ role: "user", content: [{ type: "text", text }] }) as never;
  const conflict = { send: async () => { throw Object.assign(new Error("busy"), { status: 409 }); }, stop: async () => {} };
  const store = externalStore(stateOf([]), conflict, undefined, undefined, slot);
  assert.equal(store.queue, slot.adapter);
  await store.onNew(msg("late"));
  assert.deepEqual(slot.adapter.items.map((i) => i.prompt), ["late"]);
  const plain = externalStore(stateOf([]), { send: async () => { throw new Error("x"); }, stop: async () => {} }, undefined, undefined, slot);
  await assert.rejects(plain.onNew(msg("y")), (e: unknown) => aui.isMessageNotSentError(e));
  assert.equal(externalStore(stateOf([]), conflict).queue, undefined, "no slot → no queue capability (new chat)");
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
  assert.deepEqual(groups[0]!.options[0]!.label, "c1", "model name first");
  assert.equal(groups[0]!.options[0]!.hint, "P1", "provider as secondary hint");
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

test("ChatApp message rows: avatar, author, time, aui action bar, merged 执行过程 fold, safe markdown (react-dom/server)", async () => {
  const { MessageRow } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof import("../src/chat-react/ChatApp.tsx");
  const { ThreadPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts") as typeof import("../src/chat-react/auiPrimitives.ts");
  const { createElement: h } = React;
  const t = (key: string) => ({ "conversation.you": "你", "home.greeting": "NucleAgent", "common.copy": "复制", "chatReact.process": "执行过程" })[key] ?? key;
  const state = stateOf([
    item("u1", { role: "user", content: "question" }),
    item("p1", { lane: "process", title: "排队等待", userReadable: true }),
    item("p2", { lane: "process", title: "Agent 初始化", userReadable: true }),
    item("a1", { content: "answer [x](javascript:alert(1)) <img src=x onerror=alert(1)> ![p](https://e.example/p.png) - [x] done" }),
  ]);
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(ThreadPrimitive.Viewport, null,
        h(ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) => h(MessageRow, { role: message.role, t }))));
  }
  const html = renderToString(h(App));
  // User side: avatar only (labelled, time in its title), no duplicate 你 name; time still revealed on hover.
  assert.match(html, /data-message-role="user"[^>]*><div class="mc-header"><span class="mc-avatar" role="img" aria-label="你" title="2026-11-13 \d\d:00:00">你<\/span><time class="mc-time"[^>]*>2026-11-13 \d\d:00:00</);
  assert.match(html, /data-message-role="assistant".*class="mc-author"[^>]*>NucleAgent</s);
  assert.equal(html.match(/<button[^>]*class="mc-icon-btn"[^>]*aria-label="复制"/g)?.length, 2, "aui ActionBar copy on both rows");
  assert.equal(html.match(/aria-label="chatReact.reload"/g)?.length, 1, "重新生成 only on the assistant row");
  assert.equal(html.match(/class="mc-process"/g)?.length, 1, "two process steps → one fold");
  assert.equal(html.match(/class="mc-step"/g)?.length, 2);
  // Same policy as markdown.ts: no raw HTML, no images, no script URLs.
  assert.doesNotMatch(html, /<img|href="javascript:|<[^>]*onerror=/);
  assert.match(html, /\[x\]\(javascript:alert\(1\)\)/, "script URL stays inert text (markdown-it validateLink), as in the Vue view");
  assert.match(html, /&lt;img/);
  assert.match(html, /aria-label="执行过程 · 2 个步骤 · 已完成"/);
  assert.doesNotMatch(html, /lucide/);
});

test("copyRawBody: raw text, clipboard failure is reported, stale or revalidating results are dropped", async (t) => {
  const { copyRawBody } = await vite.ssrLoadModule("/src/addons/conversation/components/conversation/messageCopy.ts");
  const { revalidating } = await vite.ssrLoadModule("/src/addons/platform-api/session/embeddedAuthorization.ts");
  const calls: string[] = [];
  let fail = false;
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (v: string) => { calls.push(v); if (fail) throw new Error("denied"); } } } });
  t.after(() => original ? Object.defineProperty(globalThis, "navigator", original) : Reflect.deleteProperty(globalThis, "navigator"));
  assert.equal(await copyRawBody("**raw** <b>", () => true), "copied");
  fail = true;
  assert.equal(await copyRawBody("x", () => true), "error");
  assert.equal(await copyRawBody("x", () => false), undefined, "unmounted/changed message gets no feedback");
  revalidating.value = true;
  try { assert.equal(await copyRawBody("y", () => true), undefined); } finally { revalidating.value = false; }
  assert.equal(await copyRawBody("", () => true), undefined);
  assert.deepEqual(calls, ["**raw** <b>", "x", "x"]);
});

test("attachments: storage upload adapter yields progress, sends only the stored fileId ref, reports failures", async () => {
  const { storageAttachmentAdapter, toConversationAttachments } = await vite.ssrLoadModule("/src/chat-react/attachments.ts") as typeof import("../src/chat-react/attachments.ts");
  const errors: string[] = [];
  const drain = async (gen: AsyncGenerator<{ status: { type: string; progress?: number } }> | Promise<unknown>) => {
    const states: { status: { type: string; progress?: number }; id?: string }[] = [];
    for await (const s of gen as AsyncGenerator<{ status: { type: string; progress?: number } }>) states.push(s);
    return states;
  };
  const file = new File(["hello"], "a.png", { type: "image/png" });
  const ok = storageAttachmentAdapter((f, m) => errors.push(`${f.name}:${m}`), async (_f, onProgress) => {
    onProgress(1, 2); await tick();
    return { fileId: "f-1", name: "a.png", mimeType: "image/png", size: 5, sha256: "x" };
  });
  const states = await drain(ok.add({ file }) as never);
  assert.deepEqual(states.map((s) => s.status.type), ["running", "running", "requires-action"]);
  assert.equal(states[1].status.progress, 0.5);
  const done = await ok.send({ ...states.at(-1), file } as never);
  assert.deepEqual(done, { id: "f-1", type: "image", name: "a.png", contentType: "image/png", status: { type: "complete" }, content: [] });
  assert.equal("file" in done, false, "no File object travels with the message");
  await assert.rejects(ok.send({ ...states.at(-1), file } as never), /未上传完成/, "a ref is sent once");
  assert.deepEqual(toConversationAttachments([done]), [{ id: "f-1", name: "a.png", mimeType: "image/png" }]);

  const failing = storageAttachmentAdapter((f, m) => errors.push(`${f.name}:${m}`), async () => { throw new Error("boom"); });
  const failed = await drain(failing.add({ file }) as never);
  assert.equal(failed.at(-1)?.status.type, "incomplete");
  await assert.rejects(failing.send({ ...failed.at(-1), file } as never));
  const huge = { name: "big.bin", type: "", size: 200 * 1024 * 1024 } as File;
  let called = false;
  const capped = storageAttachmentAdapter((f, m) => errors.push(`${f.name}:${m}`), async () => { called = true; throw new Error("x"); });
  assert.equal((await drain(capped.add({ file: huge }) as never)).at(-1)?.status.type, "incomplete");
  assert.equal(called, false, "oversize files never hit the upload API");
  assert.deepEqual(errors, ["a.png:上传失败", "big.bin:文件超过 100MB 上限"]);
});

test("attachments: onNew forwards refs to the controller; history shows them on the user message", async () => {
  const calls: unknown[] = [];
  const store = externalStore(stateOf([]), { send: async (text, files) => { calls.push([text, files]); }, stop: async () => {} });
  await store.onNew({ role: "user", content: [{ type: "text", text: "see file" }],
    attachments: [{ id: "f-1", type: "file", name: "r.pdf", contentType: "application/pdf", status: { type: "complete" }, content: [] }] } as never);
  assert.deepEqual(calls, [["see file", [{ id: "f-1", name: "r.pdf", mimeType: "application/pdf" }]]]);
  const [user] = toThreadMessages(stateOf([item("u1", { role: "user", content: "q", attachments: [{ id: "f-9", name: "x.png", mimeType: "image/png", size: 3 }] })]));
  assert.deepEqual(user.attachments, [{ id: "f-9", type: "image", name: "x.png", contentType: "image/png", status: { type: "complete" }, content: [],
    chip: { id: "f-9", name: "x.png", mimeType: "image/png", size: 3, verified: false } }]);
});

test("sealedLink: sealed tool links open via Core in a fresh no-opener tab; others and unsafe results are not opened", async (t) => {
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const { openSealedLinkOnClick } = await vite.ssrLoadModule("/src/chat-react/sealedLink.ts");
  const posts: unknown[] = [];
  let reply = "https://wb.example.com/real";
  const unregister = registerPlatformRuntime({ http: { post: async (url: string, body: unknown) => { posts.push([url, body]); return { data: { url: reply } }; } } } as never);
  const tabs: { opener: unknown; location: { href: string }; closed?: boolean; close(): void }[] = [];
  const win = globalThis.window as unknown as { open: unknown };
  const originalOpen = win.open;
  win.open = () => { const tab = { opener: {}, location: { href: "" }, close() { tab.closed = true; } } as (typeof tabs)[number]; tabs.push(tab); return tab; };
  const doc = (globalThis.window as unknown as { document: Document }).document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc }); // toast.error mounts into it
  t.after(() => { win.open = originalOpen; unregister(); Reflect.deleteProperty(globalThis, "document"); });
  const click = async (href: string, key = "42") => {
    doc.body.innerHTML = `<div data-conversation-key="${key}"><a href="${href}">x</a></div>`;
    const event = { target: doc.querySelector("a"), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    await openSealedLinkOnClick(event as unknown as MouseEvent);
    return event.defaultPrevented;
  };
  assert.equal(await click("https://e.example/plain"), false, "ordinary links follow the browser");
  assert.equal(await click("https://wb.example.com/52?token=nlk.abc", ""), false, "no conversation id → not handled");
  assert.equal(await click("https://wb.example.com/52?token=nlk.abc"), true);
  assert.deepEqual(posts, [["/api/v1/addons/conversation/42/tool-link", { url: "https://wb.example.com/52?token=nlk.abc" }]]);
  assert.equal(tabs[0].opener, null);
  assert.equal(tabs[0].location.href, "https://wb.example.com/real");
  reply = "javascript:alert(1)";
  await click("https://wb.example.com/52?token=nlk.abc");
  assert.equal(tabs[1].location.href, "", "unsafe Core reply never navigates");
  assert.equal(tabs[1].closed, true);
  assert.match(doc.body.textContent ?? "", /链接无法打开/);
});
