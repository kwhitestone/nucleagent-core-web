import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 exp117 RED: an already settled conversation must not flash "计费中" before its first settlement read
// returns. Three states, kept apart:
//  - loading (no read has answered yet, and the turn is not streaming): a quiet placeholder — no 计费中, no number, no ¥;
//  - real pending / unknown (the read answered so, or the turn is streaming right now): exactly as before;
//  - settled: N 贝壳（≈¥X）from the existing functions.
// A failed or timed-out first read falls back to the existing display; it never stays blank.

let vite: ViteDevServer;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let usageModule: typeof import("../src/chat-react/turnUsage.ts");
let settlement: typeof import("../src/addons/conversation/api/settlement.ts");
let runtime: typeof import("../src/contracts/platform-runtime.ts");
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let renderToString: typeof import("react-dom/server").renderToString;
let React: typeof import("react");
let aui: typeof import("@assistant-ui/react");
let Viewport: import("react").ElementType;

before(async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: new JSDOM("").window });
  vite = await createServer({ appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  usageModule = await vite.ssrLoadModule("/src/chat-react/turnUsage.ts") as typeof usageModule;
  settlement = await vite.ssrLoadModule("/src/addons/conversation/api/settlement.ts") as typeof settlement;
  runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts") as typeof runtime;
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts") as { externalStore: typeof externalStore });
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts") as typeof reducer;
  ({ renderToString } = await import("react-dom/server"));
  React = await import("react");
  aui = await import("@assistant-ui/react");
  Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
});
after(async () => { await vite.close(); });

const zh = (key: string) => (ZH_STRINGS as Record<string, string>)[key.replace(/^chatReact\./, "")] ?? key;
const strip = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "").replace(/&nbsp;| /g, " ").trim();
const scope = { conversationId: "7", turnId: "turn-a" };
const NAME = { "zh-CN": "贝壳", en: "Seashell" };
const RATE = { creditsAmount: 3000, coinAmount: 100 };
const row = (over: object = {}) => ({ ...scope, state: "settled", points: "17", shells: "3", pointsName: NAME, creditsPerCny: 3000, rate: RATE,
  upstreams: ["aihub-gateway"], revision: 2, ...over });
const loading = () => usageModule.LOADING_EVIDENCE;
const text = (evidence: Parameters<typeof usageModule.turnUsage>[1], active?: boolean) =>
  strip(renderToString(React.createElement(app.TurnUsage, { t: zh, usage: (usageModule.turnUsage as (...a: unknown[]) => never)(scope, evidence, active) })));

test("loading: before the first read answers, a finished turn shows a quiet placeholder — no 计费中, no number, no ¥", () => {
  assert.ok(Array.isArray(loading()), "turnUsage.ts exports the not-yet-read marker");
  const shown = text(loading());
  assert.equal(shown, "", "nothing visible while the first read is outstanding");
  assert.doesNotMatch(shown, /计费中|待结算|\d|¥/);
  const html = renderToString(React.createElement(app.TurnUsage, { t: zh, usage: usageModule.turnUsage(scope, loading()) }));
  assert.match(html, /data-testid="mc-turn-usage"/, "the line keeps its place (no layout jump when the amount lands)");
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /计费中/, "not even in the title");
});

test("streaming: a turn that is running right now still shows 计费中 while the first read is outstanding", () => {
  assert.equal(text(loading(), true), "计费中");
});

test("real pending / unknown after the read answered: unchanged (待结算 / 计费中, never a number or ¥)", () => {
  assert.equal(text([row({ state: "pending", points: null, shells: undefined, revision: 1 })]), "待结算");
  assert.equal(text([row({ state: "unknown", points: null, shells: undefined })]), "计费中");
  assert.equal(text([]), "计费中", "a read that answered with no row for this turn is the existing unknown");
  assert.equal(text([row({ conversationId: "8" })]), "计费中");
  assert.equal(text(undefined), "计费中", "no evidence passed at all (old callers) stays 计费中");
  assert.equal(text([row({ state: "pending", points: null, shells: undefined, revision: 1 })], true), "待结算");
});

test("settled: N 贝壳（≈¥X）from the existing functions, streaming flag or not", () => {
  assert.equal(text([row()]), "3 贝壳（≈¥0.0057）");
  assert.equal(text([row()], true), "3 贝壳（≈¥0.0057）");
  assert.equal(text([row({ points: "7", shells: "1" })]), "1 贝壳（≈¥0.0023）");
});

test("the marker is only the marker: an equal empty array is a real (empty) answer", () => {
  assert.equal(usageModule.turnUsage(scope, []).state, "unknown");
  assert.equal(text([...loading()]), "计费中");
  assert.equal(text(loading()), "");
});

// --- through the hook (useSettlement), as ChatApp wires it -------------------------------------------------------

async function mountHook(context: import("node:test").TestContext) {
  const document = window.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const reads: { resolve(rows: unknown): void; reject(error: Error): void; signal: AbortSignal }[] = [];
  const reader = (_id: string, signal: AbortSignal) => new Promise<never>((resolve, reject) => reads.push({ resolve: resolve as never, reject, signal }));
  const Probe = ({ id, read }: { id: string; read?: typeof reader }) =>
    React.createElement(app.TurnUsage, { t: zh, usage: usageModule.turnUsage({ conversationId: id, turnId: "turn-a" }, app.useSettlement(id, read)) });
  const root = createRoot(container);
  const draw = (id = "7", withReader = true) => React.act(async () => root.render(React.createElement(Probe, { id, read: withReader ? reader : undefined })));
  const shown = () => (container.querySelector("[data-testid=mc-turn-usage]")!.textContent ?? "").replace(/ /g, " ").trim();
  const wait = (ms: number) => React.act(async () => context.mock.timers.tick(ms));
  const cleanup = async () => {
    await React.act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "document");
  };
  return { reads, draw, shown, wait, cleanup };
}

test("hook: first paint of a settled conversation is the placeholder, then the shells — never 计费中 in between", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw();
    assert.equal(h.reads.length, 1);
    assert.equal(h.shown(), "", "first paint: no 计费中");
    await React.act(async () => h.reads[0]!.resolve([row()]));
    assert.equal(h.shown(), "3 贝壳（≈¥0.0057）");
  } finally { await h.cleanup(); }
});

test("hook: a first read answering pending shows 待结算 (real pending unchanged)", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw();
    await React.act(async () => h.reads[0]!.resolve([row({ state: "pending", points: null, shells: undefined, revision: 1 })]));
    assert.equal(h.shown(), "待结算");
  } finally { await h.cleanup(); }
});

test("hook: a failed first read falls back to the existing 计费中 (never blank forever)", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw();
    await React.act(async () => h.reads[0]!.reject(new Error("offline")));
    assert.equal(h.shown(), "计费中");
  } finally { await h.cleanup(); }
});

test("hook: a first read that never answers falls back to 计费中 after 5 s; a late answer still lands", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw();
    await h.wait(4999);
    assert.equal(h.shown(), "", "still waiting");
    await h.wait(1);
    assert.equal(h.shown(), "计费中", "timed out: the existing display, not a permanent blank");
    await React.act(async () => h.reads[0]!.resolve([row()]));
    assert.equal(h.shown(), "3 贝壳（≈¥0.0057）");
  } finally { await h.cleanup(); }
});

test("hook: switching conversation shows the placeholder again, not the old conversation's unknown", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw("7");
    await React.act(async () => h.reads[0]!.resolve([row()]));
    assert.equal(h.shown(), "3 贝壳（≈¥0.0057）");
    await h.draw("8");
    assert.equal(h.reads.length, 2);
    assert.equal(h.shown(), "", "conversation 8 has not been read yet");
    await React.act(async () => h.reads[1]!.resolve([row({ conversationId: "8" })]));
    assert.equal(h.shown(), "3 贝壳（≈¥0.0057）");
  } finally { await h.cleanup(); }
});

test("hook: without a reader nothing is ever loading — the existing 计费中", async (context) => {
  const h = await mountHook(context);
  try {
    await h.draw("7", false);
    assert.equal(h.reads.length, 0);
    assert.equal(h.shown(), "计费中");
  } finally { await h.cleanup(); }
});

// --- MessageRow: the streaming turn ---------------------------------------------------------------------------

const item = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "answer", role: "assistant", kind: "text", content: id,
  status: "complete", revision: 1, seq: 1, timestamp: "2026-11-13T00:00:00Z", ...over,
});
const stateOf = (items: ConversationItem[], status: "idle" | "running" | "completed") =>
  reducer.reduceConversation(reducer.createConversationState("7"), {
    type: "event.received",
    event: { protocolVersion: 2, type: "snapshot", conversationKey: "7", eventId: "s", cursor: "c", turnId: "main",
      streamId: "snapshot", lane: "system", revision: 0, seq: 0, timestamp: "2026-11-13T00:00:00Z",
      snapshot: { items, status, hasOlder: false, cursor: "c" } },
  });
function rows(status: "running" | "completed", evidence: readonly unknown[]) {
  const state = stateOf([
    item("u1", { role: "user", content: "one" }), item("a1", { data: { runStepId: "turn-old", mainRun: true } }),
    item("u2", { role: "user", content: "two" }), item("a2", { status: status === "running" ? "streaming" : "complete", data: { runStepId: "turn-a", mainRun: true } }),
  ], status);
  function App() {
    const rt = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime: rt }, React.createElement(Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) =>
        React.createElement(app.MessageRow, { role: message.role, t: zh, conversationId: "7", evidence: evidence as never }))));
  }
  return [...new JSDOM(renderToString(React.createElement(App))).window.document.querySelectorAll("[data-testid=mc-turn-usage]")]
    .map((node) => (node.textContent ?? "").replace(/ /g, " ").trim());
}

test("MessageRow: while loading, the finished turn is quiet and the streaming turn still says 计费中", () => {
  assert.deepEqual(rows("running", loading()), ["", "计费中"]);
  assert.deepEqual(rows("completed", loading()), ["", ""]);
});

test("MessageRow: after the read, a just-sent streaming turn with no row yet still says 计费中", () => {
  assert.deepEqual(rows("running", [row({ turnId: "turn-old" })]), ["3 贝壳（≈¥0.0057）", "计费中"]);
});

// --- old Core: every rate / points field null -------------------------------------------------------------------

test("old Core (all new fields null/absent): loading is quiet, then the existing N 积分 / 待结算", async () => {
  const answer = { data: { code: 0, data: { unit: "credits", revision: 9, pointsName: null, creditsPerCny: null, rate: null, pointsStatus: null, pointsReason: null, rateAgeSeconds: null,
    turns: [{ stepId: "turn-a", state: "settled", credits: "17", points: null, upstreams: ["aihub-gateway"], revision: 9 },
      { stepId: "turn-b", state: "pending", credits: null, points: null, upstreams: [], revision: 1 }] } } };
  const off = runtime.registerPlatformRuntime({ http: { get: async () => answer } } as never);
  try {
    const read = usageModule.settlementRows(await settlement.readSettlement("7", new AbortController().signal));
    assert.equal(text(loading()), "");
    assert.equal(text(read), "17 积分");
    assert.equal(strip(renderToString(React.createElement(app.TurnUsage, { t: zh, usage: usageModule.turnUsage({ ...scope, turnId: "turn-b" }, read) }))), "待结算");
  } finally { off(); }
});

test("real Core answers (PROD 1007/1027): placeholder while loading, then exactly the old stable text", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/settlement-shells.json", import.meta.url), "utf8"));
  for (const [key, expected] of [["PROD-1007", "3 贝壳（≈¥0.0057）"], ["PROD-1027", "1 贝壳（≈¥0.0023）"]] as const) {
    const raw = fixtures[key];
    const off = runtime.registerPlatformRuntime({ http: { get: async () => raw } } as never);
    try {
      const read = usageModule.settlementRows(await settlement.readSettlement("7", new AbortController().signal));
      const turnId = raw.data.data.turns[0].stepId;
      const show = (evidence: Parameters<typeof usageModule.turnUsage>[1]) =>
        strip(renderToString(React.createElement(app.TurnUsage, { t: zh, usage: usageModule.turnUsage({ conversationId: "7", turnId }, evidence) })));
      assert.equal(show(loading()), "", key);
      assert.equal(show(read), expected, key);
    } finally { off(); }
  }
});
