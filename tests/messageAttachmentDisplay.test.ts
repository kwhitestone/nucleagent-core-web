import assert from "node:assert/strict";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { after, before, test } from "node:test";

import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h, type Component } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import DOMPurify from "dompurify";

let vite: ViteDevServer;
let MessageItem: Component;
let AttachmentChips: Component;
let http: any;
let createConversationAdapter: (key: () => string) => any;
let toMessageAttachment: (attachment: any) => any;
let unregisterPlatform: () => void;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  await initializeRuntimeFixture(vite);
  ({ default: MessageItem } = await vite.ssrLoadModule(
    "/src/addons/conversation/components/conversation/MessageItem.vue",
  ));
  ({ default: AttachmentChips } = await vite.ssrLoadModule(
    "/src/addons/conversation/components/AttachmentChips.vue",
  ));
  ({ default: http } = await vite.ssrLoadModule("/src/addons/platform-api/api/http.ts"));
  const { platformRuntime } = await vite.ssrLoadModule("/src/addons/platform-api/runtime.ts");
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregisterPlatform = registerPlatformRuntime(platformRuntime);
  ({ createConversationAdapter } = await vite.ssrLoadModule(
    "/src/addons/conversation/composables/useConversationAdapter.ts",
  ));
  ({ toMessageAttachment } = await vite.ssrLoadModule(
    "/src/addons/conversation/components/attachmentPresentation.ts",
  ));
});

after(async () => {
  unregisterPlatform();
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
});

function installI18n(app: ReturnType<typeof createSSRApp>): void {
  app.use(
    createI18n({
      legacy: false,
      locale: "zh-CN",
      messages: {
        "zh-CN": {
          conversation: { you: "You" },
          home: { greeting: "NucleAgent" },
          common: {
            attachmentDownloadFailed: "附件下载失败",
            attachmentRemove: "移除附件",
            attachmentPreview: "预览 {name}",
            attachmentPreviewLoading: "正在加载图片预览",
            attachmentPreviewFailed: "图片预览加载失败",
            attachmentDownload: "下载",
            attachmentVerificationFailed: "附件状态核验失败",
            attachmentVerificationRetry: "重试核验",
            close: "关闭",
          },
        },
      },
    }),
  );
}

test("snapshot attachment metadata renders in the user message", async () => {
  const row = {
    id: 1,
    conversationId: 358,
    senderType: "user",
    senderName: "user",
    msgType: "text",
    content: "这是什么？",
    metadata: {
      attachments: [
        {
          fileId: "image-file",
          name: "界面截图.jpg",
          mimeType: "image/jpeg",
          size: 1536,
          kind: "image",
          verification: "verified",
        },
        {
          fileId: "file-1",
          name: "产品说明.pdf",
          mimeType: "application/pdf",
          size: 2048,
          kind: "pdf",
          verification: "verified",
        },
      ],
    },
    createdAt: "2026-08-29T23:28:35+08:00",
  };
  http.defaults.adapter = async (config: any) => ({
    config,
    data: { code: 0, data: [row] },
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "358").loadSnapshot({
    conversationKey: "358",
    signal: new AbortController().signal,
  });
  assert.deepEqual(snapshot.items[0].attachments, [
    {
      id: "image-file",
      name: "界面截图.jpg",
      mimeType: "image/jpeg",
      size: 1536,
      metadata: { kind: "image", verification: "verified" },
    },
    {
      id: "file-1",
      name: "产品说明.pdf",
      mimeType: "application/pdf",
      size: 2048,
      metadata: { kind: "pdf", verification: "verified" },
    },
  ]);
  // Keep SSR on the plain-text branch; DOMPurify is browser-only. Attachments
  // are a sibling of the content renderer, so this does not bypass their path.
  const item = { ...snapshot.items[0], status: "pending" };

  const app = createSSRApp({
    render: () => h(MessageItem, { item, role: "user" }),
  });
  installI18n(app);

  const html = await renderToString(app);
  assert.match(html, /class="image-attachment"/);
  assert.match(html, /class="image-attachment-thumb"/);
  assert.match(html, /data-attachment-id="image-file"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /class="image-attachment-remove"/);
  assert.equal((html.match(/class="attachment-chip"/g) ?? []).length, 1);
  assert.match(html, /界面截图\.jpg/);
  assert.match(html, /产品说明\.pdf/);
  assert.match(html, /2\.0 KB/);
});

test("assistant MessageItem leaves attachment rendering to its artifact list", async () => {
  const item = {
    id: "msg-2",
    turnId: "main",
    streamId: "msg-2",
    lane: "answer",
    role: "assistant",
    kind: "text",
    content: "结果",
    status: "pending",
    revision: 1,
    seq: 1,
    attachments: [
      {
        id: "file-2",
        name: "result.pdf",
        mimeType: "application/pdf",
        size: 2048,
        metadata: { kind: "pdf" },
      },
    ],
  } as const;
  const app = createSSRApp({
    render: () => h(MessageItem, { item, role: "assistant" }),
  });
  installI18n(app);

  const html = await renderToString(app);
  assert.doesNotMatch(html, /class="attachment-chip"/);
});

test("generated assistant attachments survive the API snapshot mapping", async () => {
  http.defaults.adapter = async (config: any) => ({
    config,
    data: {
      code: 0,
      data: [
        {
          id: 2,
          conversationId: 387,
          senderType: "agent",
          senderName: "agent",
          msgType: "result",
          content: "文档已生成",
          metadata: {
            attachments: [
              {
                fileId: "generated-docx",
                name: "福建三城天气.docx",
                mimeType:
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size: 2124,
                kind: "file",
                verification: "verified",
              },
            ],
          },
          createdAt: "2026-08-31T16:06:35+08:00",
        },
      ],
    },
    headers: {},
    status: 200,
    statusText: "OK",
  });

  const snapshot = await createConversationAdapter(() => "387").loadSnapshot({
    conversationKey: "387",
    signal: new AbortController().signal,
  });
  assert.deepEqual(snapshot.items[0].attachments, [
    {
      id: "generated-docx",
      name: "福建三城天气.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 2124,
      metadata: { kind: "file", verification: "verified" },
    },
  ]);

  const app = createSSRApp({
    render: () =>
      h(AttachmentChips, {
        attachments: [toMessageAttachment(snapshot.items[0].attachments![0])],
      }),
  });
  installI18n(app);
  const html = await renderToString(app);
  assert.match(html, /class="attachment-chip"/);
  assert.match(html, /class="att-name"/);
  assert.match(html, /title="福建三城天气\.docx"/);
});

test("removable composer images keep preview, download, and remove controls", async () => {
  const attachments = [
    {
      fileId: "pending-image",
      name: "待发送截图.jpg",
      mimeType: "image/jpeg",
      size: 4096,
      kind: "image",
    },
    {
      fileId: "pending-pdf",
      name: "待发送文档.pdf",
      mimeType: "application/pdf",
      size: 2048,
      kind: "pdf",
    },
  ];
  const app = createSSRApp({
    render: () => h(AttachmentChips, { attachments, removable: true }),
  });
  installI18n(app);

  const html = await renderToString(app);
  assert.match(html, /class="image-attachment removable"/);
  assert.match(html, /data-attachment-id="pending-image"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /class="image-attachment-remove"/);
  assert.equal((html.match(/class="image-attachment removable"/g) ?? []).length, 1);
  assert.equal((html.match(/class="image-attachment-remove"/g) ?? []).length, 1);
  assert.equal((html.match(/class="attachment-chip"/g) ?? []).length, 1);
  assert.equal((html.match(/class="att-remove"/g) ?? []).length, 1);
  assert.match(html, /待发送截图\.jpg/);
  assert.match(html, /待发送文档\.pdf/);
});

test("unknown history attachments have no preview or download and expose retry", async () => {
  const attachments = [
    { fileId: "unknown-image", name: "image.png", kind: "image", verification: "unavailable" },
    { fileId: "unknown-file", name: "file.pdf", verification: "unavailable" },
  ];
  const app = createSSRApp({ render: () => h(AttachmentChips, { attachments }) });
  installI18n(app);
  const html = await renderToString(app);
  assert.doesNotMatch(html, /image-attachment-thumb|aria-haspopup="dialog"|class="att-name"/);
  assert.equal((html.match(/data-attachment-verification="unavailable"/g) ?? []).length, 2);
  assert.equal((html.match(/class="att-retry"/g) ?? []).length, 2);
  assert.match(html, /image\.png/);
  assert.match(html, /file\.pdf/);
});

test("attachment verification survives both presentation mappings", async () => {
  http.defaults.adapter = async (config: any) => ({
    config, data: { code: 0, data: [{
      id: 90, conversationId: 90, senderType: "agent", senderName: "agent", msgType: "result",
      content: "unchanged", createdAt: "2026-10-11T00:00:00Z",
      metadata: { attachments: [{ fileId: "unknown", name: "file.pdf", verification: "unavailable" }] },
    }] }, headers: {}, status: 200, statusText: "OK",
  });
  const snapshot = await createConversationAdapter(() => "90").loadSnapshot({
    conversationKey: "90", signal: new AbortController().signal,
  });
  assert.equal(snapshot.items[0].attachments[0].metadata.verification, "unavailable");
  assert.equal(toMessageAttachment(snapshot.items[0].attachments[0]).verification, "unavailable");
  assert.equal(snapshot.items[0].content, "unchanged");
});

test("UI-IMPL-3: media messages without errorCode still form a valid snapshot", async () => {
  const { parseConversationSnapshot } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/core/schema.ts");
  http.defaults.adapter = async (config: any) => ({
    config,
    data: /\/messages$/.test(config.url) ? { code: 0, data: [
      { id: 1, conversationId: 518, senderType: "user", senderName: "user", msgType: "text", content: "橘猫",
        metadata: { media: { kind: "image", aspect: "1:1", count: 1, taskIds: [3] } }, createdAt: "2026-10-13T12:08:40Z" },
      { id: 2, conversationId: 518, senderType: "agent", senderName: "media", msgType: "result", content: "图片已生成",
        metadata: { media: { kind: "image", taskId: 3, batch: 1, index: 1 }, step_id: "media-3" }, createdAt: "2026-10-13T12:08:50Z" },
    ] } : { code: 0, data: { id: 518, mode: "a2a", status: "completed", createdAt: "2026-10-13T12:08:40Z", updatedAt: "2026-10-13T12:08:40Z" } },
    headers: {}, status: 200, statusText: "OK",
  });
  const snapshot = await createConversationAdapter(() => "518").loadSnapshot({
    conversationKey: "518", signal: new AbortController().signal,
  });
  const parsed = parseConversationSnapshot(snapshot);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.items[0].data?.media, { kind: "image", aspect: "1:1", count: 1, taskIds: [3] });
  assert.equal("errorCode" in (parsed.items[1].data ?? {}), false);
});

test("persisted895: verified generic image delivery preserves failed steps in the actual component", async () => {
  // Sanitized retained message13236: no prompt, command, account or provider claim.
  const step = "fe3426a9-1d87-477a-9834-97e9c1b80676";
  const rows = [
    { id: 13109, conversationId: 895, senderType: "user", msgType: "text", content: "Request",
      createdAt: "2026-11-09T17:00:00Z" },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: 13118 + index, conversationId: 895, senderType: "tool", msgType: "tool_call", content: "Step failed",
      metadata: { step_id: step, tool_call_id: `failed-${index}`, tool_status: "failed", duration_ms: 1000 },
      createdAt: "2026-11-09T17:01:00Z",
    })),
    { id: 13236, conversationId: 895, senderType: "agent", msgType: "result", content: "Result",
      metadata: { step_id: step, attachments: [{
        fileId: "0942c578-c671-4f8d-ae78-d746d357384a", name: "attachment.png",
        mimeType: "image/png", kind: "image", size: 386415, verification: "verified",
      }] }, createdAt: "2026-11-09T18:18:39.529Z" },
  ];
  http.defaults.adapter = async (config: any) => ({
    config, data: { code: 0, data: /\/messages$/.test(config.url) ? rows.map(row => ({ ...row, senderName: row.senderType })) :
      { id: 895, status: "completed", createdAt: rows[0].createdAt, updatedAt: rows.at(-1)!.createdAt } },
    headers: {}, status: 200, statusText: "OK",
  });
  const adapter = createConversationAdapter(() => "895");
  const { default: TaskConversation } = await vite.ssrLoadModule(
    "/src/addons/conversation/task-conversation/vue/TaskConversation.vue");
  let controller: any;
  const errors: Error[] = [];
  const component = { ...TaskConversation, async setup(props: any, context: any) {
    const bindings = TaskConversation.setup(props, context);
    controller = bindings.controller;
    await controller.initialize();
    assert.deepEqual(errors, []);
    return bindings;
  } };
  const app = createSSRApp(component, { conversationKey: "895", adapter, onError: (error: Error) => { errors.push(error); } });
  installI18n(app);
  const originalSanitize = DOMPurify.sanitize;
  // SSR has no browser DOM; this fixture contains only plain text, not Markdown/HTML.
  DOMPurify.sanitize = ((text: string) => text.replace(/<[^>]*>/g, "")) as typeof DOMPurify.sanitize;
  try {
    const html = await renderToString(app);
    assert.match(html, /attachment\.png/);
    assert.match(html, /12 个步骤/);
    assert.equal(Object.values(controller.state.value.items).filter((item: any) => item.status === "failed").length, 12);
    assert.deepEqual({
      IMAGEDELIVEREDVISIBLE: /已交付图片/.test(html),
      FAILEDCOUNTPRESERVED: /12 个步骤失败/.test(html),
    }, { IMAGEDELIVEREDVISIBLE: true, FAILEDCOUNTPRESERVED: true });
    assert.doesNotMatch(html, /图片已生成|Image generated/);
  } finally { controller?.dispose(); DOMPurify.sanitize = originalSanitize; }
});
