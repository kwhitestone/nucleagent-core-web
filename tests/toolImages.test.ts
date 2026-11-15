import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import MarkdownIt from "markdown-it";
import { renderToString } from "@vue/server-renderer";
import { createSSRApp, h, type Component } from "vue";
import { createServer, type ViteDevServer } from "vite";
import DOMPurify from "dompurify";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

import {
  assertToolImageUrl,
  collectToolImages,
  toolImageFilename,
} from "../src/addons/conversation/task-conversation/vue/toolImages.ts";

const md = new MarkdownIt({ html: false, linkify: true });
const sealed = "https://ark.tos.example.com/a/b_0.jpeg?X-Tos-Credential=nlk.AbC&X-Tos-Signature=nlk.dEf&X-Tos-Expires=86400";

test("MUYU-342: only sealed https tool images are collected", () => {
  const images = collectToolImages(md.parse([
    `![cat](${sealed})`,
    `![dup](${sealed})`,
    "![plain](https://evil.example.com/x.png)",
    "![http](http://ark.example.com/x.png?t=nlk.a)",
    "![js](javascript:alert(1)//?t=nlk.a)",
    "![data](data:image/svg+xml,<svg onload=alert(1)>?t=nlk.a)",
    "![rel](/relative.png?t=nlk.a)",
  ].join("\n\n"), {}));
  assert.deepEqual(images, [{ src: sealed, alt: "cat" }]);
});

test("MUYU-342: raw HTML img / onerror in a message never becomes a tool image", () => {
  const evil = `<img src="${sealed}" onerror="alert(1)">\n\n<a href="${sealed}">x</a>`;
  assert.deepEqual(collectToolImages(md.parse(evil, {})), []);
});

test("MUYU-342: unsealed URL must be https without credentials", () => {
  assert.equal(assertToolImageUrl("https://ark.example.com/a.jpeg?X=1"), "https://ark.example.com/a.jpeg?X=1");
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AA", "http://ark.example.com/a.jpeg", "https://u:p@ark.example.com/a", "", "blob:https://x/1"]) {
    assert.throws(() => assertToolImageUrl(bad), /图片地址不安全/);
  }
});

test("MUYU-342: download file name keeps only safe image names", () => {
  assert.equal(toolImageFilename("https://h/doubao/abc_0.jpeg?x=1"), "abc_0.jpeg");
  assert.equal(toolImageFilename("https://h/a/%2e%2e%2fevil.html"), "image.png");
  assert.equal(toolImageFilename("https://h/a/run.exe"), "image.png");
});

test("MUYU-342: ToolImage binds src via Vue, no v-html, no referrer, no raw HTML sink", () => {
  const sfc = readFileSync(new URL("../src/addons/conversation/task-conversation/vue/ToolImage.vue", import.meta.url), "utf8");
  assert.doesNotMatch(sfc, /v-html|innerHTML/);
  assert.match(sfc, /referrerpolicy="no-referrer"/);
  assert.match(sfc, /noopener,noreferrer/);
  const markdown = readFileSync(new URL("../src/addons/conversation/task-conversation/markdown.ts", import.meta.url), "utf8");
  // Default-deny stays: images never pass through the sanitized HTML.
  assert.match(markdown, /renderer\.rules\.image = \(\) => "";/);
  assert.match(markdown, /"img",\n\s*\],/);
});

let vite: ViteDevServer;
let MarkdownContent: Component;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0 },
  });
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  await initializeRuntimeFixture(vite);
  ({ default: MarkdownContent } = await vite.ssrLoadModule("/src/addons/conversation/task-conversation/vue/MarkdownContent.vue"));
});

after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("MUYU-342: message renders a ToolImage for the sealed image only; HTML keeps no img", async () => {
  const original = DOMPurify.sanitize;
  // DOMPurify is browser-only; identity here proves markdown itself emits no <img>.
  DOMPurify.sanitize = ((text: string) => text) as typeof DOMPurify.sanitize;
  try {
    const content = `结果\n\n![橘猫](${sealed})\n\n![x](https://evil.example.com/p.png)\n\n<img src=x onerror=alert(1)>`;
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownContent, { content }) }));
    assert.equal((html.match(/class="atc-tool-image"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /evil\.example\.com/);
    assert.doesNotMatch(html, /nlk\./);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  } finally {
    DOMPurify.sanitize = original;
  }
});
