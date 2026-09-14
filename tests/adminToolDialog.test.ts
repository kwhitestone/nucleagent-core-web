import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let component: any;

before(async () => {
  vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  ({ default: component } = await vite.ssrLoadModule("/src/addons/administration/views/admin/AdminTools.vue"));
});
after(async () => { await vite.close(); });

test("tool dialog follows create, edit and close transitions without stale form state", async () => {
  const probe = defineComponent({
    setup() {
      const state = component.setup({}, { expose() {} });
      assert.equal(state.formOpen.value, false);
      state.openCreate();
      assert.equal(state.formOpen.value, true);
      assert.equal(state.isCreate.value, true);
      state.closeForm();
      assert.equal(state.formOpen.value, false);
      const tool = {
        id: 42, name: "Fixture", slug: "fixture", isActive: false,
        config: { mcp_config: {
          type: "builtin", url: "https://fixture.invalid/mcp", description: "Fixture details",
          input_schema: { type: "object" },
        } },
      };
      state.openEdit(tool);
      assert.equal(state.formOpen.value, true);
      assert.equal(state.isCreate.value, false);
      assert.equal(state.editingId.value, 42);
      assert.equal(state.form.name, "Fixture");
      assert.equal(state.form.isActive, false);
      state.closeForm();
      state.openCreate();
      assert.equal(state.formOpen.value, true);
      assert.equal(state.form.name, "");
      assert.equal(state.form.slug, "");
      assert.equal(state.form.type, "http");
      assert.equal(state.form.url, "");
      assert.equal(state.form.description, "");
      assert.equal(state.form.schemaText, "");
      assert.equal(state.form.isActive, true);
      state.closeForm();
      assert.equal(state.formOpen.value, false);
      return () => h("div", "dialog transitions verified");
    },
  });
  const app = createSSRApp(probe);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
  assert.match(await renderToString(app), /dialog transitions verified/);
});
