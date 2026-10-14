import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createSSRApp, defineComponent, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";

let vite: ViteDevServer;
const load = async (name: string) =>
  (await vite.ssrLoadModule(`/src/addons/conversation/components/media/${name}.vue`)).default;

before(async () => {
  vite = await createServer({
    configFile: false,
    envFile: false,
    plugins: [vue()],
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
});
after(async () => { await vite.close(); });

const i18n = (zh: Record<string, unknown> = {}) =>
  createI18n({ legacy: false, locale: "zh", missingWarn: false, fallbackWarn: false, messages: { zh } });

async function render(comp: Component, props: Record<string, unknown>, zh?: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(comp, props) });
  app.use(i18n(zh));
  return renderToString(app);
}

/** Runs the component's <script setup> and returns its bindings plus captured emits. */
async function bindings(comp: any, props: Record<string, unknown>) {
  const emitted: unknown[][] = [];
  let state: any;
  const probe = defineComponent({
    setup() {
      state = comp.setup(props, { emit: (...a: unknown[]) => emitted.push(a), expose() {}, attrs: {}, slots: {} });
      return () => h("i");
    },
  });
  const app = createSSRApp(probe);
  app.use(i18n());
  await renderToString(app);
  return { state, emitted };
}

const count = (html: string, cls: string) => html.split(`class="${cls}`).length - 1;

describe("GenPendingCard", () => {
  let Pending: any;
  before(async () => { Pending = await load("GenPendingCard"); });
  const base = { state: "running", count: 4, aspect: "1:1", startedAt: Date.now(), expectedSec: 20, cancelable: true };

  test("renders one skeleton cell per image, sized by aspect", async () => {
    const html = await render(Pending, { ...base, count: 4, aspect: "16:9" });
    assert.equal(count(html, "gen-pending__cell"), 4);
    assert.match(html, /aspect-ratio:\s*16 \/ 9/);
    assert.match(html, /正在生成 4 张图片/);
    const one = await render(Pending, { ...base, count: 1, aspect: "9:16" });
    assert.equal(count(one, "gen-pending__cell"), 1);
    assert.match(one, /aspect-ratio:\s*9 \/ 16/);
    assert.match(one, /is-portrait/);
  });

  test("clamps count into 1..4", async () => {
    assert.equal(count(await render(Pending, { ...base, count: 9 }), "gen-pending__cell"), 4);
    assert.equal(count(await render(Pending, { ...base, count: 0 }), "gen-pending__cell"), 1);
  });

  test("shows elapsed time and expectation, then the slow notice past 2x", async () => {
    const html = await render(Pending, { ...base, startedAt: Date.now() - 12_500, expectedSec: 30 });
    assert.match(html, /已用 0:12/);
    assert.match(html, /预计约 30 秒/);
    const slow = await render(Pending, { ...base, startedAt: Date.now() - 61_000, expectedSec: 30 });
    assert.match(slow, /已用 1:01/);
    assert.match(slow, /比平时慢一些，仍在生成…/);
    assert.doesNotMatch(slow, /预计约/);
  });

  test("state copy follows the backend state; ingesting hides cancel", async () => {
    assert.match(await render(Pending, { ...base, state: "queued" }), /排队中/);
    assert.match(await render(Pending, { ...base, state: "submitting" }), /正在提交给模型…/);
    const ing = await render(Pending, { ...base, state: "ingesting" });
    assert.match(ing, /马上就好，正在取回结果…/);
    assert.doesNotMatch(ing, /gen-pending__cancel/);
    assert.match(await render(Pending, base), /gen-pending__cancel/);
    assert.doesNotMatch(await render(Pending, { ...base, cancelable: false }), /gen-pending__cancel/);
  });

  test("cancel asks for confirmation before emitting", async () => {
    const { state, emitted } = await bindings(Pending, base);
    state.askCancel();
    assert.equal(state.confirming.value, true);
    state.keepWaiting();
    assert.equal(state.confirming.value, false);
    assert.deepEqual(emitted, []);
    state.askCancel();
    state.confirmCancel();
    assert.equal(state.confirming.value, false);
    assert.deepEqual(emitted, [["cancel"]]);
    assert.match(state.tr("chatGen.cancelConfirm"), /扣费/);
  });

  test("prefers i18n messages over the built-in Chinese fallback", async () => {
    const html = await render(Pending, base, { chatGen: { generating: "Generating {n} images", stage: { running: "Working" } } });
    assert.match(html, /Generating 4 images/);
    assert.match(html, /Working/);
  });

  test("UI-IMPL-6 video placeholder: one cell, minutes estimate, over-estimate is a hint not an error", async () => {
    const html = await render(Pending, { ...base, kind: "video", count: 1, aspect: "16:9", expectedSec: 120 });
    assert.equal(count(html, "gen-pending__cell"), 1);
    assert.match(html, /正在生成视频/);
    assert.match(html, /预计约 2 分钟/);
    const late = await render(Pending, { ...base, kind: "video", expectedSec: 120, startedAt: Date.now() - 300_000 });
    assert.match(late, /比平时慢一些，仍在生成…/);
    assert.match(late, /已用 5:00/);
  });
});

describe("GenResultCard", () => {
  let Result: any;
  before(async () => { Result = await load("GenResultCard"); });
  const img = (n: number, w = 1024, h = 1024) => ({ url: `/u/${n}.png`, thumbUrl: `/t/${n}.png`, width: w, height: h, name: `img-${n}.png` });
  const params = { aspect: "1:1", count: 4, model: "xx-image", size: "1024×1024" };
  const base = { items: [img(1), img(2), img(3), img(4)], prompt: "一只橘猫，水彩风格", params, saved: false };

  test("four images render as a 2x2 grid using thumbnails", async () => {
    const html = await render(Result, base);
    assert.match(html, /gen-result__grid n-4/);
    assert.equal(count(html, "gen-result__cell"), 4);
    assert.match(html, /src="\/t\/1.png"/);
  });

  test("a single image keeps its own ratio with max height 520", async () => {
    const html = await render(Result, { ...base, items: [img(1, 768, 1365)] });
    assert.match(html, /gen-result__grid n-1/);
    assert.match(html, /aspect-ratio:\s*768 \/ 1365/);
    assert.match(html, /is-portrait/);
    const wide = await render(Result, { ...base, items: [img(1, 1365, 768)] });
    assert.match(wide, /is-landscape/);
  });

  test("echoes the prompt and parameter badges", async () => {
    const html = await render(Result, base);
    assert.match(html, /「一只橘猫，水彩风格」/);
    for (const b of ["1:1", "4 张", "xx-image", "1024×1024"]) assert.match(html, new RegExp(`gen-result__badge[^>]*>${b}<`));
  });

  test("saved flips the library action to a saved state with link", async () => {
    const unsaved = await render(Result, base);
    assert.match(unsaved, /保存到成果库/);
    const saved = await render(Result, { ...base, saved: true, libraryUrl: "/deliverables/9" });
    assert.match(saved, /已存 ✓/);
    assert.match(saved, /href="\/deliverables\/9"/);
    assert.match(saved, /在成果库查看/);
    assert.doesNotMatch(saved, /保存到成果库/);
  });

  test("actions emit download/regenerate/refine/save with the item", async () => {
    const { state, emitted } = await bindings(Result, base);
    state.emit("download", base.items[1]);
    state.emit("regenerate");
    state.emit("refine", base.items[0]);
    state.emit("save");
    assert.deepEqual(emitted.map((e) => e[0]), ["download", "regenerate", "refine", "save"]);
    assert.equal(emitted[0][1], base.items[1]);
  });

  test("lightbox opens on an image and closes on Escape only", async () => {
    const { state } = await bindings(await load("ImageGrid"), { items: base.items, aspect: "1:1" });
    assert.equal(state.active.value, null);
    state.open(2);
    assert.equal(state.active.value, 2);
    assert.equal(state.current.value.url, "/u/3.png");
    state.onKey({ key: "Enter" });
    assert.equal(state.active.value, 2);
    state.onKey({ key: "Escape" });
    assert.equal(state.active.value, null);
  });

  test("copy prompt writes to the clipboard", async () => {
    const { state } = await bindings(Result, base);
    let written = "";
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (s: string) => { written = s; } } }, configurable: true });
    await state.copyPrompt();
    assert.equal(written, "一只橘猫，水彩风格");
    assert.equal(state.copied.value, true);
  });
  test("UI-IMPL-6 video kind renders the native player, never autoplays, with video badges", async () => {
    const html = await render(Result, { ...base, kind: "video", items: [{ url: "/u/v.mp4", name: "video-1.mp4" }],
      params: { aspect: "9:16", count: 1, model: "doubao-seedance-x", size: "", duration: 8, resolution: "720p" } });
    assert.match(html, /<video[^>]*controls/);
    assert.match(html, /preload="metadata"/);
    assert.match(html, /src="\/u\/v.mp4#t=0.1"/);
    assert.doesNotMatch(html, /autoplay/);
    assert.doesNotMatch(html, /gen-result__grid/);
    assert.match(html, /is-portrait/);
    for (const b of ["9:16", "8 秒", "720p", "doubao-seedance-x"]) assert.match(html, new RegExp(`gen-result__badge[^>]*>${b}<`));
    assert.doesNotMatch(html, /1 张/);
    for (const a of ["下载", "重新生成", "继续修改"]) assert.match(html, new RegExp(a));
  });
});

describe("GenErrorCard", () => {
  let Err: any;
  before(async () => { Err = await load("GenErrorCard"); });

  test("each code renders the §3.3 title, body and charge note", async () => {
    const cases: [string, RegExp[]][] = [
      ["failed", [/生成没有成功/, /生成服务出错，请稍后重试。/, /一般不扣（以用量明细为准）/, /重试/]],
      ["timeout", [/等太久了，没拿到结果/, /生成超时，未拿到结果。可以换个模型或简化描述再试。/, /扣费：以用量明细为准/, /换个模型/]],
      ["content_rejected", [/内容没有通过安全审核/, /提示词或结果未通过内容安全审核，请修改后重试。/, /修改提示词/]],
      ["insufficient_balance", [/贝壳不够了/, /账户额度不足，请联系管理员。/, /扣费：不扣/, /查看用量/]],
      ["media_busy", [/你已有 3 个生成任务在进行（图片最多 4 个、视频最多 2 个），等其中一个完成后再试。/, /查看进行中/]],
      ["cancelled", [/已取消/, /未产出结果/, /重新生成/]],
    ];
    for (const [code, patterns] of cases) {
      const html = await render(Err, { code, n: 3 });
      for (const p of patterns) assert.match(html, p, `${code} should match ${p}`);
    }
  });

  test("content_rejected never claims it is free; busy/balance use the amber tone", async () => {
    assert.doesNotMatch(await render(Err, { code: "content_rejected" }), /不扣|扣费/);
    assert.match(await render(Err, { code: "media_busy", n: 1 }), /is-warn/);
    assert.match(await render(Err, { code: "insufficient_balance" }), /is-warn/);
    assert.match(await render(Err, { code: "failed" }), /is-error/);
  });

  test("cancelled after submission says it is charged", async () => {
    assert.match(await render(Err, { code: "cancelled", submitted: true }), /已提交的部分按实际扣费，以用量明细为准/);
  });

  test("cancelled with unknown submission (reopened) claims nothing about charge", async () => {
    const html = await render(Err, { code: "cancelled" });
    assert.doesNotMatch(html, /扣费|不会扣/);
    assert.match(await render(Err, { code: "cancelled", submitted: false }), /不会扣费/);
  });

  test("backend message overrides the default body", async () => {
    const html = await render(Err, { code: "failed", message: "上游 500" });
    assert.match(html, /上游 500/);
    assert.doesNotMatch(html, /生成服务出错/);
  });

  test("retry-type buttons emit retry, others emit action", async () => {
    const { state, emitted } = await bindings(Err, { code: "timeout" });
    assert.deepEqual(state.buttons.value.map((b: any) => b.kind), ["retry", "switchModel"]);
    for (const b of state.buttons.value) state.press(b.kind);
    assert.deepEqual(emitted, [["retry"], ["action", "switchModel"]]);
  });
});

describe("GenMessage cancelled batch", () => {
  let Msg: any;
  before(async () => { Msg = await load("GenMessage"); });
  const item = { id: "u1", role: "user", lane: "chat", content: "一只猫", data: { media: { kind: "image", aspect: "3:4", count: 2, taskIds: [5, 6] } } };
  const task = (id: number, status: string) => ({ id, kind: "image", model: "m", prompt: "一只猫", status, conversationId: 184, createdAt: "2026-10-14T00:00:00Z" });
  function host(statuses: string[], submitted = new Map<number, boolean>()) {
    const calls: unknown[][] = [];
    const h = {
      tasks: new Map(statuses.map((s, i) => [5 + i, task(5 + i, s)])),
      groups: new Map(), submitted,
      cancel: () => {}, regenerate: (...a: unknown[]) => calls.push(["regenerate", ...a]),
      refine: () => {}, prefill: (...a: unknown[]) => calls.push(["prefill", ...a]),
    };
    return { h, calls };
  }
  const html = async (hst: unknown) => {
    const app = createSSRApp({ render: () => h(Msg, { item }) });
    app.provide("chatGen", hst);
    app.use(i18n());
    return renderToString(app);
  };

  test("after cancel (this session) the user message keeps a 已取消 card with the charge note", async () => {
    const out = await html(host(["cancelled", "cancelled"], new Map([[5, true], [6, true]])).h);
    assert.match(out, /已取消/);
    assert.match(out, /未产出结果/);
    assert.match(out, /已提交的部分按实际扣费，以用量明细为准/);
    assert.match(out, /重新生成/);
    assert.doesNotMatch(out, /gen-pending/);
  });

  test("reopened conversation (task status only) still shows the 已取消 card", async () => {
    const out = await html(host(["cancelled", "cancelled"]).h);
    assert.match(out, /已取消/);
    assert.match(out, /未产出结果/);
    assert.doesNotMatch(out, /扣费/);
  });

  test("still running shows the pending card, not 已取消", async () => {
    const out = await html(host(["running", "queued"]).h);
    assert.match(out, /gen-pending/);
    assert.doesNotMatch(out, /已取消/);
  });

  test("重新生成 prefills the original prompt and params instead of generating", async () => {
    const { h: hst, calls } = host(["cancelled", "cancelled"]);
    let state: any;
    const probe = defineComponent({ setup() { state = Msg.setup({ item }, { emit() {}, expose() {}, attrs: {}, slots: {} }); return () => h("i"); } });
    const app = createSSRApp(probe);
    app.provide("chatGen", hst);
    app.use(i18n());
    await renderToString(app);
    state.redo();
    // UI-IMPL-6 rebase: prefill takes the stored media meta (kind + params) like regenerate/refine.
    assert.equal(calls.length, 1);
    const [name, prompt, meta] = calls[0] as [string, string, Record<string, unknown>];
    assert.deepEqual([name, prompt, meta.aspect, meta.count], ["prefill", "一只猫", "3:4", 2]);
  });
});
