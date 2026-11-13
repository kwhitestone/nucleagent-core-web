import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
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

test("process row: failed step → amber header with alert icon; expanded rows carry state icon, name, tool tag, duration", () => {
  const at = (sec: number) => `2026-11-13T00:00:0${sec}Z`;
  const state = stateOf([
    item("u1", { role: "user", content: "q", timestamp: at(0) }),
    item("p1", { lane: "process", title: "排队等待", userReadable: true, timestamp: at(1) }),
    item("p2", { lane: "process", kind: "tool_call", title: "命令执行", content: "exit 1", status: "failed", userReadable: true, timestamp: at(3), data: { toolCallId: "c2" } }),
    item("a1", { content: "答案", timestamp: at(8) }),
  ]);
  const html = render(state, () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.match(html, /class="mc-process-head" data-status="failed"/);
  assert.match(html, /class="mc-process-alert"/);
  assert.match(html, /mc-process-dot/);
  assert.match(html, /class="mc-step" data-state="done".*排队等待.*class="mc-step-time">2.0s</s);
  assert.match(html, /class="mc-step" data-state="failed".*命令执行.*chatReact.tool.*chatReact.failed.*class="mc-step-time">5.0s<.*exit 1/s);
  assert.equal(app.stepState("streaming", { type: "complete" }), "running");
  assert.equal(app.stepState(undefined, { type: "running" }), "running");
  assert.equal(app.stepState("complete", { type: "complete" }, true), "failed");
  assert.equal(app.stepState("cancelled", { type: "complete" }), "cancelled");
});

test("hover action bar: under the bubble, real buttons (keyboard focusable, ≥28px via .mc-icon-btn), last reply marked", () => {
  const state = stateOf([item("u1", { role: "user", content: "q" }), item("a1", { content: "答案" })]);
  const html = render(state, () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  const assistant = html.slice(html.indexOf('data-message-role="assistant"'));
  assert.match(assistant, /class="mc-bubble".*class="mc-actions"/s, "action bar comes after the bubble");
  assert.match(assistant, /<button type="button" class="mc-icon-btn" aria-label="common.copy" title="common.copy"/);
  assert.match(assistant, /<button[^>]*class="mc-icon-btn"[^>]*aria-label="chatReact.reload"/);
  assert.doesNotMatch(assistant, /tabindex="-1"/, "no action is taken out of the tab order");
  assert.match(html, /data-message-role="assistant"[^>]*data-last="true"/);
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.match(css, /\.mc-msg:focus-within \.mc-actions/, "keyboard focus reveals the bar");
  assert.match(css, /\.mc-icon-btn \{[^}]*width: 32px;[^}]*height: 32px;/s);
});

test("code blocks: copy buttons are added after sanitizing (idempotent, text-only); replies still cannot inject buttons", async () => {
  const { renderMarkdown } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/markdown.ts") as typeof import("../src/addons/conversation/task-conversation/markdown.ts");
  const doc = new JSDOM("").window.document;
  const box = doc.createElement("div");
  box.innerHTML = renderMarkdown("```js\nconst a = 1;\n```\n\n<button onclick=alert(1)>x</button>\n\n```\n<b>two</b>\n```");
  assert.equal(box.querySelectorAll("button").length, 0, "markdown.ts policy unchanged: no buttons from content");
  app.addCodeCopyButtons(box, "复制<img>");
  app.addCodeCopyButtons(box, "复制<img>");
  const buttons = [...box.querySelectorAll("pre > button.mc-code-copy")];
  assert.equal(buttons.length, 2, "one per block, not duplicated");
  assert.equal(buttons[0].textContent, "复制<img>");
  assert.equal(box.querySelectorAll("img").length, 0, "label is text, never HTML");
  assert.equal(box.querySelectorAll("pre code")[1].textContent, "<b>two</b>\n", "copied text = the code element only");
});

test("file chips: kind by MIME then extension; verified → download button with size; unverified → status only", async () => {
  const { fileKind, toFileChip } = await vite.ssrLoadModule("/src/chat-react/attachments.ts") as typeof import("../src/chat-react/attachments.ts");
  assert.deepEqual(["a.PNG", "b.pdf", "c.docx", "d.csv", "e.ts", "f.zip", "g.mp4", "h.bin", "noext"].map((n) => fileKind(n)),
    ["image", "pdf", "doc", "sheet", "code", "archive", "media", "file", "file"]);
  assert.equal(fileKind("photo", "image/jpeg"), "image");
  assert.deepEqual(toFileChip({ id: "1", name: "r.pdf", size: 2048, metadata: { verification: "verified" } }), { id: "1", name: "r.pdf", size: 2048, verified: true });
  const ok = renderToString(React.createElement(app.FileChipView, { file: { id: "1", name: "周报.pdf", size: 182345, verified: true }, t }));
  assert.match(ok, /^<button type="button" class="mc-chip mc-chip--link" title="common.attachmentDownload 周报.pdf"/);
  assert.match(ok, /class="mc-chip-name">周报.pdf<.*class="mc-chip-meta">178.1 KB</s);
  assert.match(ok, /<svg/);
  const pending = renderToString(React.createElement(app.FileChipView, { file: { id: "2", name: "x.md", verified: false }, t }));
  assert.match(pending, /^<span class="mc-chip" data-verified="false"/);
  assert.doesNotMatch(pending, /<button/);
  assert.match(pending, /common.attachmentVerificationFailed/);
});

test("layout: the shell-button mock lives only in the selfcheck; product CSS keeps a fixed top band and a 520px layout", () => {
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  const tsx = readFileSync("src/chat-react/ChatApp.tsx", "utf8");
  for (const src of [css, tsx]) assert.doesNotMatch(src, /壳按钮模拟/);
  assert.doesNotMatch(tsx, /成果/, "no shell-button text in the island DOM");
  assert.match(readFileSync("scripts/muyu365-react-selfcheck.mjs", "utf8"), /◇ 成果/);
  assert.match(css, /\.mc-viewport \{[^}]*margin-top: 60px;/s, "band below the shell trigger (18 + 36 px)");
  assert.match(css, /@media \(max-width: 520px\)/);
});
