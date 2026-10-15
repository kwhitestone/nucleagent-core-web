import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// REVIEW-AVATAR-K6-1 ⑥: avatar upload errors echo server text; it must render as text.
const card = readFileSync(new URL("../src/addons/conversation/components/AgentCard.vue", import.meta.url), "utf8");

test("AgentCard never renders through v-html / innerHTML; upload errors go to toast", () => {
  assert.doesNotMatch(card, /v-html|innerHTML/);
  assert.match(card, /toast\.error\(t\("agents\.avatarFailed", \{ message:/);
});

test("toast puts a <script> error message in as text, never as markup", async () => {
  const made: Array<Record<string, unknown>> = [];
  const node = () => {
    const el: Record<string, unknown> = { style: {}, children: [] as unknown[], remove() {} };
    el.appendChild = (c: unknown) => (el.children as unknown[]).push(c);
    Object.defineProperty(el, "innerHTML", { set() { throw new Error("innerHTML used"); } });
    made.push(el);
    return el;
  };
  (globalThis as Record<string, unknown>).document = { createElement: node, body: node() };
  const { toast } = await import("../src/composables/useToast.ts");
  const evil = `上传失败：<script>alert(1)</script><img src=x onerror=alert(2)>`;
  toast.error(evil);
  const msg = made.find((e) => e.textContent !== undefined);
  assert.equal(msg?.textContent, evil);
});
