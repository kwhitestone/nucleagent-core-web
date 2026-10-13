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
