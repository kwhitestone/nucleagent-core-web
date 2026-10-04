import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let component: any;
let messages: any;

before(async () => {
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  ({ default: component } = await vite.ssrLoadModule("/src/addons/administration/provider/ProviderModelLimits.vue"));
  const zh = await vite.ssrLoadModule("/src/i18n/zh.ts");
  const en = await vite.ssrLoadModule("/src/i18n/en.ts");
  messages = { zh: zh.default, en: en.default };
});
after(async () => { await vite.close(); });

async function render(view: any, props = {}, locale = "en") {
  const app = createSSRApp(view, props);
  app.use(createI18n({ legacy: false, locale, messages }));
  return renderToString(app);
}

test("budget fields show actual configured values and label defaults as conservative in both languages", async () => {
  for (const [locale, hint] of [["en", "conservative budgets"], ["zh", "保守预算"]]) {
    const html = await render(component, { models: ["model<fixture>", "model-b"], modelLimits: {
      "model<fixture>": { contextWindow: "65536", maxOutputTokens: "8192" },
    } }, locale);
    assert.match(html, /model&lt;fixture&gt;/);
    assert.match(html, /value="65536"/);
    assert.match(html, /value="8192"/);
    assert.match(html, /placeholder="32768"[^>]*value=""/);
    assert.match(html, /placeholder="4096"[^>]*value=""/);
    assert.match(html, new RegExp(hint));
  }
});

test("editing one budget produces a new map without dropping other model settings", async () => {
  const original = { "model-a": { contextWindow: "65536", maxOutputTokens: "8192" }, "model-b": { contextWindow: "32768", maxOutputTokens: "4096" } };
  const probe = defineComponent({
    setup() {
      const state = component.setup({ models: Object.keys(original), modelLimits: original }, {
        expose() {}, emit(name: string, value: any) {
          assert.equal(name, "update:modelLimits");
          assert.equal(value["model-a"].contextWindow, "131072");
          assert.equal(value["model-a"].maxOutputTokens, "8192");
          assert.deepEqual(value["model-b"], original["model-b"]);
          assert.equal(original["model-a"].contextWindow, "65536");
          assert.notEqual(value, original);
        },
      });
      state.updateLimit("model-a", "contextWindow", { target: { value: "131072" } });
      return () => h("div", "budget edit verified");
    },
  });
  assert.match(await render(probe), /budget edit verified/);
});
