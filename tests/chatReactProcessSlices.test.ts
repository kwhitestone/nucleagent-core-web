import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";
import { messageTimingData } from "../src/addons/conversation/composables/conversationTiming.ts";

let vite: ViteDevServer;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let projection: typeof import("../src/chat-react/threadMessages.ts");
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let React: typeof import("react");
let aui: typeof import("@assistant-ui/react");
let renderToString: typeof import("react-dom/server").renderToString;
let Viewport: import("react").ElementType;
let unregister: () => void;

before(async () => {
  if (process.env.SLICE_BASELINE) process.chdir(process.env.SLICE_BASELINE);
  Object.defineProperty(globalThis, "window", { configurable: true, value: new JSDOM("").window });
  vite = await createServer({ root: process.env.SLICE_BASELINE || process.cwd(), appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({ useEmbeddedAuthorization: () => ({ can: () => false }) });
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx");
  Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
  projection = await vite.ssrLoadModule("/src/chat-react/threadMessages.ts");
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");
  React = await import("react");
  aui = await import("@assistant-ui/react");
  ({ renderToString } = await import("react-dom/server"));
});
after(async () => { unregister(); await vite.close(); });

const item = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "answer", role: "assistant", kind: "text", content: id,
  status: "complete", revision: 1, seq: 1, timestamp: "2026-11-19T00:00:00Z", ...over,
});
const stateOf = (items: ConversationItem[]) => reducer.reduceConversation(reducer.createConversationState("7"), {
  type: "event.received", event: { protocolVersion: 2, type: "snapshot", conversationKey: "7", eventId: "s", cursor: "c", turnId: "main",
    streamId: "snapshot", lane: "system", revision: 0, seq: 0, timestamp: "2026-11-19T00:00:00Z",
    snapshot: { items, status: "completed", hasOlder: false, cursor: "c" } },
});
const fixture = () => [
  item("thought", { lane: "process", userReadable: true, content: "SANITIZED_OWNER_CONTENT", status: "streaming", data: messageTimingData({ id: 1, conversationId: 7, senderType: "agent", senderName: "agent.thinking", msgType: "streaming", content: "SANITIZED_OWNER_CONTENT", metadata: { thinkingCapturedAs: "full", thinkingVisibility: "full" }, createdAt: "2026-11-19T00:00:00Z" }) }),
  ...Array.from({ length: 18 }, (_, index) => item(`msg-${index + 1}`, {
    lane: "process", kind: "tool_call", title: "命令执行", userReadable: true,
    status: index < 13 ? "complete" : "failed", content: index < 13 ? "操作完成" : `执行命令失败 · ${index === 17 ? "5.5" : "0.0"} 秒`,
    data: { toolCallId: `independent-${index}`, durationMs: index === 17 ? 5500 : 0 },
  })),
  item("answer", { content: "给2048游戏做逻辑验证。" }),
];
function htmlFor(messages: ReturnType<typeof projection.toThreadMessages>) {
  function App() {
    const runtime = aui.useExternalStoreRuntime({ messages, convertMessage: message => message, isRunning: false, onNew: async () => {} });
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null, React.createElement(aui.ThreadPrimitive.Messages, null,
      ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t: (key: string) => key }))));
  }
  return renderToString(React.createElement(App));
}

test("server-sanitized owner Message fixture preserves its content and all 18 calls in live and restored projections", () => {
  for (const status of ["streaming", "complete"] as const) {
    const items = fixture();
    items[0].status = status;
    const messages = projection.toThreadMessages(stateOf(items));
    assert.match(JSON.stringify(messages), /SANITIZED_OWNER_CONTENT/);
    const content = messages[0].content as { type: string; isError?: boolean; toolCallId?: string }[];
    const calls = content.filter(part => part.type === "tool-call");
    assert.equal(calls.length, 18);
    assert.equal(calls.filter(part => part.isError).length, 5);
    assert.equal(new Set(calls.map(part => part.toolCallId)).size, 18);
  }
});

test("native reasoning stays hidden while projected thinking has its own collapsed fold", () => {
  const html = htmlFor([{ id: "legacy", role: "assistant", metadata: { custom: {} }, status: { type: "complete", reason: "stop" }, content: [
    { type: "reasoning", text: "NATIVE_REASONING_SENTINEL" },
    { type: "data-thinking", data: { text: "LEGACY_THINKING_SENTINEL", active: true } },
    { type: "text", text: "普通答复" },
  ] }]);
  assert.doesNotMatch(html, /NATIVE_REASONING_SENTINEL/);
  const fold = new JSDOM(html).window.document.querySelector('details.mc-reasoning');
  assert.ok(fold);
  assert.equal(fold.hasAttribute('open'), false);
  assert.equal(fold.querySelector('pre')?.textContent, 'LEGACY_THINKING_SENTINEL');
  assert.match(html, /普通答复/);
});

test("same-image fold keeps all attempts and existing failure evidence, without duplicate timers", () => {
  const html = htmlFor(projection.toThreadMessages(stateOf(fixture())));
  const dom = new JSDOM(html).window.document;
  assert.equal(dom.querySelectorAll('.mc-step[data-state="failed"]').length, 5);
  assert.equal(dom.querySelectorAll('.mc-step[data-state="done"]').length, 13);
  assert.match(dom.querySelector(".mc-process-summary")!.textContent!, /18 个步骤 · 存在失败/);
  assert.equal(dom.querySelector(".mc-process")!.hasAttribute("open"), false);
  assert.equal(dom.querySelectorAll(".mc-step-more, .mc-step-time, .mc-process-timing").length, 0);
  assert.equal(dom.querySelectorAll("a[href]").length, 0);
});

test("failure followed by success retains failed attempt and existing aggregate failure", () => {
  const calls = fixture().slice(14, 16);
  calls[1].status = "complete";
  const dom = new JSDOM(htmlFor(projection.toThreadMessages(stateOf(calls)))).window.document;
  assert.equal(dom.querySelectorAll('.mc-step[data-state="failed"]').length, 1);
  assert.equal(dom.querySelectorAll('.mc-step[data-state="done"]').length, 1);
  assert.equal(dom.querySelector(".mc-process")!.getAttribute("data-status"), "failed");
});

test("mixed running and failure stays compact with independently visible failure access", () => {
  assert.equal(app.foldView(["running"], "streaming").open, false);
  assert.equal(app.foldView(["failed", "running"], "streaming").open, false);
  assert.equal(app.foldView(["failed"]).open, false);
});

test("cancelled tool status is preserved in the product projection", () => {
  const messages = projection.toThreadMessages(stateOf([item("msg-1", { lane: "process", kind: "tool_call", userReadable: true, status: "cancelled", data: { toolCallId: "cancelled-call" } })]));
  const content = messages[0].content as { type: string; data?: { status?: string }; providerMetadata?: unknown; isError?: boolean }[];
  assert.equal(content[0].data?.status, "cancelled");
  assert.deepEqual(content[1].providerMetadata, { core: { status: "cancelled" } });
  assert.equal(content[1].isError, false);
  assert.equal(app.stepState(undefined, { type: "complete" }, false), "done");
});

test("a failed native tool with no trusted group summary cannot be hidden by the default fold", () => {
  const html = htmlFor([{ id: "native-tool", role: "assistant", content: [{ type: "tool-call", toolCallId: "failure", toolName: "命令执行", args: {}, result: { content: "失败" }, isError: true }] }]);
  const dom = new JSDOM(html).window.document;
  assert.equal(dom.querySelector(".mc-process")!.hasAttribute("open"), false);
  assert.ok(dom.querySelector(".mc-process-failures"));
  assert.equal(dom.querySelectorAll('.mc-step[data-state="failed"]').length, 1);
});

test("1/10/50 independent calls keep current action and failures outside collapsed history", () => {
  for (const count of [1, 10, 50]) {
    const calls = Array.from({ length: count }, (_, index) => item(`msg-${index + 1}`, {
      lane: "process", kind: "tool_call", title: index === count - 1 ? "当前真实动作" : "历史动作", userReadable: true,
      status: index === count - 1 ? "streaming" : "failed", data: { toolCallId: `call-${index}` },
    }));
    const dom = new JSDOM(htmlFor(projection.toThreadMessages(stateOf(calls)))).window.document;
    assert.match(dom.querySelector(".mc-process-current")!.textContent!, /当前真实动作/);
    assert.equal(dom.querySelector(".mc-process-current")!.closest("details"), null);
    assert.equal(dom.querySelector(".mc-process")!.hasAttribute("open"), false);
    assert.equal(dom.querySelectorAll(".mc-process-history .mc-step").length, count);
    assert.equal(dom.querySelectorAll(".mc-process-failures").length, count > 1 ? 1 : 0);
  }
});
