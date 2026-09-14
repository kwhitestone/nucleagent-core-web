import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h, type Component } from "vue";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

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
        },
        {
          fileId: "file-1",
          name: "产品说明.pdf",
          mimeType: "application/pdf",
          size: 2048,
          kind: "pdf",
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
      metadata: { kind: "image" },
    },
    {
      id: "file-1",
      name: "产品说明.pdf",
      mimeType: "application/pdf",
      size: 2048,
      metadata: { kind: "pdf" },
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
      metadata: { kind: "file" },
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
