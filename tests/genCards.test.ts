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
    assert.match(state.tr("gen.cancelConfirm"), /扣费/);
  });

  test("prefers i18n messages over the built-in Chinese fallback", async () => {
    const html = await render(Pending, base, { gen: { generating: "Generating {n} images", stage: { running: "Working" } } });
    assert.match(html, /Generating 4 images/);
    assert.match(html, /Working/);
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
    const { state } = await bindings(Result, base);
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
});
