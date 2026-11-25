import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { messages1131, settlement1131 } from "./fixtures/muyu409Conversation1131.ts";
import { messageTimingData } from "../src/addons/conversation/composables/conversationTiming.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-409 / PROD 1131: every async image/video card shows its own authoritative receipt, updates by itself
// and has no 刷新媒体状态 button. Structure fixture from the real 1131 read (desensitized).
let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let usage: typeof import("../src/chat-react/turnUsage.ts");
let threads: typeof import("../src/chat-react/threadMessages.ts");
let settlement: typeof import("../src/addons/conversation/api/settlement.ts");
let runtime: typeof import("../src/contracts/platform-runtime.ts");
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let aui: typeof import("@assistant-ui/react");
let Viewport: import("react").ElementType;
let tasks: Record<number, unknown>;
let taskReads: string[];
let writes: string[];
let settlementBody: unknown;
let settlementReads = 0;

const zh = (key: string, values?: Record<string, unknown>) => {
  const value = key.startsWith("chatReact.") ? (ZH_STRINGS as Record<string, string>)[key.slice(10)] ?? key : key;
  return value.replace(/\{(\w+)\}/g, (_, k) => String(values?.[k] ?? ""));
};
const ok = (id: number, kind: string) => ({ id, kind, status: "succeeded", downloadUrl: `https://cdn.example/${id}` });

before(async () => {
  const dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: (run: () => void) => setTimeout(run, 0), cancelAnimationFrame: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  usage = await vite.ssrLoadModule("/src/chat-react/turnUsage.ts") as typeof usage;
  threads = await vite.ssrLoadModule("/src/chat-react/threadMessages.ts") as typeof threads;
  settlement = await vite.ssrLoadModule("/src/addons/conversation/api/settlement.ts") as typeof settlement;
  runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts") as typeof runtime;
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts") as { externalStore: typeof externalStore });
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts") as typeof reducer;
  aui = await import("@assistant-ui/react");
  Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
  runtime.registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string) => {
      if (url.endsWith("/settlement")) { settlementReads++; return { data: { data: settlementBody } }; }
      taskReads.push(url);
      const task = tasks[+url.split("/").at(-1)!];
      if (task instanceof Error) throw task;
      return { data: task };
    },
    post: async (url: string) => { writes.push(url); throw new Error("unexpected write"); },
    patch: async (url: string) => { writes.push(url); throw new Error("unexpected write"); },
  } } as never);
});
after(async () => { await vite?.close(); });

const toItem = (message: (typeof messages1131)[number]): ConversationItem => ({
  id: String(message.id), turnId: "main", streamId: String(message.id), lane: "answer", role: message.senderType === "user" ? "user" : "assistant",
  kind: message.senderType === "user" ? "text" : "result", content: message.content, status: "complete", revision: 1, seq: message.id,
  timestamp: message.createdAt, data: { ...messageTimingData(message), ...(message.metadata?.media ? { media: message.metadata.media } : {}) },
});
const stateOf = (items: ConversationItem[]) => reducer.reduceConversation(reducer.createConversationState("1131"), {
  type: "event.received",
  event: { protocolVersion: 2, type: "snapshot", conversationKey: "1131", eventId: "s", cursor: "c", turnId: "main",
    streamId: "snapshot", lane: "system", revision: 0, seq: 0, timestamp: "2026-11-25T11:00:00Z", snapshot: { items, status: "completed", hasOlder: false, cursor: "c" } },
});

async function mount(context: import("node:test").TestContext, body: unknown = settlement1131) {
  taskReads = []; writes = []; settlementReads = 0; settlementBody = body;
  tasks = { 31: ok(31, "image"), 32: ok(32, "video"), 33: ok(33, "video"), 34: ok(34, "image"), 35: ok(35, "image") };
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const state = stateOf(messages1131.map(toItem));
  function App({ id }: { id: string }) {
    const rt = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    const evidence = app.useSettlement(id, settlement.readSettlement, undefined, (app as { settlementKeys?: (s: unknown) => string }).settlementKeys?.(state) ?? "");
    return React.createElement(aui.AssistantRuntimeProvider, { runtime: rt }, React.createElement(Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) =>
        React.createElement(app.MessageRow, { role: message.role, t: zh as never, conversationId: id, evidence }))));
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const draw = (id = "1131") => React.act(async () => root.render(React.createElement(App, { id })));
  // Fake time moves in 1 s steps so a timer set after an awaited read is due inside the same window.
  const wait = async (ms: number) => { for (let left = ms; left >= 0; left -= 1000) await React.act(async () => { context.mock.timers.tick(Math.min(1000, Math.max(left, 0))); await Promise.resolve(); }); };
  const cards = () => [...container.querySelectorAll(".mc-media-card")].map((card) => ({
    usage: card.querySelector("[data-testid=mc-turn-usage]")?.textContent?.replace(/ /g, " ").trim() ?? null,
    state: card.querySelector("[data-testid=mc-turn-usage]")?.getAttribute("data-settlement") ?? null,
    refresh: [...card.querySelectorAll("button")].some((button) => /刷新/.test(button.textContent ?? "")),
  }));
  const rows = () => [...container.querySelectorAll(".mc-msg[data-message-role=assistant]")].map((row) =>
    row.querySelector(":scope > [data-testid=mc-turn-usage]")?.textContent?.replace(/ /g, " ").trim() ?? null);
  const close = async () => { await React.act(async () => root.unmount()); container.remove(); context.mock.timers.reset(); };
  return { container, draw, wait, cards, rows, close };
}

test("RED 1131: each media card shows its own authoritative receipt; no card shows the text turn's fee; no refresh button", async (context) => {
  const view = await mount(context);
  try {
    await view.draw();
    await view.wait(0);
    await view.wait(0);
    // Card order on the page: 31 | 34, 35, 32, 33 (four results in one reply, as in PROD 1131).
    assert.deepEqual(view.cards(), [
      { usage: "12 贝壳（≈¥0.1200）", state: "settled", refresh: false },
      { usage: "12 贝壳（≈¥0.1200）", state: "settled", refresh: false },
      { usage: "12 贝壳（≈¥0.1200）", state: "settled", refresh: false },
      { usage: "200 贝壳（≈¥2.0000）", state: "settled", refresh: false },
      { usage: "200 贝壳（≈¥2.0000）", state: "settled", refresh: false },
    ]);
    // The text turn keeps its own fee; media-only replies carry no row-level 计费中.
    assert.deepEqual(view.rows(), [null, "16 贝壳（≈¥0.1547）", null]);
    assert.doesNotMatch(view.container.textContent!, /计费中|刷新媒体状态/);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("media receipt projection is by its own media-<taskId> receipt only: unknown stays 计费中 (never 0), pending is 待结算, others' or ambiguous receipts are never borrowed", () => {
  const rows = (list: object[]) => list.map((row) => ({ conversationId: "1131", upstreams: [], revision: 1, ...row })) as never;
  const settled = { taskId: 31, turnId: "media-31", state: "settled", points: "360", shells: "12", pointsName: { "zh-CN": "贝壳" }, creditsPerCny: 3000, rate: { creditsAmount: 3000, coinAmount: 100 } };
  assert.equal(usage.mediaUsage("1131", 31, rows([settled])).shells, "12");
  assert.deepEqual(usage.mediaUsage("1131", 31, rows([{ taskId: 31, turnId: "media-31", state: "unknown", points: null }])), { state: "unknown", points: "—" });
  assert.equal(usage.mediaUsage("1131", 31, rows([{ taskId: 31, turnId: "media-31", state: "pending", points: null }])).state, "pending");
  assert.equal(usage.mediaUsage("1131", 31, rows([{ ...settled, taskId: 34, turnId: "media-34" }, { taskId: undefined, turnId: "step-a", state: "settled", points: "464" }])).state, "unknown");
  assert.equal(usage.mediaUsage("1131", 31, rows([settled, { ...settled }])).state, "unknown", "two receipts of one revision: ambiguous");
  assert.equal(usage.mediaUsage("other", 31, rows([settled])).state, "unknown");
  assert.equal(usage.mediaUsage("1131", 31, usage.LOADING_EVIDENCE).loading, true);
});

test("pending → settled updates the card by itself, then stops; UNKNOWN is kept and re-read only within bounds", async (context) => {
  const pending = { ...settlement1131, mediaTasks: settlement1131.mediaTasks.map((row) => row.taskId === 33 ? { ...row, state: "pending", credits: null, points: null } : row) };
  const view = await mount(context, pending);
  try {
    await view.draw();
    await view.wait(0);
    assert.equal(view.cards()[4]!.usage, "待结算");
    settlementBody = settlement1131;
    for (let i = 0; i < 4 && view.cards()[4]!.state !== "settled"; i++) await view.wait(60_000);
    assert.equal(view.cards()[4]!.usage, "200 贝壳（≈¥2.0000）", "the receipt lands without a click");
    const reads = settlementReads;
    await view.wait(1_200_000);
    assert.equal(settlementReads, reads, "all settled: no more reads");
  } finally { await view.close(); }

  const unknown = { ...settlement1131, mediaTasks: settlement1131.mediaTasks.map((row) => row.taskId === 32 ? { ...row, state: "unknown", credits: null, points: null } : row) };
  const again = await mount(context, unknown);
  try {
    await again.draw();
    await again.wait(0);
    await again.wait(1_200_000);
    assert.equal(again.cards()[3]!.usage, "计费中", "UNKNOWN never becomes 0 or settled");
    assert.ok(settlementReads <= 8, `bounded re-reads, saw ${settlementReads}`);
    assert.deepEqual(writes, [], "no replay, no write");
  } finally { await again.close(); }
});

test("a running video card polls by itself with a growing, capped wait past the old 60 s, stops at a terminal state, and leaving cancels", async (context) => {
  const view = await mount(context);
  try {
    tasks[33] = { id: 33, kind: "video", status: "running" };
    await view.draw();
    await view.wait(0);
    const of33 = () => taskReads.filter((url) => url.endsWith("/33")).length;
    assert.match(view.container.textContent!, /正在生成/);
    await view.wait(150_000); // 1131's videos took 2m00s–2m23s
    const during = of33();
    assert.ok(during >= 4 && during <= 14, `bounded polls, saw ${during}`);
    tasks[33] = ok(33, "video");
    await view.wait(60_000);
    assert.equal(view.container.querySelectorAll("video").length, 2, "completed without a click");
    const done = of33();
    await view.wait(1_200_000);
    assert.equal(of33(), done, "terminal: polling stopped");
    tasks[33] = { id: 33, kind: "video", status: "running" };
    await view.draw("other");
    const left = taskReads.length;
    await view.wait(1_200_000);
    assert.ok(taskReads.length - left <= 5, "leaving the conversation cancels the old cards' timers");
  } finally { await view.close(); }
});
