// MT3-coreweb (Q4 D3 layer 2): home cards → /generate/:kind, task status,
// polling, download, carrier conversation. W1–W7 + guards for the mutation set.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

// Pure modules load natively so the test:unit coverage gate measures them.
import * as gen from "../src/addons/conversation/composables/generation.ts";
import { narrowTo, pickerOptions } from "../src/addons/conversation/components/modelPickerOptions.ts";
import { ApiError, registerPlatformRuntime } from "../src/contracts/platform-runtime.ts";
import * as media from "../src/addons/conversation/api/media.ts";
import axios from "axios";

let vite: ViteDevServer;
let zh: any;
let en: any;
const calls: { method: string; url: string }[] = [];
let respond: (method: string, url: string) => unknown = () => ({});
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const tOf = (locale: "zh" | "en") => createI18n({ legacy: false, locale, messages: { zh, en } }).global.t as any;

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true,
    value: { getItem: () => null, setItem() {}, removeItem() {} } });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ default: zh } = await vite.ssrLoadModule("/src/i18n/zh.ts"));
  ({ default: en } = await vite.ssrLoadModule("/src/i18n/en.ts"));
  const http = axios.create();
  registerPlatformRuntime({ http } as any);
  http.defaults.adapter = async (config: any) => {
    const method = String(config.method).toUpperCase();
    const q = config.params ? `?${new URLSearchParams(config.params)}` : "";
    calls.push({ method, url: `${config.url}${q}` });
    await new Promise((r) => setTimeout(r, 5));
    return { config, data: respond(method, `${config.url}${q}`), headers: {}, status: 200, statusText: "OK" };
  };
});
after(async () => {
  await vite.close();
  Reflect.deleteProperty(globalThis, "localStorage");
});

const card = (id: string) => ({ id, icon: "image", action: "prefill" as const, title: "t", desc: "d", prompt: "p" });

// ---- W1
test("W1 only the two generate cards route; every other card keeps prefilling", () => {
  assert.equal(gen.generationKind(card("generateImage")), "image");
  assert.equal(gen.generationKind(card("generateVideo")), "video");
  for (const id of ["generateimage", "video", "writeReport", "generateImage2", ""]) assert.equal(gen.generationKind(card(id)), null, id);
  const home = src("addons/conversation/views/Home.vue");
  assert.ok(/generationKind\(card\)/.test(home), 'home /generationKind\\(card\\)/');
  assert.ok(/name: "generate", params: \{ kind \}/.test(home), 'home /name: "generate", params: \\{ kind \\}/');
  assert.ok(/input\.value = cardInput\(card\)/.test(home), 'home /input\\.value = cardInput\\(card\\)/');
  const routes = src("addons/conversation/index.ts");
  assert.ok(/path: "\/generate\/:kind\(image\|video\)"/.test(routes), 'routes /path: "\\/generate\\/:kind\\(image\\|video\\)"/');
  assert.ok(/routeScopes: \[[^\]]*"\/generate"/.test(routes), 'routes /routeScopes: \\[[^\\]]*"\\/generate"/');
});

// ---- W2
const zhT = () => tOf("zh");
test("W2 seven states map to the right text and buttons", () => {
  const t = zhT();
  for (const status of ["queued", "submitting", "running", "ingesting"]) {
    const img = gen.statusView({ kind: "image", status }, t);
    assert.deepEqual([img.label, img.pending, img.preview, img.download, img.regenerate], ["生成中", true, false, false, false], status);
    assert.match(gen.statusView({ kind: "video", status }, t).label, /生成中.*通常约 2 分钟/);
  }
  const file = { id: "f", name: "a.png", mime: "image/png", size: 3 };
  const ok = gen.statusView({ kind: "image", status: "succeeded", file }, t);
  assert.deepEqual([ok.label, ok.pending, ok.preview, ok.download, ok.regenerate], ["已完成", false, true, true, true]);
  const failed = gen.statusView({ kind: "image", status: "failed", errorCode: "content_rejected", file }, t);
  assert.match(failed.label, /^失败：内容未通过审核/);
  assert.deepEqual([failed.preview, failed.download, failed.regenerate], [false, false, true]);
  const unknown = gen.statusView({ kind: "video", status: "unknown", errorCode: "unknown_submit" }, t);
  assert.match(unknown.label, /^结果不明：.*未自动重试.*用量明细/);
  assert.doesNotMatch(unknown.label, /失败/);
  assert.deepEqual([unknown.pending, unknown.preview, unknown.download, unknown.regenerate], [false, false, false, false]);
  assert.match(gen.statusView({ kind: "image", status: "unknown" }, tOf("en")).label, /not retried/i);
  assert.equal(gen.STATUSES.length, 7);
});

// ---- W3
test("W3 eight error codes have zh and en text; 429 names the in-flight count", () => {
  for (const loc of ["zh", "en"] as const) {
    const t = tOf(loc);
    for (const code of gen.ERROR_CODES) {
      const text = gen.errorText(code, t, "", 2);
      assert.ok(text && !text.includes("generate."), `${loc}.${code}`);
    }
  }
  assert.equal(gen.ERROR_CODES.length, 8);
  assert.match(gen.errorText("media_busy", zhT(), "", 3), /已有 3 个进行中的任务，请稍后/);
  assert.match(gen.errorText("media_busy", tOf("en"), "", 2), /2 .*in progress/);
  assert.equal(gen.errorText("video_tasks_limit", zhT(), "上游视频任务并发已满"), "上游视频任务并发已满");
  assert.equal(gen.errorText("weird", zhT()), zh.generate.errors.upstream_error);
});

test("W3b submit errors: 400 model_type_mismatch via modelErrorMessage, 429 with count, others by code", () => {
  const t = zhT();
  const mismatch = new ApiError("x", "model_type_mismatch", 400, { code: "model_type_mismatch", model: "doubao-seedance-2-0", modelType: "video" });
  assert.match(gen.submitErrorText(mismatch, t, 0), /doubao-seedance-2-0/);
  assert.equal(gen.submitErrorText(mismatch, t, 0, "image"), "doubao-seedance-2-0 是生视频模型，这里只能选生图模型，请改选。");
  assert.match(gen.submitErrorText(mismatch, tOf("en"), 0, "image"), /doubao-seedance-2-0 .*"video".*"image" model/);
  assert.equal(gen.submitErrorText(new ApiError("srv", "model_type_mismatch", 400, {}), t, 0), "srv");
  assert.match(gen.submitErrorText(new ApiError("busy", "media_busy", 429, {}), t, 4), /已有 4 个进行中的任务/);
  assert.equal(gen.submitErrorText(new ApiError("srv text", "invalid_prompt", 400, {}), t, 0), "srv text");
  assert.equal(gen.submitErrorText(new ApiError("srv", "gateway_unavailable", 400, {}), t, 0), zh.generate.errors.gateway_unavailable);
  assert.equal(gen.submitErrorText(new Error("boom"), t, 0), "boom");
});

// ---- W4
test("W4 poll delay: 3 s for a minute, then 10 s; null while hidden", () => {
  assert.equal(gen.nextPollDelay(0, false), 3000);
  assert.equal(gen.nextPollDelay(59_999, false), 3000);
  assert.equal(gen.nextPollDelay(60_000, false), 10_000);
  assert.equal(gen.nextPollDelay(10 * 60_000, false), 10_000);
  assert.equal(gen.nextPollDelay(0, true), null);
  assert.equal(gen.nextPollDelay(120_000, true), null);
});

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { timers.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimer: (h: unknown) => { timers.delete(h as number); },
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

test("W4b poller: 3 s then 10 s, pauses while hidden, stops on leave and when nothing is pending", async () => {
  const clock = fakeClock();
  let hidden = false;
  let pending = true;
  const ticks: number[] = [];
  const poller = gen.createPoller({ ...clock, hidden: () => hidden, tick: async () => { ticks.push(clock.now()); return pending; } });
  poller.start();
  await clock.advance(9_000);
  assert.deepEqual(ticks, [3000, 6000, 9000]);
  await clock.advance(81_000); // now = 90 s
  assert.deepEqual(ticks.filter((t) => t >= 57_000), [57_000, 60_000, 70_000, 80_000, 90_000]);
  hidden = true;
  poller.visibility();
  const n = ticks.length;
  await clock.advance(120_000);
  assert.equal(ticks.length, n, "no polling while hidden");
  assert.equal(clock.pending(), 0);
  hidden = false;
  poller.visibility();
  await clock.advance(10_000);
  assert.equal(ticks.length, n + 1, "resumes when visible");
  poller.stop();
  await clock.advance(600_000);
  assert.equal(ticks.length, n + 1, "no polling after leaving the page");
  assert.equal(clock.pending(), 0);
  poller.visibility();
  await clock.advance(60_000);
  assert.equal(ticks.length, n + 1, "visibility after stop does not restart");
  pending = false;
  poller.start();
  await clock.advance(3_000);
  assert.equal(ticks.length, n + 2);
  await clock.advance(600_000);
  assert.equal(ticks.length, n + 2, "stops once nothing is pending");
  const page = src("addons/conversation/views/Generate.vue");
  assert.ok(/onBeforeUnmount\(\(\) => \{\s*poller\.stop\(\)/.test(page), 'page /onBeforeUnmount\\([^)]*\\{[\\s\\S]*poller\\.stop\\(\\)/');
  assert.ok(/visibilitychange/.test(page), 'page /visibilitychange/');
});

// ---- W5
test("W5 the form submits once while busy: one POST for a double click", async () => {
  calls.length = 0;
  respond = (m) => (m === "POST" ? { id: 7, status: "queued" } : {});
  const submitter = gen.createSubmitter(media.createGeneration as any);
  const body = { kind: "image", providerId: 1, model: "doubao-seedream-4-0-250828", prompt: "a cat" };
  const first = submitter.submit(body);
  assert.equal(submitter.state.busy, true, "button disabled while submitting");
  const second = submitter.submit(body);
  assert.deepEqual(await Promise.all([first, second]), [{ id: 7, status: "queued" }, null]);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(calls[0].url, "/api/v1/addons/media/generations");
  assert.equal(submitter.state.busy, false);
  const page = src("addons/conversation/views/Generate.vue");
  assert.ok(/data-testid="gen-submit" :disabled="[^"]*submitter\.state\.busy/.test(page), 'page /:disabled="[^"]*submitter\\.state\\.busy/');
});

test("W5b download link is fetched fresh every time, never cached; unsafe links refused", async () => {
  calls.length = 0;
  let n = 0;
  respond = () => ({ id: 9, status: "succeeded", downloadUrl: `https://cs.example/f?sig=${++n}` });
  assert.equal(await media.freshDownloadUrl(9), "https://cs.example/f?sig=1");
  assert.equal(await media.freshDownloadUrl(9), "https://cs.example/f?sig=2");
  assert.equal(calls.filter((c) => c.url === "/api/v1/addons/media/generations/9").length, 2);
  respond = () => ({ id: 9, status: "succeeded", downloadUrl: "javascript:alert(1)" });
  await assert.rejects(media.freshDownloadUrl(9));
  respond = () => ({ id: 9, status: "failed" });
  await assert.rejects(media.freshDownloadUrl(9));
});

test("W5c list and models hit the own-list and kind endpoints", async () => {
  calls.length = 0;
  respond = (_m, url) => (url.includes("/models") ? { typesAvailable: true, data: [{ providerId: 1, model: "m", kind: "video", verified: true }] } : { data: [] });
  assert.equal((await media.listMediaModels("video")).length, 1);
  assert.deepEqual(await media.listGenerations("video"), []);
  respond = () => ({});
  assert.deepEqual(await media.listMediaModels("image"), []);
  assert.deepEqual(await media.listGenerations("image"), []);
  assert.deepEqual(calls.map((c) => c.url).slice(0, 2), ["/api/v1/addons/media/models?kind=video", "/api/v1/addons/media/generations?kind=video"]);
});

// ---- model dropdown
const MODELS = [
  { providerId: 1, model: "doubao-seedream-4-0-250828", kind: "image", verified: true },
  { providerId: 1, model: "doubao-seedream-3-0-t2i", kind: "image", verified: false },
  { providerId: 1, model: "doubao-seedance-2-0-fast-260128", kind: "video", verified: true },
];
test("model dropdown: only /media/models of this kind, verified preselected, unverified marked", () => {
  assert.deepEqual(gen.mediaChoiceKeys(MODELS, "image"), ["1:doubao-seedream-4-0-250828", "1:doubao-seedream-3-0-t2i"]);
  assert.deepEqual(gen.defaultMediaModel(MODELS, "video"), { providerId: 1, model: "doubao-seedance-2-0-fast-260128" });
  assert.deepEqual(gen.defaultMediaModel([MODELS[1]], "image"), { providerId: 1, model: "doubao-seedream-3-0-t2i" });
  assert.equal(gen.defaultMediaModel(MODELS, "audio"), null);
  assert.deepEqual(gen.mediaNotes(MODELS, "image", "未验证"), { "1:doubao-seedream-3-0-t2i": "未验证" });
  const providers = [{ id: 1, name: "gw", isActive: true, config: { models: [] } }] as any;
  const typed = [
    { providerId: 1, model: "doubao-seedream-4-0-250828", type: "image", capabilities: [] },
    { providerId: 1, model: "gpt-image-2", type: "image", capabilities: [] },
    { providerId: 1, model: "doubao-seedance-2-0-fast-260128", type: "video", capabilities: [] },
  ];
  const only = gen.mediaChoiceKeys(MODELS, "image");
  assert.deepEqual(narrowTo(pickerOptions(providers, typed, "image"), only).flatMap((g) => g.models), ["doubao-seedream-4-0-250828"]);
  assert.deepEqual(pickerOptions(providers, typed, "image").flatMap((g) => g.models), ["doubao-seedream-4-0-250828", "gpt-image-2"]);
  assert.equal(narrowTo(pickerOptions(providers, typed, "image"), []).length, 0);
  assert.ok(/narrowTo\(pickerOptions\([^)]*\), props\.only\)/.test(src("addons/conversation/components/ModelPicker.vue")), "picker narrows");
  const page = src("addons/conversation/views/Generate.vue");
  assert.ok(/<ModelPicker[^>]*:type="kind"[^>]*:only="choiceKeys"/s.test(page), 'page /<ModelPicker[^>]*:type="kind"[^>]*:only="choiceKeys"/s');
});

test("prompt 1–2000 chars", () => {
  assert.equal(gen.promptValid(""), false);
  assert.equal(gen.promptValid("   "), false);
  assert.equal(gen.promptValid("猫"), true);
  assert.equal(gen.promptValid("字".repeat(2000)), true);
  assert.equal(gen.promptValid("字".repeat(2001)), false);
});

test("refresh keeps only the server's own list; polled rows update it", () => {
  const mine = { id: 1, kind: "image", status: "running" } as any;
  const polled = { id: 1, kind: "image", status: "succeeded" } as any;
  const stale = { id: 99, kind: "image", status: "succeeded" } as any; // previous session's row
  assert.deepEqual(gen.mergeTasks([mine], [polled, stale]), [polled]);
  assert.deepEqual(gen.mergeTasks([], [stale]), []);
});

// ---- W6
test("W6 generate.* keys exist and zh/en key sets stay identical", () => {
  const keys = (o: any, p = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
  assert.deepEqual(Object.keys(zh.generate.status).sort(), [...gen.STATUSES].sort());
  assert.deepEqual(Object.keys(zh.generate.errors).sort(), [...gen.ERROR_CODES].sort());
  for (const k of ["unverified", "specImage", "specVideo", "submit", "download", "openLibrary", "regenerate", "mine", "mediaConversation"]) {
    assert.ok(zh.generate[k] && en.generate[k], k);
  }
  assert.deepEqual(keys(zh.generate).sort(), keys(en.generate).sort());
  assert.deepEqual(keys(zh).sort(), keys(en).sort());
});

// ---- W7
test("W7 a mode=media conversation hides the composer and links to /generate/<kind>", () => {
  assert.equal(gen.conversationAcceptsInput({ mode: "media" }), false);
  assert.equal(gen.conversationAcceptsInput({ mode: "a2a" }), true);
  assert.equal(gen.conversationAcceptsInput(null), true);
  assert.equal(gen.conversationMediaKind("doubao-seedance-2-0-fast-260128", ["doubao-seedance-2-0-fast-260128"]), "video");
  assert.equal(gen.conversationMediaKind("doubao-seedream-4-0-250828", ["doubao-seedance-2-0-fast-260128"]), "image");
  assert.equal(gen.conversationMediaKind("x", null), "image");
  assert.equal(gen.conversationMediaKind(undefined, []), "image");
  const conv = src("addons/conversation/views/Conversation.vue");
  assert.ok(/conversationAcceptsInput\(/.test(conv), 'conv /conversationAcceptsInput\\(/');
  assert.ok(/\/generate\/\$\{mediaKind\}/.test(conv), 'conv /\\/generate\\/\\$\\{mediaKind\\}/');
});

test("429 count: pending plus recent unknown", () => {
  const now = Date.parse("2026-10-10T08:00:00Z");
  const at = (min: number) => new Date(now - min * 60_000).toISOString();
  assert.equal(gen.inFlightCount([
    { status: "running", createdAt: at(1) }, { status: "queued", createdAt: at(50) },
    { status: "unknown", createdAt: at(10) }, { status: "unknown", createdAt: at(40) },
    { status: "succeeded", createdAt: at(1) }, { status: "failed", createdAt: at(1) },
  ], now), 3);
});
