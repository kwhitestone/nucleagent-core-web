#!/usr/bin/env node
// MUYU-365 visual self-check: renders the React island's message rows + composer with mock data
// (react-dom/server, no network, no tokens) into one static HTML page styled by aurora.css + chat.css.
// Usage: node scripts/muyu365-react-selfcheck.mjs <out.html>   (then screenshot it with any headless browser)
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";

const out = process.argv[2] ?? "muyu365-selfcheck.html";
const vite = await createServer({ appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  // Mock (non-secret) runtime config, same fixture the unit tests use; nothing is fetched.
  const { runtimeFixture } = await vite.ssrLoadModule("/tests/fixtures/runtimeConfig.ts");
  const { loadRuntimeConfig } = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const config = runtimeFixture();
  await loadRuntimeConfig(config.VITE_CORE_WEB_URL, async () => new Response(JSON.stringify(config)));
  // DOMPurify needs a DOM; the mock content below is fixed and trusted, so pass it through for this page only.
  const DOMPurify = (await import("dompurify")).default;
  DOMPurify.sanitize = (html) => String(html);
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const aui = await import("@assistant-ui/react");
  const { MessageRow } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx");
  const { ThreadPrimitive, ComposerPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts");
  const reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");

  const at = (s) => `2026-11-13T06:00:${String(s).padStart(2, "0")}Z`;
  const item = (id, s, over) => ({ id, turnId: "t1", streamId: id, lane: "answer", role: "assistant", kind: "text", content: "", status: "complete", revision: 1, seq: s, timestamp: at(s), ...over });
  const items = [
    item("u1", 0, { role: "user", content: "帮我总结一下这份周报的要点", attachments: [{ id: "f1", name: "周报-第46周.pdf", mimeType: "application/pdf", size: 182345 }] }),
    item("p1", 1, { lane: "process", kind: "status", title: "排队等待", content: "已进入执行队列", userReadable: true }),
    item("p2", 3, { lane: "process", kind: "status", title: "Agent 初始化", content: "工作区已就绪", userReadable: true }),
    item("p3", 6, { lane: "process", kind: "status", title: "思考过程", content: "读取附件并提取三个主题", userReadable: true }),
    item("a1", 14, { kind: "result", content: "**本周要点**\n\n1. 发布了 `v2.3`，修复 12 个问题\n2. 新增 React 聊天岛（灰度中）\n3. 下周计划：附件预览与 E2E" }),
  ];
  const state = reducer.reduceConversation(reducer.createConversationState("mock"), { type: "event.received", event: {
    protocolVersion: 2, type: "snapshot", conversationKey: "mock", eventId: "s", cursor: "c", turnId: "t1", streamId: "snapshot", lane: "system",
    revision: 0, seq: 0, timestamp: at(0), snapshot: { items, status: "completed", hasOlder: false, cursor: "c" } } });
  const dict = { "conversation.you": "你", "home.greeting": "NucleAgent", "common.copy": "复制", "chatReact.process": "执行过程", "common.send": "发送", "common.attachment": "附件" };
  const t = (k) => dict[k] ?? k;
  function App() {
    const runtime = aui.useExternalStoreRuntime(externalStore(state, { send: async () => {}, stop: async () => {} }, { locale: "zh-CN", nowMs: Date.parse(at(30)) }));
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(ThreadPrimitive.Root, { className: "mc-root" },
        h(ThreadPrimitive.Viewport, { className: "mc-viewport" },
          h(ThreadPrimitive.Messages, null, ({ message }) => h(MessageRow, { role: message.role, t }))),
        h(ComposerPrimitive.Root, { className: "mc-composer" },
          // shortcut: plain textarea; ComposerPrimitive.Input needs the Viewport scroll store, which this SSR page does not get.
          h("textarea", { className: "mc-input", rows: 2, placeholder: "追问或调整方向…" }),
          h("div", { className: "mc-toolbar" },
            h("button", { className: "mc-attach", type: "button" }, t("common.attachment")),
            h("div", { className: "mc-picker" }, h("select", { className: "mc-select" }, h("option", null, "默认模型"))),
            h("button", { className: "mc-btn mc-btn--primary", type: "button" }, t("common.send"))))));
  }
  const css = ["src/styles/aurora.css", "src/chat-react/chat.css"].map((f) => readFileSync(f, "utf8")).join("\n");
  writeFileSync(out, `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;height:100%}</style></head>` +
    `<body><div style="height:100vh">${renderToStaticMarkup(h(App))}</div></body></html>`);
  console.log(`wrote ${out}`);
} finally {
  await vite.close();
}
