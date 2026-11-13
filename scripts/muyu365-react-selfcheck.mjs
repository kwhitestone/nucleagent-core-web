#!/usr/bin/env node
// MUYU-365 visual self-check: renders the React island (real MessageRow + Composer + Welcome) with mock
// data (react-dom/server, no network, no tokens) into one static HTML page per scene, styled by
// aurora.css + chat.css. Usage: node scripts/muyu365-react-selfcheck.mjs <outDir>
// Then screenshot each <scene>.html (e.g. Chrome --headless=new --window-size=1100,755; *-520 at 520 wide).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { JSDOM } from "jsdom";

// DOMPurify (markdown.ts) needs a DOM to sanitize under react-dom/server.
globalThis.window = new JSDOM("").window;

const outDir = process.argv[2] ?? "muyu365-selfcheck";
mkdirSync(outDir, { recursive: true });
const vite = await createServer({ appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
try {
  // Mock (non-secret) runtime config, same fixture the unit tests use; nothing is fetched.
  const { runtimeFixture } = await vite.ssrLoadModule("/tests/fixtures/runtimeConfig.ts");
  const { loadRuntimeConfig } = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const config = runtimeFixture();
  await loadRuntimeConfig(config.VITE_CORE_WEB_URL, async () => new Response(JSON.stringify(config)));
  const { createElement: h, useMemo } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const aui = await import("@assistant-ui/react");
  const { MessageRow, Welcome, Composer } = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx");
  const { ThreadPrimitive } = await vite.ssrLoadModule("/src/chat-react/auiPrimitives.ts");
  const { externalStore } = await vite.ssrLoadModule("/src/chat-react/externalStore.ts");
  const { createSingleSlot } = await vite.ssrLoadModule("/src/chat-react/singleSlotQueue.ts");
  const reducer = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/reducer.ts");

  const at = (s) => `2026-11-13T06:00:${String(s).padStart(2, "0")}Z`;
  const item = (id, s, over) => ({ id, turnId: "t1", streamId: id, lane: "answer", role: "assistant", kind: "text", content: "", status: "complete", revision: 1, seq: s, timestamp: at(s), ...over });
  const proc = (id, s, title, content, over) => item(id, s, { lane: "process", kind: "status", title, content, userReadable: true, ...over });
  const tool = (id, s, title, content, over) => proc(id, s, title, content, { kind: "tool_call", ...over });
  const user = (id, s, content, over) => item(id, s, { role: "user", content, ...over });
  const snapshot = (items, status) => reducer.reduceConversation(reducer.createConversationState("mock"), { type: "event.received", event: {
    protocolVersion: 2, type: "snapshot", conversationKey: "mock", eventId: "s", cursor: "c", turnId: "t1", streamId: "snapshot", lane: "system",
    revision: 0, seq: 0, timestamp: at(0), snapshot: { items, status, hasOlder: false, cursor: "c" } } });
  const verified = { verification: "verified" };
  const MD = "## 本周要点\n\n1. 发布了 `v2.3`，修复 12 个问题\n2. 新增 React 聊天岛（灰度中）\n   - 输入区重做\n   - 执行过程逐步展示\n\n" +
    "| 项目 | 状态 | 负责人 |\n| --- | --- | --- |\n| 附件预览 | 进行中 | 前端组 |\n| 执行过程 | 已完成 | 前端组 |\n\n" +
    "> 下周优先处理附件预览。\n\n```ts\nexport const ready = (n: number) => n > 0;\n```\n\n详见 [发布说明](https://example.com/notes)。";
  const PROCESS = [
    proc("p1", 1, "排队等待", "已进入执行队列"),
    proc("p2", 3, "Agent 初始化", "工作区已就绪"),
    tool("p3", 5, "联网搜索", "找到 2 条结果", { data: { toolCallId: "c1", toolDetails: { query: "assistant-ui ExternalStoreRuntime", sources: [{ title: "assistant-ui docs", url: "https://www.assistant-ui.com/docs" }] } } }),
    tool("p4", 8, "命令执行", "exit 1: timeout after 30s", { status: "failed", data: { toolCallId: "c2" } }),
  ];
  const GROUPS = [
    { kind: "chat", options: ["deepseek-v3", "qwen-max"].map((m) => ({ value: `chat:p:${m}`, label: `示例供应商 · ${m}`, choice: { kind: "chat", model: { providerId: "p", model: m } } })) },
    { kind: "image", options: [{ value: "image:p:img-1", label: "示例供应商 · img-1", choice: { kind: "image", model: { providerId: "p", model: "img-1" } } }] },
    { kind: "video", options: [{ value: "video:p:vid-1", label: "示例供应商 · vid-1", choice: { kind: "video", model: { providerId: "p", model: "vid-1" } } }] },
    { kind: "executor", options: [{ value: "executor:muyu", label: "目鱼执行器", choice: { kind: "executor", backend: "muyu" } }] },
  ];
  const settings = { groups: GROUPS, model: { providerId: "p", model: "deepseek-v3" }, backend: "muyu", busy: false, pick: async () => {} };
  const conversation = snapshot([
    user("u1", 0, "帮我总结一下这份周报的要点", { attachments: [{ id: "f1", name: "周报-第46周.pdf", mimeType: "application/pdf", size: 182345, metadata: verified }] }),
    ...PROCESS,
    item("a1", 14, { kind: "result", content: MD, attachments: [{ id: "f2", name: "本周要点-整理稿.md", size: 2310, metadata: verified }, { id: "f3", name: "数据.xlsx", size: 48211, metadata: verified }] }),
  ], "completed");
  const running = snapshot([
    user("u1", 0, "继续写下周计划"),
    proc("p1", 1, "思考过程", "拆分为三个工作项"),
    tool("p2", 2, "读取文件", "", { status: "streaming", data: { toolCallId: "c3" } }),
    item("a1", 3, { status: "streaming", content: "下周计划：\n\n1. 附件预览" }),
  ], "running");

  // One page per screenshot. `open` = expand the 执行过程 folds; `menu` = open the model menu; `text` = composer draft.
  const SCENES = {
    "empty-suggestions": { state: snapshot([], "idle"), newChat: true, suggestions: [
      { title: "写周报", label: "整理本周进展", prompt: "写周报：" }, { title: "翻译文档", label: "中英互译", prompt: "翻译文档：" },
      { title: "数据分析", label: "上传表格后提问", prompt: "数据分析：" }, { title: "竞品调研", label: "联网检索并对比", prompt: "竞品调研：" } ] },
    "conversation-top-1100": { state: conversation, scroll: "top" },
    "conversation-top-760": { state: conversation, scroll: "top", width: 760 },
    "conversation-markdown": { state: conversation, height: 1000 },
    "process-expanded-failed": { state: conversation, open: true, scroll: "process" },
    "streaming-running": { state: running, open: true },
    "streaming-queued": { state: running, queued: "再补一条：加上 E2E 测试" },
    "composer-typed": { state: conversation, text: "把表格改成按负责人分组，\n并补一列截止日期" },
    "composer-model-menu": { state: conversation, menu: true },
    "media-error": { height: 1000, state: snapshot([
      user("u1", 0, "画一只猫"),
      item("m1", 2, { content: "提示词：「一只在窗台上晒太阳的橘猫」", data: { media: { kind: "image", taskId: 1 } } }),
      item("m2", 2, { content: "提示词：「猫跳舞」", data: { media: { kind: "video", taskId: 2 } } }),
      user("u2", 3, "再来一张"),
      item("e1", 4, { lane: "system", role: "system", status: "failed", content: "模型服务暂时不可用，请稍后重试" }),
    ], "failed") },
    "narrow-520": { state: conversation, width: 520 },
    "narrow-520-empty": { state: snapshot([], "idle"), newChat: true, width: 520, suggestions: [
      { title: "写周报", label: "整理本周进展", prompt: "写周报：" }, { title: "翻译文档", label: "中英互译", prompt: "翻译文档：" } ] },
  };
  const dict = { "conversation.you": "你", "home.greeting": "NucleAgent", "common.copy": "复制", "common.copied": "已复制", "common.send": "发送",
    "common.modelDefault": "默认模型", "common.attachmentDownload": "下载", "common.attachmentRemove": "移除附件", "common.attachmentUploading": "上传中...",
    "common.attachmentVerificationFailed": "核验失败，附件待核验", "conversation.inputPlaceholder": "继续输入，追问或调整方向...",
    "model.types.chat": "聊天", "model.types.image": "生图", "model.types.video": "生视频" };
  // The island's own strings (ChatApp STRINGS) for zh-CN, same lookup as withIslandStrings.
  const island = (await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx")).ISLAND_STRINGS["zh-CN"];
  const t = (k) => dict[k] ?? (k.startsWith("chatReact.") ? island[k.slice(10)] : undefined) ?? k;

  function Prefill({ text }) {
    const api = aui.useAui();
    // shortcut: SSR has no effects, so the draft is set during render; selfcheck only.
    useMemo(() => { if (text) api.composer().setText(text); }, [api, text]);
    return null;
  }
  function Scene({ scene }) {
    const slot = scene.queued ? createSingleSlot(async () => {}, () => true, () => {}) : undefined;
    slot?.hold({ role: "user", content: [{ type: "text", text: scene.queued }], attachments: [] });
    const store = externalStore(scene.state, { send: async () => {}, stop: async () => {} }, { locale: "zh-CN", nowMs: Date.parse(at(30)) }, undefined, slot);
    const runtime = aui.useExternalStoreRuntime({ ...store, suggestions: scene.suggestions ?? [] });
    return h(aui.AssistantRuntimeProvider, { runtime },
      h(Prefill, { text: scene.text }),
      h(ThreadPrimitive.Root, { className: "mc-root" },
        h(ThreadPrimitive.Viewport, { className: "mc-viewport" },
          h(ThreadPrimitive.Empty, null, h(Welcome, { t })),
          h(ThreadPrimitive.Messages, null, ({ message }) => h(MessageRow, { role: message.role, t })),
          h(ThreadPrimitive.ViewportFooter, { className: "mc-footer" },
            h(Composer, { t, settings, placeholder: scene.newChat ? t("chatReact.newPlaceholder") : t("conversation.inputPlaceholder") })))));
  }
  // Selfcheck-only mock of the shell's floating 「◇ 成果」 trigger (nucleagent-web CoreRemoteHost.vue: top 18px / right 22px,
  // about 120×36): inline-styled here, never in chat.css or the island DOM.
  const SHELL_BUTTON = `<div style="position:fixed;top:18px;right:22px;width:120px;height:36px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:999px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgb(15 23 42/8%);font:500 14px sans-serif;color:#3b4fc4">◇ 成果</div>`;
  const css = ["src/styles/aurora.css", "src/chat-react/chat.css"].map((f) => readFileSync(f, "utf8")).join("\n");
  for (const [name, scene] of Object.entries(SCENES)) {
    const hooks = [
      scene.open && "document.querySelectorAll('details.mc-process').forEach(d=>d.open=true);",
      // react-textarea-autosize runs only with JS in a live page; size the static draft the same way (≤ 8 rows).
      scene.text && "const ta=document.querySelector('.mc-input');ta.rows=Math.min(8,ta.value.split('\\n').length);",
      scene.menu && "const m=document.querySelector('[data-testid=mc-model-menu]');m.hidden=false;document.querySelector('[data-testid=mc-model]').setAttribute('aria-expanded','true');",
      // Default: the end of the thread, like the live viewport; `scroll` = top, or the first 执行过程 fold.
      scene.scroll === "top" ? "" : scene.scroll === "process"
        ? "const v=document.querySelector('.mc-viewport');v.scrollTop=document.querySelector('details.mc-process').offsetTop-v.offsetTop-70;"
        : "const v=document.querySelector('.mc-viewport');v.scrollTop=v.scrollHeight;",
    ].filter(Boolean).join("");
    writeFileSync(join(outDir, `${name}.html`), `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;height:100%}</style></head>` +
      `<body>${renderToStaticMarkup(h(Scene, { scene }))}${SHELL_BUTTON}<script>${hooks}</script></body></html>`);
  }
  writeFileSync(join(outDir, "scenes.json"), JSON.stringify(Object.fromEntries(Object.entries(SCENES).map(([k, s]) => [k, `${s.width ?? 1100},${s.height ?? 755}`]))));
  console.log(`wrote ${Object.keys(SCENES).length} scenes to ${outDir}`);
} finally {
  await vite.close();
}
