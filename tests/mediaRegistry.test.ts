// UI-IMPL-6: media kind registry (mirrors core addons/media/registry.go).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as reg from "../src/addons/conversation/registry.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("R1 rows match the server registry; music reserved", () => {
  assert.deepEqual(reg.enabledKinds().map((k) => k.kind), ["image", "video"]);
  assert.equal(reg.MEDIA_KINDS.music.enabled, false);
  assert.equal(reg.MEDIA_KINDS.image.busyLimit, 4);
  assert.equal(reg.MEDIA_KINDS.video.busyLimit, 2);
  assert.deepEqual(reg.MEDIA_KINDS.image.params.map((p) => p.key), ["aspect", "count"]);
  assert.deepEqual(reg.MEDIA_KINDS.video.params.find((p) => p.key === "duration")?.values, ["4", "5", "8"]);
  assert.equal(reg.modelKey("video"), "videoModel");
  assert.equal(reg.isKind("music"), true);
  assert.equal(reg.isKind("hologram"), false);
});

test("R2 defaults and request body per kind; image body unchanged", () => {
  assert.deepEqual(reg.defaultParams("image"), { aspect: "1:1", count: "1" });
  assert.deepEqual(reg.requestParams("image", { aspect: "3:4", count: "3" }), { aspect: "3:4", count: 3 });
  assert.deepEqual(reg.requestParams("video", reg.defaultParams("video")), { aspect: "16:9", count: 1, duration: 4, resolution: "480p" });
  assert.deepEqual(reg.paramsFromMeta({ kind: "video", aspect: "9:16", duration: 8, resolution: "720p" }),
    { aspect: "9:16", duration: "8", resolution: "720p", count: "1" });
  assert.deepEqual(reg.paramsFromMeta({ aspect: "4:3", count: 2 }), { aspect: "4:3", count: "2" });
  assert.equal(reg.kindOf({}), "image");
  assert.equal(reg.kindOf({ kind: "video" }), "video");
});

test("R3 model preselect: agent default when listed, else first (fallback never errors)", () => {
  const ms = [{ providerId: 1, model: "a", kind: "image", verified: true }, { providerId: 1, model: "b", kind: "image", verified: false }];
  assert.deepEqual(reg.pickModel(ms, "b"), { model: ms[1], agentDefault: true });
  assert.deepEqual(reg.pickModel(ms, "gone"), { model: ms[0], agentDefault: false });
  assert.deepEqual(reg.pickModel(ms, undefined), { model: ms[0], agentDefault: false });
  assert.deepEqual(reg.pickModel([], "b"), { model: null, agentDefault: false });
  assert.deepEqual(reg.agentDefaults({ defaults: { imageModel: "x", videoModel: 3, model: "glm" } }), { image: "x" });
  assert.deepEqual(reg.agentDefaults(undefined), {});
});

test("R4 video confirm: per conversation, browser-local only", () => {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(reg.needsConfirm("image", "5", ls), false);
  assert.equal(reg.needsConfirm("video", "5", ls), true);
  reg.skipConfirm("5", ls);
  assert.equal(reg.needsConfirm("video", "5", ls), false);
  assert.equal(reg.needsConfirm("video", "6", ls), true);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(reg.needsConfirm("video", "5", broken), true);
  assert.doesNotThrow(() => reg.skipConfirm("5", broken));
});

test("R5 wiring: entry menu from registry, video player native, old pages untouched", () => {
  const bar = src("addons/conversation/components/media/ChatGenBar.vue");
  assert.match(bar, /enabledKinds\(\)/);
  assert.match(bar, /\.params/);
  const player = src("addons/conversation/components/media/VideoPlayer.vue");
  assert.match(player, /<video[^>]*controls[^>]*preload="metadata"/);
  assert.doesNotMatch(player, /autoplay/);
  const conv = src("addons/conversation/views/Conversation.vue");
  assert.match(conv, /needsConfirm\(/);
  assert.doesNotMatch(conv, /createGeneration\(\{ kind: "image"/);
  const zh = src("i18n/zh.ts");
  assert.match(zh, /视频比图片贵得多/);
  assert.match(zh, /费用以用量明细为准/);
  assert.doesNotMatch(zh, /confirmVideo[^}]*贝壳/);
});
