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
let createSingleSlot: typeof import("../src/chat-react/singleSlotQueue.ts").createSingleSlot;
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
  ({ createSingleSlot } = await vite.ssrLoadModule("/src/chat-react/singleSlotQueue.ts"));
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
  // Priority: URL > localStorage > runtime-config CHAT_UI_DEFAULT > old (vue).
  const env = () => "react" as const;
  assert.equal(chatUi("", store(null), env), "react");
  assert.equal(chatUi("", store("vue"), env), "vue");
  assert.equal(chatUi("?chatUi=vue", store(null), env), "vue");
  assert.equal(chatUi("", store(null), () => undefined), "vue");
  // Default fallback reads the loaded runtime config (fixture has no key → old).
  assert.equal(chatUi("", store(null)), "vue");
});

test("adapter: user items split turns; process → one data-process part, answer → text; hidden lanes dropped", () => {
  const messages = toThreadMessages(stateOf([
    item("u1", { role: "user", content: "hi" }),
    item("t1", { lane: "process", title: "思考过程", content: "plan", userReadable: true }),
    item("tool-hidden", { lane: "tool", content: "secret" }),
    item("a1", { content: "**hello**" }),
    item("u2", { role: "user", content: "again" }),
    item("e1", { lane: "system", status: "failed", content: "boom" }),
  ]));
  assert.deepEqual(messages.map((m) => [m.id, m.role]), [["u1", "user"], ["t1", "assistant"], ["u2", "user"], ["e1", "assistant"]]);
  const [process, answer] = messages[1].content as readonly { type: string; data?: { summary: string; steps: { title: string; content: string }[] } }[];
  assert.equal(process.type, "data-process");
  assert.equal(process.data?.summary, "1 个步骤 · 已完成");
  assert.deepEqual(process.data?.steps.map((step) => [step.title, step.content]), [["思考过程", "plan"]]);
  assert.deepEqual(answer, { type: "text", text: "**hello**" });
  assert.deepEqual(messages[1].status, { type: "complete", reason: "stop" });
  assert.deepEqual(messages[3].status, { type: "incomplete", reason: "error" });
  assert.equal((messages[3].metadata?.custom as { failed: boolean }).failed, true);
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
  const parts = reply.content as readonly { type: string; data?: { summary: string; timing: string; steps: unknown[] } }[];
  assert.deepEqual(parts.map((p) => p.type), ["data-process", "text"], "late process joins the run before the answer");
  assert.equal(parts[0].data?.summary, "3 个步骤 · 已完成");
  assert.equal(parts[0].data?.steps.length, 3);
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

test("ChatApp message rows: avatar, author, time, copy button and merged 执行过程 row (react-dom/server)", async (t0) => {
  // DOMPurify is browser-only; under SSR strip tags like messageAttachmentDisplay.test does.
  const DOMPurify = (await import("dompurify")).default;
  const sanitize = DOMPurify.sanitize;
  DOMPurify.sanitize = ((text: string) => text.replace(/<[^>]*>/g, "")) as typeof DOMPurify.sanitize;
  t0.after(() => { DOMPurify.sanitize = sanitize; });
  const { MessageRow } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof import("../src/chat-react/ChatApp.tsx");
  const { ThreadPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts") as typeof import("../src/chat-react/auiPrimitives.ts");
  const { createElement: h } = React;
  const t = (key: string) => ({ "conversation.you": "你", "home.greeting": "NucleAgent", "common.copy": "复制", "chatReact.process": "执行过程" })[key] ?? key;
  const state = stateOf([
    item("u1", { role: "user", content: "question" }),
    item("p1", { lane: "process", title: "排队等待", userReadable: true }),
    item("p2", { lane: "process", title: "Agent 初始化", userReadable: true }),
    item("a1", { content: "answer" }),
  ]);
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(ThreadPrimitive.Viewport, null,
        h(ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) => h(MessageRow, { role: message.role, t }))));
  }
  const html = renderToString(h(App));
  assert.match(html, /data-message-role="user".*class="mc-avatar"[^>]*>你<.*class="mc-author">你<.*class="mc-time">2026-11-13 \d\d:00:00</s);
  assert.match(html, /data-message-role="assistant".*class="mc-author">NucleAgent</s);
  assert.equal(html.match(/<button[^>]*class="mc-copy"[^>]*aria-label="复制"/g)?.length, 2);
  assert.equal(html.match(/class="mc-process"/g)?.length, 1, "two process steps → one row");
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
  assert.deepEqual(user.attachments, [{ id: "f-9", type: "image", name: "x.png", contentType: "image/png", status: { type: "complete" }, content: [] }]);
});
