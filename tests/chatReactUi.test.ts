import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { composerActions, moveFocus } from "../src/chat-react/composerState.ts";
import { effortView, sentEffort } from "../src/chat-react/requestEffort.ts";
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

test("effort capability states disable radio choices and suppress a remembered unsupported level", () => {
  for (const evidence of [undefined, { levels: [], effective: false, source: "catalog:unsupported" }]) {
    const view = effortView("codex", evidence);
    const html = renderToString(React.createElement(app.ModelControls, {
      t, value: sentEffort("high", view), view, onChange: () => {}, defaultOpen: "effort",
    }));
    assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
    assert.match(html, /aria-checked="true"/);
    assert.match(html, /chatReact.optionUnavailable/);
  }
});

test("model controls opens from an icon, exposes supported radio choices and leaves an extension slot", () => {
  const view = effortView("codex", { levels: ["low", "high"], effective: true, source: "fixture" });
  // exp104 D1A: the root page lists 「思考强度 · 值 ›」 (and the slot); the radios live on the effort page.
  const html = renderToString(React.createElement(app.ModelControls, {
    t, value: "high", view, onChange: () => {}, defaultOpen: true,
  }, React.createElement("button", null, "extension")));
  assert.match(html, /aria-label="chatReact.modelControls"/);
  assert.match(html, /aria-haspopup="menu" aria-expanded="true"/);
  assert.match(html, /data-testid="mc-ctl-effort"[^]*chatReact.effort<[^]*chatReact.effortHigh/);
  assert.match(html, /extension/);
  const page = renderToString(React.createElement(app.ModelControls, { t, value: "high", view, onChange: () => {}, defaultOpen: "effort" }));
  assert.equal((page.match(/role="menuitemradio"/g) ?? []).length, 4);
  assert.match(page, /aria-checked="true"[^>]*>.*chatReact.effortHigh/);
  assert.match(page, /disabled=""[^>]*>.*chatReact.effortMedium/);
  assert.doesNotMatch(html, /<select/);
});

test("every assistant response has an UNKNOWN usage area; user messages and raw token data cannot invent points", () => {
  const html = render(stateOf([
    item("user1", { role: "user", content: "one" }),
    item("answer1", { data: { usage: { points: 12, tokens: 9000 }, upstream: "untrusted" } }),
    item("user2", { role: "user", content: "two" }), item("answer2"),
  ]), () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.equal((html.match(/data-testid="mc-turn-usage"/g) ?? []).length, 2);
  assert.equal((html.match(/data-settlement="unknown"/g) ?? []).length, 2);
  assert.match(html, /—/);
  assert.doesNotMatch(html, /untrusted|9000/);
});

test("authorized thinking renders escaped inside a collapsed fold for live and restored messages", (context) => {
  const started = performance.now();
  for (const status of ["streaming", "complete"] as const) {
    const state = stateOf([
      item("user", { role: "user", content: "Question" }),
      item("thought", { lane: "process", userReadable: true, content: "Model <script>thinking</script>", status, data: { thinking: true, modelThinking: true } }),
      item("answer", { content: "Answer", status }),
    ], status === "streaming" ? "running" : "completed");
    const html = render(state, () => React.createElement(aui.ThreadPrimitive.Messages, null,
      ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
    const document = new JSDOM(html).window.document;
    const fold = document.querySelector("details.mc-reasoning");
    assert.ok(fold);
    assert.equal(fold.hasAttribute("open"), false);
    assert.equal(fold.querySelector("pre")?.textContent, "Model <script>thinking</script>");
    assert.equal(fold.querySelector("script"), null);
    assert.equal(fold.querySelector('[role="status"]'), null);
    assert.equal(document.querySelectorAll('.mc-process-current').length, status === 'streaming' ? 1 : 0);
    assert.match(html, /Answer/);
  }
  const html = render(stateOf([item("heartbeat", { lane: "process", userReadable: true, title: "Waiting", data: { thinking: true, thinkingStatus: true } })]),
    () => React.createElement(aui.ThreadPrimitive.Messages, null,
      ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.doesNotMatch(html, /mc-reasoning/);
  context.diagnostic(`thinking render body: ${(performance.now() - started).toFixed(2)} ms; shared fixture excluded`);
});

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
  assert.match(html, /data-testid="mc-model"[^>]*aria-haspopup="menu"/);  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.doesNotMatch(css, /\.mc-pill[^{]*\{[^}]*dashed/, "no dashed pills");
  assert.match(css, /\.mc-model-trigger\[aria-expanded="true"\] \{[^}]*border-color/, "open picker has an active state");
  assert.match(css, /\.mc-model-trigger\[aria-expanded="true"\] > svg \{ transform: rotate\(180deg\)/, "chevron flips");
  assert.match(css, /\.mc-hint \{[^}]*color: var\(--fg-secondary\)/, "hint contrast");
  assert.match(css, /\.mc-send:disabled \{[^}]*color: var\(--fg-secondary\)/, "disabled send icon visible");
});

test("composer: running with an empty input shows only the stop square", () => {
  const html = render(stateOf([item("u1", { role: "user" }), item("a1", { status: "streaming" })], "running"),
    () => React.createElement(app.Composer, { t, settings, placeholder: "p" }));
  assert.match(html, /data-testid="mc-stop"[^>]*aria-label="chatReact.stop"/);
  assert.doesNotMatch(html, /data-testid="mc-send"/);
});

test("model menu: typed image/video models are selectable in separate groups", () => {
  const model = { providerId: "p", model: "m1" };
  const groups = [
    { kind: "chat" as const, options: [{ value: "chat:p:m1", label: "m1", hint: "P", choice: { kind: "chat" as const, model } }, { value: "chat:p:m2", label: "m2", hint: "P", choice: { kind: "chat" as const, model: { providerId: "p", model: "m2" } } }] },
    { kind: "image" as const, options: [{ value: "image:p:i", label: "i", hint: "P", choice: { kind: "image" as const, model: { providerId: "p", model: "i" } } }] },
    { kind: "video" as const, options: [{ value: "video:p:v", label: "v", hint: "P", choice: { kind: "video" as const, model: { providerId: "p", model: "v" } } }] },
    { kind: "executor" as const, options: [{ value: "executor:x", label: "chatReact.executor", choice: { kind: "executor" as const, backend: "x" } }] },
  ];
  const props = { t, groups, value: "chat:p:m1", backend: "x", disabled: false, onPick: () => {} };
  const closed = renderToString(React.createElement(app.ModelMenu, props));
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /role="menu"[^>]*hidden=""/);
  assert.match(closed, /mc-model-name">m1</, "trigger shows the model, not the provider");
  const open = renderToString(React.createElement(app.ModelMenu, { ...props, defaultOpen: true }));
  assert.doesNotMatch(open, /role="menu"[^>]*hidden=""/);
  assert.deepEqual([...open.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]), ["chat", "image", "video", "executor"]);
  assert.match(open, /data-kind="chat"[^>]*><div class="mc-menu-label"[^>]*>model.types.chat<\/div><button[^>]*role="menuitemradio"[^>]*aria-checked="false"[^>]*><span class="mc-menu-text">common.modelDefault</);
  assert.match(open, /aria-checked="true"><span class="mc-menu-text">m1<span class="mc-menu-hint">P<\/span>/);
  assert.equal(open.match(/aria-checked="true"/g)?.length, 2, "current model and executor");
  assert.match(open, /data-kind="image"/);
  assert.match(open, /data-kind="video"/);
  assert.equal(open.slice(open.indexOf(`role="menu"`)).match(/>chatReact.executor</g)?.length, 1, "executor group title not repeated");
  const unpinned = renderToString(React.createElement(app.ModelMenu, { ...props, value: "", defaultOpen: true }));
  assert.match(unpinned, /aria-checked="true"><span class="mc-menu-text">common.modelDefault<\/span><svg/, "默认模型 checked when nothing is pinned");
  assert.match(unpinned, /mc-model-name">common.modelDefault</);
  assert.match(readFileSync("src/chat-react/chat.css", "utf8"), /\.mc-menu \{[^}]*max-height:[^}]*overflow-y: auto;/s, "panel scrolls");
});

test("media composer with the model's job tool sends normally and offers only its real parameters", () => {
  const media = { kind: "image" as const, model: { providerId: "p", model: "real-image" } };
  const direct = { toolId: 9, prompt: "input", schema: { invocation: { toolId: 9, revision: "4" }, inputSchema: { type: "object", additionalProperties: false,
    properties: { input: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "16:9"] }, note: { type: "string" } } } } };
  const html = render(stateOf([], "completed"), () => React.createElement(app.Composer, { t, settings: { ...settings, media, direct, params: { aspect_ratio: "16:9" } }, placeholder: "p" }));
  assert.doesNotMatch(html, /chatReact.mediaUnavailable/);
  assert.match(html, /real-image/);
  assert.equal(html.match(/<select/g)?.length, 1);
  assert.match(html, /aspect_ratio[\s\S]*16:9/);
  assert.doesNotMatch(html, /duration/);
  assert.match(html, /note<input/);
});

test("media composer blocks send and queue, identifies selected model, hides unsupported parameters", () => {
  const media = { kind: "video" as const, model: { providerId: "p", model: "real-video" } };
  for (const running of [false, true]) {
    const state = stateOf(running ? [item("active", { status: "streaming" })] : [], running ? "running" : "completed");
    const html = render(state, () => React.createElement(app.Composer, { t, settings: { ...settings, media }, placeholder: "p" }));
    assert.match(html, /chatReact.mediaUnavailable/);
    assert.match(html, /real-video/);
    assert.doesNotMatch(html, /<select/);
    if (!running) assert.match(html, /data-testid="mc-send"[^>]*disabled=""/);
  }
});

test("process row: neutral calls retain original failure and exclude synthetic queue rows", () => {
  const at = (sec: number) => `2026-11-13T00:00:0${sec}Z`;
  const state = stateOf([
    item("u1", { role: "user", content: "q", timestamp: at(0) }),
    item("p1", { lane: "process", title: "排队等待", userReadable: true, timestamp: at(1) }),
    item("p2", { lane: "process", kind: "tool_call", title: "命令执行", content: "exit 1", status: "failed", userReadable: true, timestamp: at(3), data: { toolCallId: "c2" } }),
    item("a1", { content: "答案", timestamp: at(8) }),
  ]);
  const html = render(state, () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.match(html, /<details class="mc-process" data-status="failed">/);
  assert.match(html, /<summary class="mc-process-head" aria-expanded="false"/);
  assert.doesNotMatch(html, /mc-process-alert|mc-process-dot|mc-process-failures|toolCalls.status.failed/);
  assert.doesNotMatch(html, /mc-step-more|mc-step-time|data-hide-done/);
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.match(css, /\.mc-process\[data-hide-done\] > \.mc-step\[data-state="done"\] \{ display: none; \}/);
  assert.doesNotMatch(css.slice(css.indexOf(".mc-process {"), css.indexOf(".mc-step-detail {")), /amber/, "one severity color");
  assert.doesNotMatch(html, /排队等待/);
  assert.match(html, /class="mc-step" data-state="failed".*命令执行.*chatReact.callRecord.*exit 1/s);
  assert.equal(app.stepState("streaming", { type: "complete" }), "running");
  assert.equal(app.stepState(undefined, { type: "running" }), "running");
  assert.equal(app.stepState("complete", { type: "complete" }, true), "failed");
  assert.equal(app.stepState("cancelled", { type: "complete" }), "cancelled");
});

test("process fold defaults collapsed for all intermediate statuses", () => {
  assert.deepEqual(app.foldView(["done", "done"], "complete"), { open: false, hideDone: false, done: 2 });
  assert.deepEqual(app.foldView(["done", "running"], "streaming"), { open: false, hideDone: false, done: 1 });
  assert.deepEqual(app.foldView(["done", "done", "done", "failed"], "failed"), { open: false, hideDone: false, done: 3 });
  assert.deepEqual(app.foldView(["failed"], "failed"), { open: false, hideDone: false, done: 0 });
  const html = render(stateOf([item("u1", { role: "user", content: "q" }), item("p1", { lane: "process", title: "排队", userReadable: true }), item("a1", { content: "答" })]),
    () => React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.match(html, /<details class="mc-process" data-status="complete"><summary class="mc-process-head" aria-expanded="false"/);
  assert.doesNotMatch(html, /mc-process-dot|mc-process-alert/);
});

test("hover action bar: under the bubble, real buttons (keyboard focusable, ≥28px via .mc-icon-btn), last reply marked", () => {
  const state = stateOf([item("msg-1", { role: "user", content: "q" }), item("msg-2", { content: "答案" })]);
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

test("code blocks: header (language + copy) and table wrapper added after sanitizing (idempotent, text-only); replies still cannot inject buttons", async () => {
  const { renderMarkdown } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/markdown.ts") as typeof import("../src/addons/conversation/task-conversation/markdown.ts");
  const doc = new JSDOM("").window.document;
  const box = doc.createElement("div");
  box.innerHTML = renderMarkdown("```js\nconst a = 1;\n```\n\n<button onclick=alert(1)>x</button>\n\n```\n<b>two</b>\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |");
  assert.equal(box.querySelectorAll("button").length, 0, "markdown.ts policy unchanged: no buttons from content");
  app.addCodeCopyButtons(box, "复制<img>");
  app.addCodeCopyButtons(box, "复制<img>");
  const heads = [...box.querySelectorAll(".mc-code-head")];
  assert.equal(heads.length, 2, "one header per block, not duplicated");
  assert.equal(heads[0].nextElementSibling?.tagName, "PRE");
  assert.equal(heads[0].querySelector(".mc-code-lang")?.textContent, "js");
  assert.equal(heads[1].querySelector(".mc-code-lang")?.textContent, "");
  assert.equal(heads[0].querySelector("button.mc-code-copy")?.textContent, "复制<img>");
  assert.equal(box.querySelectorAll("img").length, 0, "label is text, never HTML");
  assert.equal(heads[1].nextElementSibling?.querySelector("code")?.textContent, "<b>two</b>\n", "copied text = the code element only");
  assert.equal(box.querySelectorAll(".mc-table-wrap > table").length, 1, "table wrapped once");
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.match(css, /\.mc-md h2 \{ font-size: 18px; \}/);
  assert.match(css, /\.mc-md h3 \{ font-size: 16px; \}/);
  assert.match(css, /\.mc-md table \{[^}]*width: 100%;/s, "table fills the column");
});

test("single newlines in a reply render as <br> like OWUI (marked breaks: true); paragraphs and code blocks unchanged", async () => {
  const { renderMarkdown } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/markdown.ts") as typeof import("../src/addons/conversation/task-conversation/markdown.ts");
  assert.equal(renderMarkdown("第一行\n第二行"), "<p>第一行<br>\n第二行</p>\n");
  assert.equal(renderMarkdown("a\n\nb"), "<p>a</p>\n<p>b</p>\n");
  assert.equal(renderMarkdown("```\nx\ny\n```"), "<pre><code>x\ny\n</code></pre>\n");
});

test("file chips: kind by MIME then extension; verified → download button with size; unverified → status only", async () => {
  const { fileKind, toFileChip } = await vite.ssrLoadModule("/src/chat-react/attachments.ts") as typeof import("../src/chat-react/attachments.ts");
  assert.deepEqual(["a.PNG", "b.pdf", "c.docx", "d.csv", "e.ts", "f.zip", "g.mp4", "h.bin", "noext"].map((n) => fileKind(n)),
    ["image", "file", "file", "sheet", "file", "file", "file", "file", "file"]);
  assert.equal(fileKind("photo", "image/jpeg"), "image");
  assert.deepEqual(toFileChip({ id: "1", name: "r.pdf", size: 2048, metadata: { verification: "verified" } }), { id: "1", name: "r.pdf", size: 2048, verified: true });
  const ok = renderToString(React.createElement(app.FileChipView, { file: { id: "1", name: "周报.pdf", size: 182345, verified: true }, t }));
  assert.match(ok, /^<button type="button" class="mc-chip mc-chip--link" title="common.attachmentDownload 周报.pdf"/);
  assert.match(ok, /class="mc-chip-name">周报.pdf<.*class="mc-chip-meta">178.1 KB</s);
  assert.match(ok, /<svg/);
  const pending = renderToString(React.createElement(app.FileChipView, { file: { id: "2", name: "x.md", verified: false }, t }));
  assert.match(pending, /^<span class="mc-chip" data-verified="false"/);
  assert.doesNotMatch(pending, /<button/);
  assert.match(pending, /chatReact.attachmentPending/);
});

test("snapshot reconciliation marks attachments pending without asserting verification failure", async () => {
  const { toFileChip } = await vite.ssrLoadModule("/src/chat-react/attachments.ts") as typeof import("../src/chat-react/attachments.ts");
  const original = stateOf([item("user", { role: "user", attachments: [{ id: "file", name: "image.png", metadata: { verification: "verified" } }] })]);
  const pending = reducer.reduceConversation(original, { type: "connection.changed", status: "connecting" });
  const chip = toFileChip(pending.items.user!.attachments![0]!);
  assert.equal(chip.verified, false);
  const html = renderToString(React.createElement(app.FileChipView, { file: chip, t }));
  assert.match(html, /chatReact.attachmentPending/);
  assert.doesNotMatch(html, /attachmentVerificationFailed|<button/);
  assert.equal(toFileChip(original.items.user!.attachments![0]!).verified, true);
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

test("island strings: zh/en chunks have the same keys, mount picks the current language, ChatApp inlines neither", async () => {
  const { ZH_STRINGS: zh } = await vite.ssrLoadModule("/src/chat-react/islandStringsZh.ts") as typeof import("../src/chat-react/islandStringsZh.ts");
  const { EN_STRINGS: en } = await vite.ssrLoadModule("/src/chat-react/islandStringsEn.ts") as typeof import("../src/chat-react/islandStringsEn.ts");
  assert.equal(zh.process, "执行过程");
  assert.equal(en.process, "Process");
  assert.equal(zh.reload, "重新生成");
  assert.equal(en.reload, "Regenerate");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  const mount = readFileSync("src/chat-react/mount.tsx", "utf8");
  assert.match(mount, /locale === "en-US" \? import\("\.\/islandStringsEn"\)[^:]*: import\("\.\/islandStringsZh"\)/, "one chunk per language, zh default");
  assert.doesNotMatch(readFileSync("src/chat-react/ChatApp.tsx", "utf8"), /ZH_STRINGS|EN_STRINGS|stop: "停止"/, "strings are not inlined in the island");
  assert.match(readFileSync("src/addons/conversation/views/ChatHost.vue", "utf8"), /import\("@\/chat-react\/islandStringsEn"\) : import\("@\/chat-react\/islandStringsZh"\)/, "host prefetches the strings chunk with the island");
});

test("process timing is not repeated in the header; independent TTFT diagnostic and missing marker remain", () => {
  const at = (sec: number) => `2026-11-16T01:53:${String(sec).padStart(2, "0")}Z`;
  const st = { version: 2, first_body_write_ms: 2495, first_body_write_outcome: "written", agent_ready_ms: 789, attachments_prepared_ms: 547, run_return_ms: 3670 };
  const turn = (u: string, end: number, serverTiming: Record<string, unknown>) => [
    item(u, { role: "user", content: "q", timestamp: at(0), turnId: u }),
    item(`${u}q`, { lane: "process", title: "排队结束", userReadable: true, timestamp: at(0), turnId: u, data: { executionPhase: "execution_queue", phaseStatus: "completed", phaseDurationMs: 40 } }),
    item(`${u}a`, { kind: "result", content: "答", timestamp: at(end), turnId: u, data: { runTerminal: true, serverTiming } }),
  ];
  const html = render(stateOf(turn("u1", 4, st)), () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.doesNotMatch(html, /mc-process-timing/);
  assert.match(html, /<p class="mc-process-ttft" data-queue-ms="40" data-agent-ms="789" data-first-ms="2535" data-first-source="server">/);
  const failed = render(stateOf(turn("u2", 19, { ...st, first_body_write_ms: -1, first_body_write_outcome: "missing" })), () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t })));
  assert.doesNotMatch(failed, /mc-process-timing/);
  assert.match(failed, /<p class="mc-process-ttft" data-queue-ms="40" data-agent-ms="789">[^<]*chatReact.firstToken —</);
  assert.match(readFileSync("src/chat-react/chat.css", "utf8"), /\.mc-process-ttft \{[^}]*tabular-nums/);
});

test("effort radios preserve gates while showing short product language", () => {
  const html = (value: string, view: object) => renderToString(React.createElement(app.ModelControls, { t, value, view, onChange: () => {}, defaultOpen: "effort" }));
  const partial = html("low", { disabled: false, off: ["high"], note: "ineffective" });
  const document = new JSDOM(partial).window.document;
  const choices = document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
  assert.equal(choices[0].textContent, "chatReact.effortDefault");
  assert.equal(choices[1].getAttribute("aria-checked"), "true");
  assert.equal(choices[2].disabled, false);
  assert.equal(choices[3].disabled, true);
  assert.equal(choices[3].title, "chatReact.optionUnavailable");
  assert.doesNotMatch(partial, /chatReact.effortIneffective/);
  const other = html("", { disabled: true, off: ["low", "medium", "high"], note: "backend" });
  assert.equal((other.match(/disabled=""/g) ?? []).length, 4);
  assert.match(other, /chatReact.optionUnavailable/);
  assert.doesNotMatch(html("", { disabled: false, off: [], note: "unverified" }), /chatReact.effortUnverified/);
  assert.doesNotMatch(html("", { disabled: false, off: [], note: "effective" }), /chatReact.effortEffective/);
});

test("composer: selected effort stays by its control without engineering footnotes", () => {
  const base = { choice: "high" as const, set: () => {} };
  const on = render(stateOf([]), () => React.createElement(app.Composer, { t, settings, placeholder: "p",
    effort: { ...base, sent: "high", view: { disabled: false, off: [], note: "unverified" } } }));
  assert.doesNotMatch(on, /mc-effort-note|chatReact.effortUnverified/);
  assert.match(on, /data-testid="mc-effort-value">chatReact.effortHigh</);
  const off = render(stateOf([]), () => React.createElement(app.Composer, { t, settings, placeholder: "p",
    effort: { ...base, sent: "", view: { disabled: true, off: ["low", "medium", "high"], note: "backend" } } }));
  assert.doesNotMatch(off, /mc-effort-note/);
  assert.match(off, /aria-label="chatReact.modelControls"/);
});

test("composer: one Controls menu; another issue's content goes into its slot, never a second entry", () => {
  const html = render(stateOf([]), () => React.createElement(app.Composer, { t, settings, placeholder: "p",
    effort: { choice: "", set: () => {}, sent: "", view: { disabled: false, off: [], note: "effective" } },
    controls: React.createElement("button", { type: "button", role: "menuitemradio", "aria-checked": false }, "profile-slot") }));
  assert.equal((html.match(/class="mc-model mc-controls"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="chatReact.modelControls"/g) ?? []).length, 2, "one trigger + its one panel");
  assert.match(html, /role="menu" aria-label="chatReact.modelControls"[^]*profile-slot/);
  // Counted inside the Controls container only; the model menu beside it has its own radios. exp104: the closed
  // root page holds the effort row and the slot; the effort radios render only on their own page.
  assert.equal((html.split('class="mc-model mc-controls"')[1]!.match(/role="menuitemradio"/g) ?? []).length, 1);
  assert.match(html.split('class="mc-model mc-controls"')[1]!, /data-testid="mc-ctl-effort"/);
});

test("model controls handles opening, radio selection, arrows, Escape, Tab, outside click and disabled evidence", async () => {
  const document = window.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const selected: string[] = [];
  const draw = (view: ReturnType<typeof effortView>, slot?: React.ReactNode) => React.createElement(app.ModelControls, {
    t, value: "low", view, onChange: (value: string) => selected.push(value),
  }, slot);
  const key = async (target: Element, value: string) => {
    await React.act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true })));
  };
  try {
    await React.act(async () => root.render(draw(effortView("codex", { levels: ["low", "high"], effective: true, source: "fixture" }))));
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    const menu = container.querySelector<HTMLElement>("[role=menu]")!;
    assert.equal(menu.hidden, true);
    await React.act(async () => trigger.click());
    // exp104 D1A: the root row 「思考强度 ›」 opens the effort page; its radios then behave as before.
    const effortPage = async () => {
      const row = container.querySelector<HTMLButtonElement>("[data-testid=mc-ctl-effort]")!;
      assert.equal(document.activeElement, row, "focus lands on the first root row");
      await React.act(async () => row.click());
      return container.querySelectorAll<HTMLButtonElement>("[data-testid=mc-effort-page] [role=menuitemradio]");
    };
    let radios = await effortPage();
    assert.equal(document.activeElement, radios[1]);
    await key(radios[1], "ArrowDown");
    assert.equal(document.activeElement, radios[3]);
    await key(radios[3], "Home");
    assert.equal(document.activeElement, container.querySelector("[data-testid=mc-effort-page] [data-testid=mc-ctl-back]"), "Home reaches 返回 first");
    await key(document.activeElement!, "ArrowDown");
    assert.equal(document.activeElement, radios[0]);
    await key(radios[0], "End");
    assert.equal(document.activeElement, radios[3]);
    await React.act(async () => radios[3].click());
    assert.deepEqual(selected, ["high"]);
    await React.act(async () => radios[2].click());
    assert.deepEqual(selected, ["high"]);
    await key(radios[3], "Escape");
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, trigger);
    await key(trigger, "ArrowDown");
    assert.equal(menu.hidden, false);
    assert.equal(container.querySelector("[data-testid=mc-effort-page]"), null, "reopens on the root list (S4)");
    await key(document.activeElement!, "Tab");
    assert.equal(menu.hidden, true);
    await React.act(async () => trigger.click());
    await React.act(async () => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    assert.equal(menu.hidden, true);
    await React.act(async () => root.render(draw(effortView("codex", undefined))));
    await React.act(async () => trigger.click());
    assert.equal(menu.hidden, false);
    radios = await effortPage();
    for (const radio of radios) assert.equal(radio.disabled, true);
    await key(trigger, "Escape");
    assert.equal(menu.hidden, true);
    // Slot contract: content that uses menuitemradio joins the panel's roving focus and close keys.
    await React.act(async () => root.render(draw(effortView("codex", { levels: ["low", "high"], effective: true, source: "fixture" }),
      React.createElement("button", { type: "button", role: "menuitemradio", "aria-checked": false, tabIndex: -1, "data-testid": "slot" }, "slot"))));
    await React.act(async () => trigger.click());
    const slot = container.querySelector<HTMLButtonElement>("[data-testid=slot]")!;
    assert.equal(menu.contains(slot), true);
    await key(document.activeElement!, "End");
    assert.equal(document.activeElement, slot);
    await key(slot, "Home");
    assert.equal(document.activeElement, container.querySelector("[data-testid=mc-ctl-effort]"), "root rows and slot share one roving focus");
    await key(document.activeElement!, "End");
    await React.act(async () => slot.click());
    assert.deepEqual(selected, ["high"]);
    assert.equal(menu.hidden, false);
    await key(slot, "Escape");
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, trigger);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("model menu keeps its own keys beside Controls: arrows do not open it, Escape bubbles, Escape/Tab/pick refocus the trigger, outside click closes", async () => {
  const document = window.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const picked: unknown[] = [];
  const escapes: string[] = [];
  const heard = (event: Event) => { if ((event as KeyboardEvent).key === "Escape") escapes.push("body"); };
  document.body.addEventListener("keydown", heard);
  const option = (model: string) => ({ value: `chat:p:${model}`, label: model, choice: { kind: "chat" as const, model: { providerId: "p", model } } });
  const key = async (target: Element, value: string) => {
    await React.act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true })));
  };
  try {
    await React.act(async () => root.render(React.createElement(app.ModelMenu, { t, groups: [{ kind: "chat" as const, options: [option("m1"), option("m2")] }],
      value: "chat:p:m1", backend: null, disabled: false, onPick: (choice: unknown) => picked.push(choice) })));
    const trigger = container.querySelector<HTMLButtonElement>("[data-testid=mc-model]")!;
    const menu = container.querySelector<HTMLElement>("[role=menu]")!;
    await key(trigger, "ArrowDown");
    assert.equal(menu.hidden, true, "unlike Controls, arrows on the trigger do not open the model menu");
    await React.act(async () => trigger.click());
    const radios = container.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
    assert.equal(radios.length, 3);
    assert.equal(document.activeElement, radios[1], "opens on the checked model");
    await key(radios[1], "ArrowDown");
    await key(radios[2], "ArrowDown");
    assert.equal(document.activeElement, radios[0], "wraps");
    await key(radios[0], "End");
    assert.equal(document.activeElement, radios[2]);
    await key(radios[2], "Escape");
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, trigger);
    assert.deepEqual(escapes, ["body"], "the model menu does not swallow Escape");
    await React.act(async () => trigger.click());
    await key(radios[1], "Tab");
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, trigger);
    await React.act(async () => trigger.click());
    await React.act(async () => document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true })));
    assert.equal(menu.hidden, true);
    await React.act(async () => trigger.click());
    await React.act(async () => radios[2].click());
    assert.deepEqual(picked, [option("m2").choice]);
    assert.equal(menu.hidden, true);
    assert.equal(document.activeElement, trigger);
    await React.act(async () => trigger.click());
    await React.act(async () => radios[0].click());
    assert.deepEqual(picked, [option("m2").choice, null], "默认模型 picks null");
  } finally {
    await React.act(async () => root.unmount());
    document.body.removeEventListener("keydown", heard);
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("usage view renders late settled zero without any 上游 text, then UNKNOWN on revision and refresh", async () => {
  const { turnUsage } = await import("../src/chat-react/turnUsage.ts");
  const scope = { conversationId: "7", turnId: "one" };
  const receipt = { ...scope, state: "settled" as const, revision: 2, points: "0", upstreams: ["aihub-gateway", "everai-yunyi"] };
  const show = (usage: ReturnType<typeof turnUsage>) => renderToString(React.createElement(app.TurnUsage, { t, usage }));
  assert.match(show(turnUsage(scope)), /data-settlement="unknown"[^>]*>chatReact.points<!-- -->: <!-- -->—/);
  const settled = show(turnUsage(scope, [receipt]));
  assert.match(settled, /data-settlement="settled"/);
  assert.match(settled, /: <!-- -->0/);
  assert.doesNotMatch(settled, /aihub-gateway|everai-yunyi|chatReact\.upstream|上游/, "exp101: no upstream beside the points");
  const zhShow = renderToString(React.createElement(app.TurnUsage, { t: (key: string) => key === "chatReact.points" ? "积分" : key === "chatReact.upstream" ? "上游" : key, usage: turnUsage(scope, [receipt]) }));
  assert.doesNotMatch(zhShow, /上游/);
  assert.match(show(turnUsage(scope, [{ ...receipt, upstreams: [] }])), /data-settlement="settled"[^]*: <!-- -->0/, "settled without upstreams still shows its points");
  assert.equal(show(turnUsage(scope, JSON.parse(JSON.stringify([receipt])))), settled);
  assert.match(show(turnUsage({ ...scope, turnId: "two" }, [receipt])), /data-settlement="unknown"/);
  assert.match(show(turnUsage(scope, [receipt, { ...receipt, revision: 3, state: "unknown" }])), /data-settlement="unknown"/);
  const pending = show(turnUsage(scope, [{ ...receipt, revision: 1, state: "pending" }]));
  assert.match(pending, /data-settlement="pending"[^>]*title="chatReact.usagePending"/);
  assert.match(pending, /: <!-- -->—<!-- --> · <!-- -->chatReact.usagePending</);
  assert.doesNotMatch(pending, /aihub-gateway|: <!-- -->0/);
  assert.match(show(turnUsage(scope)), /title="chatReact.usageUnknown"/);
  assert.doesNotMatch(show(turnUsage(scope)), /usagePending/);
});

test("each reply binds its usage to its own step_id; message ids, other turns and other conversations stay UNKNOWN", () => {
  const rows = (conversationId: string) => render(stateOf([
    item("user1", { role: "user", content: "one" }), item("answer1", { data: { runStepId: "step-a", mainRun: true } }),
    item("user2", { role: "user", content: "two" }), item("answer2", { data: { runStepId: "step-b", mainRun: true } }),
    item("user3", { role: "user", content: "three" }), item("answer3"),
  ]), () => React.createElement(aui.ThreadPrimitive.Messages, null,
    ({ message }: { message: { role: string } }) => React.createElement(app.MessageRow, { role: message.role, t, conversationId, evidence: [
      { conversationId: "7", turnId: "step-a", state: "settled", points: "0", upstreams: ["aihub-gateway"], revision: 1 },
      { conversationId: "7", turnId: "answer2", state: "settled", points: "5", upstreams: ["everai-yunyi"], revision: 1 },
      { conversationId: "7", turnId: "", state: "settled", points: "7", upstreams: ["everai-yunyi"], revision: 1 },
    ] })));
  const html = rows("7");
  assert.equal((html.match(/data-settlement="settled"/g) ?? []).length, 1);
  assert.equal((html.match(/data-settlement="unknown"/g) ?? []).length, 2);
  assert.match(html, /answer1[^]*data-settlement="settled"[^>]*>chatReact.points<!-- -->: <!-- -->0[^]*answer2/);
  assert.doesNotMatch(html, /everai-yunyi|: <!-- -->[57]/);
  assert.equal((rows("8").match(/data-settlement="unknown"/g) ?? []).length, 3);
});

test("settlement reader: a late receipt replaces pending on re-read; superseded, failed or malformed reads never show; refresh restores", async () => {
  const { turnUsage } = await import("../src/chat-react/turnUsage.ts");
  const document = window.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  const scope = { conversationId: "7", turnId: "step-a" };
  const row = (over: object = {}) => ({ ...scope, state: "settled", points: "0", upstreams: ["aihub-gateway"], revision: 2, ...over });
  const reads: { id: string; signal: AbortSignal; resolve(rows: unknown): void; reject(error: Error): void }[] = [];
  const reader = (id: string, signal: AbortSignal) => new Promise<never>((resolve, reject) => reads.push({ id, signal, resolve: resolve as (rows: unknown) => void, reject }));
  function Probe({ tick, read }: { tick: number; read?: typeof reader }) {
    return React.createElement(app.TurnUsage, { t, usage: turnUsage(scope, app.useSettlement("7", read, tick)) });
  }
  const draw = (root: import("react-dom/client").Root, tick: number, withReader = true) =>
    React.act(async () => root.render(React.createElement(Probe, { tick, read: withReader ? reader : undefined })));
  const settle = (index: number, rows: unknown) => React.act(async () => reads[index]!.resolve(rows));
  const shown = () => container.querySelector("[data-testid=mc-turn-usage]")!;
  let root = createRoot(container);
  try {
    await draw(root, 0, false);
    assert.equal(reads.length, 0, "no reader, no read");
    assert.equal(shown().getAttribute("data-settlement"), "unknown");
    await draw(root, 0);
    assert.deepEqual(reads.map((read) => read.id), ["7"]);
    assert.equal(shown().getAttribute("data-settlement"), "unknown");
    await settle(0, [row({ state: "pending", revision: 1 })]);
    assert.equal(shown().getAttribute("data-settlement"), "pending");
    await draw(root, 1);
    await draw(root, 2);
    assert.equal(reads[1]!.signal.aborted, true, "a newer read cancels the older one");
    await settle(2, [row({ state: "pending", revision: 1 }), row()]);
    assert.equal(shown().getAttribute("data-settlement"), "settled");
    assert.equal(shown().textContent, "chatReact.points: 0");
    await settle(1, [row({ state: "pending", revision: 1 })]);
    assert.equal(shown().getAttribute("data-settlement"), "settled", "the superseded read is ignored");
    await draw(root, 3);
    await React.act(async () => reads[3]!.reject(new Error("offline")));
    assert.equal(shown().getAttribute("data-settlement"), "unknown", "a failed read drops the stale total");
    for (const [tick, malformed] of [[4, null], [5, [null, row({ upstreams: undefined, revision: 3 }), row()]]] as const) {
      await draw(root, tick);
      await settle(tick, malformed);
      assert.equal(shown().getAttribute("data-settlement"), "unknown");
    }
    await React.act(async () => root.unmount());
    assert.equal(reads[5]!.signal.aborted, true);
    root = createRoot(container);
    await draw(root, 0);
    await settle(6, JSON.parse(JSON.stringify([row()])));
    assert.equal(shown().textContent, "chatReact.points: 0");
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("settlement reader: a pending turn is re-read after a growing wait until its receipt lands, at most 6 times, never after leaving", async (context) => {
  const { turnUsage } = await import("../src/chat-react/turnUsage.ts");
  const document = window.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  const container = document.createElement("div");
  document.body.append(container);
  const { createRoot } = await import("react-dom/client");
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const row = (state: string, revision: number) => ({ conversationId: "7", turnId: "step-a", state, points: state === "settled" ? "4" : null, upstreams: ["alpha"], revision });
  let resolvers: ((rows: unknown) => void)[] = [];
  const reader = () => new Promise<never>((resolve) => resolvers.push(resolve as (rows: unknown) => void));
  const Probe = ({ id, expected = '' }: { id: string; expected?: string }) => React.createElement(app.TurnUsage, { t, usage: turnUsage({ conversationId: id, turnId: expected || "step-a" }, app.useSettlement(id, reader, undefined, expected)) });
  const settle = (rows: unknown) => React.act(async () => resolvers.at(-1)!(rows));
  const wait = (ms: number) => React.act(async () => context.mock.timers.tick(ms));
  const shown = () => container.querySelector("[data-testid=mc-turn-usage]")!.getAttribute("data-settlement");
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(Probe, { id: "7" })));
    await settle([row("pending", 1)]);
    await wait(2999);
    assert.equal(resolvers.length, 1);
    await wait(1);
    assert.equal(resolvers.length, 2, "first re-read after 3 s");
    await settle([row("pending", 2)]);
    await wait(5999);
    assert.equal(resolvers.length, 2, "the wait doubles");
    await wait(1);
    await settle([row("settled", 3)]);
    assert.equal(shown(), "settled");
    await wait(1e7);
    assert.equal(resolvers.length, 3, "a settled read stops the re-reads");

    // Leaving the conversation drops the scheduled re-read with it.
    await React.act(async () => root.render(React.createElement(Probe, { id: "8" })));
    await settle([{ ...row("pending", 1), conversationId: "8" }]);
    assert.equal(shown(), "pending");
    await React.act(async () => root.render(React.createElement(Probe, { id: "7" })));
    resolvers = [];
    await wait(1e7);
    assert.equal(resolvers.length, 0);

    // A receipt that never lands is asked for 6 more times, then left pending.
    await React.act(async () => root.render(React.createElement(Probe, { id: "9" })));
    for (let read = 1; read <= 7; read++) {
      assert.equal(resolvers.length, read);
      await settle([{ ...row("pending", read), conversationId: "9" }]);
      await wait(1e7);
    }
    assert.equal(resolvers.length, 7);
    assert.equal(shown(), "pending");
    await React.act(async () => root.render(React.createElement(Probe, { id: "7" })));
    await settle([row("pending", 1)]);
    await wait(3000);
    await React.act(async () => resolvers.at(-1)!(Promise.reject(new Error("offline"))));
    assert.equal(shown(), "unknown");
    await wait(6000);
    assert.equal(resolvers.length, 10);
    await settle([row("settled", 3)]);
    assert.equal(shown(), "settled");
    await wait(1e7);
    assert.equal(resolvers.length, 10);
    await React.act(async () => root.render(React.createElement(Probe, { id: "7", expected: "step-b" })));
    await settle([row("settled", 3)]);
    assert.equal(shown(), "unknown");
    await wait(3000);
    assert.equal(resolvers.length, 12, 'an older settled turn cannot stop polling for the current missing step');
    await settle([{ ...row("settled", 4), turnId: "step-b" }]);
    assert.equal(shown(), "settled");
    await wait(1e7);
    assert.equal(resolvers.length, 12);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(globalThis, "document");
  }
});

test("model menu: upstream tag beside the model and on the trigger title, only when known", () => {
  const chat = { kind: "chat" as const, options: [
    { value: "chat:1:a", label: "a", hint: "P", upstream: "AIHub", choice: { kind: "chat" as const, model: { providerId: 1, model: "a" } } },
    { value: "chat:1:d", label: "d", hint: "P", choice: { kind: "chat" as const, model: { providerId: 1, model: "d" } } },
  ] };
  const open = renderToString(React.createElement(app.ModelMenu, { t, groups: [chat], value: "chat:1:a", backend: null, disabled: false, onPick: () => {}, defaultOpen: true }));
  assert.match(open, /<span class="mc-menu-text">a<span class="mc-menu-hint">P<\/span><\/span><span class="mc-menu-tag" data-testid="mc-upstream">AIHub<\/span>/);
  assert.equal(open.match(/data-testid="mc-upstream"/g)?.length, 1, "no tag when the catalog has no upstream");
  assert.match(open, /data-testid="mc-model"[^>]*title="chatReact.pickerLabel · chatReact.upstream: AIHub"/);
  assert.match(open, /aria-label="chatReact.pickerLabel · a · P · AIHub"/);
  assert.doesNotMatch(open, /mc-model-upstream/);
  const unknown = renderToString(React.createElement(app.ModelMenu, { t, groups: [chat], value: "chat:1:d", backend: null, disabled: false, onPick: () => {} }));
  assert.match(unknown, /data-testid="mc-model"[^>]*title="chatReact.pickerLabel"/);
  assert.doesNotMatch(unknown, /mc-model-upstream/);
});

test("model menu (MUYU-418): unavailable models are greyed with the reason, vision is tagged, unprobed is said", () => {
  const opt = (model: string, over: Record<string, unknown>) => ({ value: `chat:1:${model}`, label: model, hint: "P", choice: { kind: "chat" as const, model: { providerId: 1, model } }, ...over });
  const chat = { kind: "chat" as const, options: [
    opt("see", { vision: "supported" }), opt("blind", { vision: "unsupported" }), opt("maybe", { vision: "unverified", unprobed: true }),
    opt("down", { vision: "supported", unavailable: "capacity" }),
  ] };
  let picked: unknown = "none";
  const open = renderToString(React.createElement(app.ModelMenu, { t, groups: [chat], value: "chat:1:see", backend: null, disabled: false, onPick: (c: unknown) => { picked = c; }, defaultOpen: true }));
  const row = (model: string) => open.match(new RegExp(`<button[^>]*role="menuitemradio"[^>]*>(?:(?!</button>).)*?mc-menu-text">${model}<.*?</button>`))?.[0] ?? "";
  assert.match(row("see"), /data-testid="mc-vision"[^>]*data-vision="supported"[^>]*>chatReact.visionSupported</);
  assert.match(row("blind"), /data-vision="unsupported"[^>]*>chatReact.visionUnsupported</);
  assert.match(row("maybe"), /data-vision="unverified"[^>]*>chatReact.visionUnverified</);
  assert.match(row("maybe"), /data-testid="mc-unprobed"[^>]*>chatReact.availabilityUnprobed</);
  assert.match(row("down"), /aria-disabled="true"/);
  assert.match(row("down"), /title="chatReact.unavailable_capacity"/);
  assert.match(row("down"), /data-testid="mc-unavailable"[^>]*>chatReact.unavailable_capacity</);
  assert.doesNotMatch(row("see"), /aria-disabled/);
  assert.equal(picked, "none");
});

test("model menu (MUYU-418): with an image attached, models that cannot read images are blocked in the selector", () => {
  const opt = (model: string, vision: string) => ({ value: `chat:1:${model}`, label: model, hint: "P", vision, choice: { kind: "chat" as const, model: { providerId: 1, model } } });
  const chat = { kind: "chat" as const, options: [opt("see", "supported"), opt("blind", "unsupported"), opt("maybe", "unverified")] };
  const open = renderToString(React.createElement(app.ModelMenu, { t, groups: [chat], value: "chat:1:see", backend: null, disabled: false, onPick: () => {}, defaultOpen: true, hasImage: true }));
  const row = (model: string) => open.match(new RegExp(`<button[^>]*role="menuitemradio"[^>]*>(?:(?!</button>).)*?mc-menu-text">${model}<.*?</button>`))?.[0] ?? "";
  assert.match(row("blind"), /aria-disabled="true"/);
  assert.match(row("blind"), /title="chatReact.visionBlocked"/);
  assert.doesNotMatch(row("see"), /aria-disabled/);
  assert.doesNotMatch(row("maybe"), /aria-disabled/, "unverified is warned at send, not hidden");
  const noImage = renderToString(React.createElement(app.ModelMenu, { t, groups: [chat], value: "chat:1:see", backend: null, disabled: false, onPick: () => {}, defaultOpen: true }));
  assert.doesNotMatch(noImage, /aria-disabled/);
});
