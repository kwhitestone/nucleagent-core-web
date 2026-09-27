import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

// UNI-MOBILE-IMPL §10 quick fix: the execution-process summary collapsed to one
// letter per line on phones (the preview had flex-basis 0 and no room left).
// Real CSS, real Chromium layout; skips when playwright is not installed.
const playwrightPath = process.env.PLAYWRIGHT_PATH ?? resolve("../../node_modules/playwright");
const skip = existsSync(playwrightPath) ? false : "playwright not installed";
const css = ["src/addons/conversation/task-conversation/styles.css", "src/addons/conversation/views/conversation.css"]
  .map((file) => readFileSync(file, "utf8")).join("\n");
const summary = (cls: string, elapsed: string) => `
  <span class="atc-process-chevron"></span><span class="atc-process-marker"></span>
  <span class="atc-process-label">Execution process</span>
  <span class="atc-process-preview">2 steps. Completed</span>
  <span class="${cls}">${elapsed}</span>`;
const page = (width: number) => `<style>${css}</style>
  <div class="chat-view" style="width:${width}px"><div class="atc-root">
    <details class="atc-process atc-process-group">
      <summary class="atc-process-summary">${summary("atc-process-elapsed", "Total time 301.6s")}</summary>
    </details>
    <details class="atc-process atc-process-group" open>
      <summary class="atc-process-summary">${summary("atc-process-elapsed", "Total time 301.6s")}</summary>
      <div class="atc-process-content atc-process-group-content">
        <details class="atc-process-step"><summary class="atc-process-step-summary">${summary("atc-process-step-elapsed", "12.4s")}</summary></details>
      </div>
    </details>
  </div></div>`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any;
before(async () => {
  if (skip) return;
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); });

for (const width of [315, 393, 360, 320, 820]) {
  test(`process summary preview stays readable at ${width}px`, { skip }, async () => {
    const tab = await browser.newPage();
    try {
      await tab.setContent(page(width));
      const visible = ".atc-process:not([open]) > .atc-process-summary .atc-process-preview, .atc-process-step-summary .atc-process-preview";
      const boxes = await tab.$$eval(visible, (nodes: Element[]) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, lineHeight: parseFloat(getComputedStyle(node).lineHeight) || 18 };
      }));
      assert.equal(boxes.length, 2);
      for (const box of boxes) {
        assert.ok(box.width >= 80, `preview too narrow: ${box.width}px`);
        assert.ok(box.height <= box.lineHeight * 2 + 1, `preview wrapped vertically: ${box.height}px`);
      }
    } finally {
      await tab.close();
    }
  });
}
