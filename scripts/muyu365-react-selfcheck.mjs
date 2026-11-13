#!/usr/bin/env node
// MUYU-365 visual self-check: renders the React island's message rows + composer with mock data
// (react-dom/server, no network, no tokens) into one static HTML page styled by aurora.css + chat.css.
// Usage: node scripts/muyu365-react-selfcheck.mjs <out.html>   (then screenshot it with any headless browser)
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { JSDOM } from "jsdom";

// DOMPurify (markdown.ts) needs a DOM to sanitize under react-dom/server.
globalThis.window = new JSDOM("").window;

const out = process.argv[2] ?? "muyu365-selfcheck.html";
const vite = await createServer({ appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  // Mock (non-secret) runtime config, same fixture the unit tests use; nothing is fetched.
  const { runtimeFixture } = await vite.ssrLoadModule("/tests/fixtures/runtimeConfig.ts");
  const { loadRuntimeConfig } = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const config = runtimeFixture();
  await loadRuntimeConfig(config.VITE_CORE_WEB_URL, async () => new Response(JSON.stringify(config)));
  const { createElement: h } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const aui = await import("@assistant-ui/react");
  const { MessageRow, Welcome } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx");
  const { ThreadPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts");
  const reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");

  const at = (s) => `2026-11-13T06:00:${String(s).padStart(2, "0")}Z`;
  const item = (id, s, over) => ({ id, turnId: "t1", streamId: id, lane: "answer", role: "assistant", kind: "text", content: "", status: "complete", revision: 1, seq: s, timestamp: at(s), ...over });
  const proc = (id, s, title, content, over) => item(id, s, { lane: "process", kind: "status", title, content, userReadable: true, ...over });
  const tool = (id, s, title, content, over) => proc(id, s, title, content, { kind: "tool_call", ...over });
  const snapshot = (items, status) => reducer.reduceConversation(reducer.createConversationState("mock"), { type: "event.received", event: {
    protocolVersion: 2, type: "snapshot", conversationKey: "mock", eventId: "s", cursor: "c", turnId: "t1", streamId: "snapshot", lane: "system",
    revision: 0, seq: 0, timestamp: at(0), snapshot: { items, status, hasOlder: false, cursor: "c" } } });
  const user = (id, s, content, over) => item(id, s, { role: "user", content, ...over });
  // One mock page per state the brief asks for (no network: media cards stay in their "生成中" state).
  const SCENES = {
    "空态（新对话 + 建议卡）": { state: snapshot([], "idle"), suggestions: [
      { title: "写周报", label: "整理本周进展", prompt: "写周报：" }, { title: "翻译文档", label: "中英互译", prompt: "翻译文档：" },
      { title: "数据分析", label: "上传表格后提问", prompt: "数据分析：" } ] },
    "过程折叠 + 工具卡 + 附件": { state: snapshot([
      user("u1", 0, "帮我总结一下这份周报的要点", { attachments: [{ id: "f1", name: "周报-第46周.pdf", mimeType: "application/pdf", size: 182345 }] }),
      proc("p1", 1, "排队等待", "已进入执行队列"),
      proc("p2", 3, "Agent 初始化", "工作区已就绪"),
      tool("p3", 5, "联网搜索", "找到 2 条结果", { data: { toolCallId: "c1", toolDetails: { query: "assistant-ui ExternalStoreRuntime", sources: [{ title: "assistant-ui docs", url: "https://www.assistant-ui.com/docs" }] } } }),
      tool("p4", 8, "命令执行", "exit 1: timeout", { status: "failed", data: { toolCallId: "c2" } }),
      item("a1", 14, { kind: "result", content: "**本周要点**\n\n1. 发布了 `v2.3`，修复 12 个问题\n2. 新增 React 聊天岛（灰度中）\n\n| 项目 | 状态 |\n| --- | --- |\n| 附件预览 | 进行中 |", attachments: [{ id: "f2", name: "要点.md" }] }),
    ], "completed") },
    "流式中 + 排队": { state: snapshot([
      user("u1", 0, "继续写下周计划"),
      proc("p1", 1, "思考过程", "拆分为三个工作项", { status: "streaming" }),
      tool("p2", 2, "读取文件", "", { status: "streaming", data: { toolCallId: "c3" } }),
      item("a1", 3, { status: "streaming", content: "下周计划：\n\n1. 附件预览" }),
    ], "running"), queued: "再补一条：加上 E2E 测试" },
    "图片卡 + 错误": { state: snapshot([
      user("u1", 0, "画一只猫"),
      item("m1", 2, { content: "提示词：「一只猫」", data: { media: { kind: "image", taskId: 1 } } }),
      user("u2", 3, "再来一张"),
      item("e1", 4, { lane: "system", role: "system", status: "failed", content: "模型服务暂时不可用，请稍后重试" }),
    ], "failed") },
  };
  const dict = { "conversation.you": "你", "home.greeting": "NucleAgent", "common.copy": "复制", "chatReact.process": "执行过程", "common.send": "发送",
    "common.attachment": "附件", "chatReact.reload": "重新生成", "chatReact.stop": "停止", "chatReact.running": "进行中", "chatReact.done": "完成",
    "chatReact.failed": "失败", "chatReact.query": "查询", "chatReact.sources": "来源", "chatReact.mediaPending": "生成中…", "chatReact.mediaFailed": "生成失败",
    "chatReact.thinking": "正在思考…", "chatReact.greeting": "今天想完成什么？", "chatReact.queued": "待发送 1 条", "chatReact.toBottom": "回到底部" };
  const t = (k) => dict[k] ?? k;
  function Scene({ scene }) {
    const store = externalStore(scene.state, { send: async () => {}, stop: async () => {} }, { locale: "zh-CN", nowMs: Date.parse(at(30)) });
    const runtime = aui.useExternalStoreRuntime({ ...store, suggestions: scene.suggestions ?? [] });
    const running = scene.state.status === "running";
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(ThreadPrimitive.Root, { className: "mc-root" },
        h(ThreadPrimitive.Viewport, { className: "mc-viewport" },
          h(ThreadPrimitive.Empty, null, h(Welcome, { t })),
          h(ThreadPrimitive.Messages, null, ({ message }) => h(MessageRow, { role: message.role, t })),
          h("div", { className: "mc-footer" },
            h("div", { className: "mc-composer" },
              scene.queued && h("div", { className: "mc-queued" }, h("span", { className: "mc-queued-label" }, t("chatReact.queued")), h("span", { className: "mc-queued-text" }, scene.queued)),
              // shortcut: static textarea/buttons; the live composer primitives need browser events, the layout is the same classes.
              h("textarea", { className: "mc-input", rows: 2, placeholder: "追问或调整方向…" }),
              h("div", { className: "mc-toolbar" },
                h("button", { className: "mc-attach", type: "button" }, t("common.attachment")),
                h("div", { className: "mc-picker" }, h("select", { className: "mc-select" }, h("option", null, "默认模型"))),
                h("button", { className: running ? "mc-btn" : "mc-btn mc-btn--primary", type: "button" }, t("common.send")),
                running && h("button", { className: "mc-btn mc-btn--primary", type: "button" }, t("chatReact.stop"))))))));
  }
  const pages = Object.entries(SCENES).map(([title, scene]) =>
    `<section><h1 style="font:500 13px sans-serif;margin:8px 16px;color:#64748b">${title}</h1><div style="height:720px;border:1px solid #e2e8f0">${renderToStaticMarkup(h(Scene, { scene }))}</div></section>`).join("");
  const css = ["src/styles/aurora.css", "src/chat-react/chat.css"].map((f) => readFileSync(f, "utf8")).join("\n");
  writeFileSync(out, `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;height:100%}</style></head>` +
    `<body>${pages}</body></html>`);
  console.log(`wrote ${out}`);
} finally {
  await vite.close();
}
