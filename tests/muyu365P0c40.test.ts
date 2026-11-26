import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import type { ConversationItem } from "../src/addons/conversation/task-conversation/core/types.ts";

// MUYU-365 p0c40 v2 (user 2026-11-26 11:0x): (1) the picker lists only 快速（低） / 深度思考（高）; Core's off/default rows
// and any page-made 默认 are not shown; a disabled row says Core's reason in plain words on its own line; a saved off/default
// highlights nothing. (2) the attach entry follows the catalog vision status. (3) no 「responses · 低」 tag under a reply;
// the turn's tier is one 思考强度 line inside 执行过程 from Core's metadata.thinkingLevel (missing = no line), and a turn
// with a tier but no thinking text says 该模型未返回思考内容.
let vite: ViteDevServer;
let dom: JSDOM;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let Profile: typeof import("../src/chat-react/ProfileControls.tsx").default;
let zh: Record<string, string>;
let aui: typeof import("@assistant-ui/react");
let externalStore: typeof import("../src/chat-react/externalStore.ts").externalStore;
let reducer: typeof import("../src/addons/conversation/task-conversation/core/reducer.ts");
let Viewport: import("react").ElementType;

before(async () => {
  dom = new JSDOM("<div id='root'></div>", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: (run: () => void) => setTimeout(run, 0), cancelAnimationFrame: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  aui = await import("@assistant-ui/react");
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  Profile = (await vite.ssrLoadModule("/src/chat-react/ProfileControls.tsx")).default;
  zh = (await vite.ssrLoadModule("/src/chat-react/islandStringsZh.ts")).ZH_STRINGS as Record<string, string>;
  ({ externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts") as { externalStore: typeof externalStore });
  reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts") as typeof reducer;
  Viewport = (await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts")).ThreadPrimitive.Viewport;
});
after(async () => { await vite?.close(); });

const t = (key: string) => zh[key.replace(/^chatReact\./, "")] ?? key;

// Real Core v0.1.111 PROD rows (p0c32-418/raw-final-PROD.json), one per executor kind.
const reasonOff = "没有这个模型可用的显式关闭参数（该协议不支持所选思考档位）；省略参数不等于关闭，所以不开放";
const codex = [
  { id: "off", displayName: "关闭思考", params: { reasoningEffort: "none" }, enabled: false, reason: reasonOff, thinkingLevel: "off", status: "unverified" },
  { id: "quick", displayName: "快速（低）", params: { reasoningEffort: "low" }, enabled: true, thinkingLevel: "low", nativeParam: "reasoning.effort=low", status: "supported" },
  { id: "thinking", displayName: "深度思考（高）", params: { reasoningEffort: "high" }, enabled: true, thinkingLevel: "high", nativeParam: "reasoning.effort=high", status: "supported" },
];
const cc = "该执行器（claude-code）此档发送的原生参数与这个模型的原厂声明不一致或未核实，不开放；核实并实测后开放";
const claudeCode = ["off", "quick", "thinking"].map((id, i) => ({ id, displayName: ["关闭思考", "快速（低）", "深度思考（高）"][i], params: { reasoningEffort: ["none", "low", "high"][i] },
  enabled: false, reason: cc, thinkingLevel: ["off", "low", "high"][i], status: "unverified" }));
const gem = "gemini-cli 0.58 的 ACP 会话没有逐轮思考档位入口，所以没有逐轮可用的原生参数";
const geminiCli = claudeCode.map((row) => ({ ...row, reason: gem, status: "unsupported" }));

async function picker(rows: unknown[], selected = "") {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  const picked: string[] = [];
  const page = React.createElement(Profile, { t, rows: rows as never, selected, saving: false, rolledBack: false, error: false, onChange: (id: string) => picked.push(id), onRetry: () => {} });
  await React.act(async () => root.render(React.createElement(app.ModelControls as never, { t, defaultOpen: true, profile: { page } })));
  const radios = [...container.querySelectorAll<HTMLButtonElement>("[data-testid=mc-profile-page] [role=menuitemradio]")];
  return { container, radios, picked, names: radios.map((r) => r.querySelector(".mc-menu-text")!.textContent), close: () => React.act(async () => root.unmount()) };
}

test("RED p0c40-1: every executor lists only 快速（低） / 深度思考（高), never 默认 or 关闭, Core's reason on its own line", async () => {
  const withDefault = [{ id: "default", displayName: "默认", enabled: true }, ...codex];
  for (const rows of [codex, claudeCode, geminiCli, withDefault]) {
    const v = await picker(rows);
    try {
      assert.deepEqual(v.names, ["快速（低）", "深度思考（高）"]);
      const tiers = rows.filter((row) => row.id === "quick" || row.id === "thinking");
      assert.deepEqual(v.radios.map((r) => r.disabled), tiers.map((row) => !row.enabled));
      tiers.forEach((row, i) => {
        const why = v.radios[i]!.querySelector("[data-testid=mc-preset-reason]")?.textContent ?? "";
        if (row.enabled) assert.equal(why, "");
        else assert.equal(why, row.reason, `row ${row.id} says Core's reason verbatim`);
      });
      assert.doesNotMatch(v.container.textContent!, /默认|关闭/);
      assert.doesNotMatch(v.container.innerHTML, /nativeParam|reasoning\.effort|reasoningEffort|thinkingLevel|unverified|unsupported/);
    } finally { await v.close(); }
  }
});

test("RED p0c40-1: a saved off/default highlights nothing and is not replaced; choosing saves Core's id", async () => {
  for (const saved of ["off", "default", ""]) {
    const v = await picker(codex, saved);
    try {
      assert.equal(v.radios.filter((r) => r.getAttribute("aria-checked") === "true").length, 0, saved);
      assert.deepEqual(v.picked, []);
      await React.act(async () => v.radios[1]!.click());
      assert.deepEqual(v.picked, ["thinking"]);
    } finally { await v.close(); }
  }
});

const composerSettings = (state: string) => ({ groups: [], model: { providerId: 1, model: "m" }, backend: "codex", busy: false, pick: async () => {},
  imageGate: { state, block: state === "unsupported", model: "m", alternatives: [] } });

async function composer(gate: string, send: (text: string, files: unknown[]) => Promise<void> = async () => {}) {
  const { storageAttachmentAdapter } = await vite.ssrLoadModule("/src/chat-react/attachments.ts");
  const adapter = storageAttachmentAdapter(() => {}, async (file: File) => ({ fileId: `f-${file.name}`, name: file.name, mimeType: file.type, size: 3 }));
  const state = reducer.createConversationState("7");
  let current = gate;
  let api: { composer(): { addAttachment(file: File): Promise<void>; setText(text: string): void; send(): void; getState(): { text: string; attachments: readonly unknown[] } } } | undefined;
  function Grab() { api = aui.useAui() as never; return null; }
  function Harness() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: (text, files) => send(text, files as unknown[]), stop: async () => {} }, undefined, adapter));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null,
      React.createElement(Grab), React.createElement(app.Composer, { t, placeholder: "p", settings: composerSettings(current) as never })));
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const draw = () => React.act(async () => root.render(React.createElement(Harness)));
  await draw();
  const attach = () => container.querySelector<HTMLButtonElement>("[data-testid=mc-attach]")!;
  return { container, attach, api: () => api!.composer(), switchTo: async (next: string) => { current = next; await draw(); },
    close: async () => { await React.act(async () => root.unmount()); container.remove(); } };
}

test("RED p0c40-2: the attach entry follows the vision status (supported plain, unverified allowed with 该模型暂未验证识图, unsupported disabled with the reason)", async () => {
  for (const [state, disabled, says] of [["supported", false, ""], ["unverified", false, "该模型暂未验证识图"], ["unsupported", true, zh.visionBlocked]] as const) {
    const v = await composer(state);
    try {
      assert.equal(v.attach().disabled, disabled, state);
      const note = v.attach().querySelector(".mc-menu-sub")?.textContent ?? "";
      if (says) assert.ok(note.includes(says), `${state}: ${note}`);
      else assert.equal(note, "");
    } finally { await v.close(); }
  }
});

test("RED p0c40-2: switching model keeps the draft and the chosen image; an unverified model still sends the image ref", async () => {
  const sent: unknown[] = [];
  const v = await composer("supported", async (text, files) => { sent.push([text, files]); });
  try {
    await React.act(async () => { await v.api().addAttachment(new window.File(["png"], "cat.png", { type: "image/png" }) as never); });
    await React.act(async () => { v.api().setText("这张图里有什么"); });
    for (const next of ["unsupported", "unverified"]) {
      await v.switchTo(next);
      assert.equal(v.api().getState().text, "这张图里有什么", `${next}: draft kept`);
      assert.equal(v.api().getState().attachments.length, 1, `${next}: image kept`);
    }
    assert.match(v.container.querySelector("[data-testid=mc-image-hint]")!.textContent!, /该模型暂未验证识图/);
    await React.act(async () => { v.api().send(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.deepEqual(sent, [["这张图里有什么", [{ id: "f-cat.png", name: "cat.png", mimeType: "image/png" }]]]);
  } finally { await v.close(); }
});

const item = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, turnId: "main", streamId: id, lane: "answer", role: "assistant", kind: "result", content: id, status: "complete", revision: 1, seq: 1,
  timestamp: "2026-11-26T02:00:10Z", data: { runStepId: "step-9", mainRun: true }, ...over,
});
const thought = item("msg-12", { lane: "process", userReadable: true, content: "先拆题，再算", data: { runStepId: "step-9", mainRun: true, modelThinking: true } });

async function thread(items: ConversationItem[], id = "88") {
  const state = reducer.reduceConversation(reducer.createConversationState(id), { type: "event.received",
    event: { protocolVersion: 2, type: "snapshot", conversationKey: id, eventId: "s", cursor: "c", turnId: "main", streamId: "snapshot", lane: "system", revision: 0, seq: 0,
      timestamp: "2026-11-26T02:00:00Z", snapshot: { items, status: "completed", hasOlder: false, cursor: "c" } } });
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }));
    return React.createElement(aui.AssistantRuntimeProvider, { runtime }, React.createElement(Viewport, null,
      React.createElement(aui.ThreadPrimitive.Messages, null, ({ message }: { message: { role: string } }) =>
        React.createElement(app.MessageRow, { role: message.role, t: t as never, conversationId: id, evidence: [], selection: true } as never))));
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(App)));
  const text = container.textContent ?? "", html = container.innerHTML;
  const process = [...container.querySelectorAll(".mc-process:not(.mc-reasoning)")].map((el) => el.textContent).join("|");
  await React.act(async () => root.unmount());
  container.remove();
  return { text, html, process, fold: text.includes(zh.reasoning) };
}

test("RED p0c40-3: Core's metadata.thinkingLevel reaches the row data (low/medium/high only); missing or junk = none", async () => {
  const { messageTimingData } = await vite.ssrLoadModule("/src/addons/conversation/composables/conversationTiming.ts");
  const msg = (metadata: unknown) => ({ senderType: "agent", senderName: "agent", msgType: "result", content: "x", metadata });
  assert.equal(messageTimingData(msg({ thinkingLevel: "high" })).thinkingLevel, "high");
  for (const junk of [undefined, "", "off", "default", "xhigh<script>", 3]) assert.equal(messageTimingData(msg({ thinkingLevel: junk })).thinkingLevel, undefined, String(junk));
});

test("RED p0c40-3: the tier is one 思考强度 line inside 执行过程; no tier no line; tier without thinking text says so; never a protocol tag", async () => {
  const user = item("msg-10", { role: "user", kind: "text", content: "1+1", timestamp: "2026-11-26T02:00:05Z", data: {} });
  const tier = (level: string) => item("msg-11", { data: { runStepId: "step-9", mainRun: true, thinkingLevel: level } });
  const low = await thread([user, thought, tier("low")]);
  assert.ok(low.process.includes("思考强度：低"), low.process);
  assert.equal(low.fold, true);
  assert.equal(low.text.includes("该模型未返回思考内容"), false);
  const high = await thread([user, tier("high")]);
  assert.ok(high.process.includes("思考强度：高"), high.process);
  assert.ok(high.process.includes("该模型未返回思考内容"));
  const none = await thread([user, item("msg-11")]);
  assert.equal(none.text.includes("思考强度"), false);
  assert.equal(none.text.includes("该模型未返回思考内容"), false);
  for (const view of [low, high, none]) assert.doesNotMatch(view.html, /responses|mc-effective-selection/);
});
