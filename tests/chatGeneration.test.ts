// UI-IMPL-3: in-conversation image generation — pure logic.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as cg from "../src/addons/conversation/composables/chatGeneration.ts";
import * as gen from "../src/addons/conversation/composables/generation.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("C1 aspect/count options and defaults", () => {
  assert.deepEqual(cg.ASPECTS, ["1:1", "3:4", "4:3", "9:16", "16:9"]);
  assert.deepEqual(cg.COUNTS, [1, 2, 3, 4]);
  assert.deepEqual(cg.DEFAULT_PARAMS, { aspect: "1:1", count: 1 });
  assert.equal(cg.aspectRatio("9:16"), "9 / 16");
  assert.equal(cg.aspectRatio("bad"), "1 / 1");
});

test("C2 grid layout by image count", () => {
  assert.equal(cg.gridLayout(1), "single");
  assert.equal(cg.gridLayout(2), "pair");
  assert.equal(cg.gridLayout(3), "trio");
  assert.equal(cg.gridLayout(4), "quad");
  assert.equal(cg.gridLayout(7), "quad");
});

test("C3 stage key per status, elapsed mm:ss, slow after 2× expected", () => {
  assert.equal(cg.stageKey("queued"), "queued");
  assert.equal(cg.stageKey("submitting"), "submitting");
  assert.equal(cg.stageKey("running"), "submitting");
  assert.equal(cg.stageKey("ingesting"), "ingesting");
  assert.equal(cg.formatElapsed(0), "0:00");
  assert.equal(cg.formatElapsed(72_400), "1:12");
  assert.equal(cg.isSlow(39_000), false);
  assert.equal(cg.isSlow(41_000), true);
});

test("C4 cancel copy distinguishes submitted from queued", () => {
  assert.equal(cg.cancelNoteKey(false), "chatGen.cancelledFree");
  assert.equal(cg.cancelNoteKey(true), "chatGen.cancelledCharged");
  assert.equal(cg.cancellable("ingesting"), true);
  assert.equal(cg.cancellable("succeeded"), false);
});

test("C5 error card per code: title, copy, action", () => {
  assert.deepEqual(cg.errorCard("content_rejected"), { code: "content_rejected", tone: "fail", action: "edit" });
  assert.deepEqual(cg.errorCard("unknown_submit"), { code: "unknown_submit", tone: "warn", action: "usage" });
  assert.deepEqual(cg.errorCard("insufficient_balance"), { code: "insufficient_balance", tone: "warn", action: "usage" });
  assert.deepEqual(cg.errorCard("ingest_failed"), { code: "ingest_failed", tone: "fail", action: "retry" });
  assert.deepEqual(cg.errorCard("weird"), { code: "upstream_error", tone: "fail", action: "retry" });
});

test("C6 media metadata parsing and batch grouping", () => {
  assert.equal(cg.mediaOf(undefined), null);
  assert.equal(cg.mediaOf({ media: "x" }), null);
  const req = cg.mediaOf({ media: { kind: "image", taskIds: [3, 4], aspect: "3:4", count: 2, model: "m", size: "864x1152" } });
  assert.deepEqual(req?.taskIds, [3, 4]);
  const res = cg.mediaOf({ media: { taskId: 3, batch: 9, index: 1, count: 2, aspect: "3:4", size: "864x1152", model: "m" } });
  assert.equal(res?.batch, 9);
  const items = [
    { id: "a", data: { media: { taskId: 3, batch: 9, index: 1, count: 2 } } },
    { id: "b", data: { media: { taskId: 4, batch: 9, index: 2, count: 2 } } },
    { id: "c", data: { media: { taskId: 5, batch: 10, index: 1, count: 1 } } },
    { id: "d" },
  ];
  assert.deepEqual(cg.batchLead(items, "a"), ["a", "b"]);
  assert.deepEqual(cg.batchLead(items, "b"), []);
  assert.deepEqual(cg.batchLead(items, "c"), ["c"]);
  assert.deepEqual(cg.batchLead(items, "d"), []);
});

test("C7 prompt from a result message body", () => {
  assert.equal(cg.promptOf("已为你生成 1 张图片。\n提示词：「一只猫」\n参数：1:1"), "一只猫");
  assert.equal(cg.promptOf("x"), "");
});

test("C8 carrier conversations accept input (image only) and the banner is plain words", () => {
  assert.equal(gen.conversationAcceptsInput({ mode: "media" }), true);
  assert.equal(cg.forcedImageMode({ mode: "media" }), true);
  assert.equal(cg.forcedImageMode({ mode: "a2a" }), false);
  const zh = src("i18n/zh.ts");
  assert.ok(zh.includes("这是一次图片生成，可以在下方继续描述修改"));
  assert.ok(zh.includes("取消后不会出结果。尚未提交给模型的不扣费；已提交的按实际扣费。"));
  const home = src("addons/conversation/views/Home.vue");
  assert.ok(/conversationId: 0/.test(home) && /genOn\.value = true/.test(home), "home card turns on image mode; send creates a new chat");
});

// 第9棒 ROOT: GET /media/generations (list) never signs downloadUrl; only GET /generations/{id} does.
// GenMessage leads with succeeded&&downloadUrl tasks, so a list-only task map rendered no result card.
test("C9 succeeded list tasks without downloadUrl are re-fetched for a signed link", () => {
  // DEV conv 522 list item, verbatim fields (no downloadUrl in list responses).
  const task6 = { id: 6, kind: "image", model: "doubao-seedream-4-0-250828", prompt: "p", status: "succeeded", conversationId: 522,
    file: { id: "54523a59-cd89-40aa-bd2c-bd3b3d661109", name: "image-6.jpg", mime: "image/jpeg", size: 575607 },
    createdAt: "2026-10-13T12:33:10.495Z", finishedAt: "2026-10-13T12:33:29.147Z" };
  const signed = { ...task6, id: 7, downloadUrl: "https://x/y" };
  const running = { ...task6, id: 8, status: "running", file: undefined };
  const failed = { ...task6, id: 9, status: "failed", file: undefined };
  assert.deepEqual(cg.unsignedDone([task6, signed, running, failed]), [6]);
  assert.match(src("addons/conversation/views/Conversation.vue"), /unsignedDone\(/);
});

test("C10 download saves via same-origin blob, never navigates the frame to the cross-origin link", async () => {
  const url = "https://betacs.cn.ndhy.com/x/image-8.jpg?token=t";
  const clicked: { href: string; download: string }[] = [];
  const opened: string[] = [];
  const env = {
    fetch: async () => new Response(new Blob(["img"])),
    createObjectURL: () => "blob:local/1",
    revokeObjectURL: () => {},
    click: (href: string, download: string) => { clicked.push({ href, download }); },
    open: (u: string) => { opened.push(u); },
  };
  await cg.saveImage(url, "image-8.jpg", env);
  assert.deepEqual(clicked, [{ href: "blob:local/1", download: "image-8.jpg" }]);
  assert.deepEqual(opened, []);
  // No CORS → new tab (as AttachmentChips does), never the current frame.
  clicked.length = 0;
  await cg.saveImage(url, "image-8.jpg", { ...env, fetch: async () => { throw new TypeError("cors"); } });
  assert.deepEqual(clicked, []);
  assert.deepEqual(opened, [url]);
  assert.match(src("addons/conversation/components/media/GenMessage.vue"), /saveImage\(/);
});

// C11: a media message is drawn by GenMessage; an attachment chip under it duplicates the image.
export const mediaGuard = (src: string) => /function mapAttachments[\s\S]{0,200}if \(m\.metadata\?\.media\) return undefined;/.test(src);
test("C11 media messages carry no attachment chips", () => {
  assert.ok(mediaGuard(readFileSync(new URL("../src/addons/conversation/composables/useConversationAdapter.ts", import.meta.url), "utf8")));
});

test("C9 cancelled batch keeps a card: nothing pending, nothing produced", () => {
  assert.equal(cg.cancelledBatch([{ status: "cancelled" }]), true);
  assert.equal(cg.cancelledBatch([{ status: "cancelled" }, { status: "failed" }]), true);
  assert.equal(cg.cancelledBatch([{ status: "cancelled" }, { status: "queued" }]), false);
  assert.equal(cg.cancelledBatch([{ status: "cancelled" }, { status: "succeeded" }]), false);
  assert.equal(cg.cancelledBatch([]), false);
});

test("C10 submitted is known only from this session's cancel replies", () => {
  assert.equal(cg.cancelSubmitted([5, 6], new Map([[5, false], [6, true]])), true);
  assert.equal(cg.cancelSubmitted([5], new Map([[5, false]])), false);
  assert.equal(cg.cancelSubmitted([5], new Map()), undefined);
});
