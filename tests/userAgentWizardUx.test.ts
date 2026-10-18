import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSSRApp, h, nextTick, reactive, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { hostNode, renderer } from "./vueComponentHarness.ts";

let vite: ViteDevServer, Wizard: any, zh: any, api: any;
before(async () => {
  vite = await createServer({ configFile: false, envFile: false, plugins: [vue()], appType: "custom",
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  Wizard = (await vite.ssrLoadModule("/src/addons/conversation/components/UserAgentWizard.vue")).default;
  zh = (await vite.ssrLoadModule("/src/i18n/zh.ts")).default;
  api = await vite.ssrLoadModule("/src/addons/conversation/api/userAgent.ts");
});
after(async () => { await vite?.close(); });
const i18n = () => createI18n({ legacy: false, locale: "zh", messages: { zh }, missingWarn: false, fallbackWarn: false });
const base = () => ({ models: ["fixture-model"], genModels: { image: ["fixture-image"] }, busy: false, errors: {} as Record<string, string> });
async function html(extra: any) {
  const app = createSSRApp({ render: () => h(Wizard, { ...base(), ...extra }) });
  app.use(i18n()); return renderToString(app);
}
function mount(extra: any = {}) {
  let state: any;
  const props = reactive({ ...base(), ...extra }), events: string[] = [], saves: any[] = [], cancels: boolean[] = [];
  const component = { ...Wizard, render: () => null };
  const app = renderer.createApp({ render: () => h(component, {
    ...props, onSubmit: (d: any) => saves.push(d), onCancel: () => cancels.push(true),
    onVnodeMounted: (v: any) => { state = v.component.setupState; },
  }) });
  app.use(i18n()); app.provide(ssrContextKey, {}); app.mount(hostNode("root"));
  state.dialog = { querySelector: (selector: string) => ({
    scrollIntoView: () => events.push(`scroll:${selector}`),
    closest: () => ({ scrollIntoView: () => events.push(`scroll:${selector}`) }),
    focus: () => events.push(`focus:${selector}`),
  }) };
  return { app, props, state, events, saves, cancels };
}

test("invalid name from skills navigates after render and keeps all other drafts", async () => {
  const f = mount();
  try {
    f.state.draft.model = "fixture-model";
    f.state.draft.prompt = "Synthetic retained prompt";
    f.state.draft.skillIds = [7];
    f.state.goTo("skills"); f.events.length = 0;
    f.state.submit();
    assert.deepEqual(f.events, [], "focus/scroll waits for nextTick");
    await nextTick();
    assert.equal(f.state.active, "basic");
    assert.ok(f.events.includes("focus:#ua-name"));
    assert.ok(f.events.includes("scroll:#ua-name"));
    assert.equal(f.saves.length, 0);
    assert.equal(f.state.draft.prompt, "Synthetic retained prompt");
    assert.deepEqual([...f.state.draft.skillIds], [7]);
  } finally { f.app.unmount(); }
});
test("missing create model from skills navigates to model", async () => {
  const f = mount();
  try {
    f.state.draft.name = "Fixture"; f.state.goTo("skills");
    f.state.submit(); await nextTick();
    assert.equal(f.state.active, "model");
    assert.ok(f.events.includes("focus:#ua-model"));
    assert.equal(f.saves.length, 0);
  } finally { f.app.unmount(); }
});
test("server 422 maps through actual API policy and navigates without replacing draft", async () => {
  for (const [message, group, selector] of [
    ["name is required", "basic", "#ua-name"],
    ["model_not_open_to_users", "model", "#ua-model"],
    ["execution_backend_incompatible", "model", "#ua-backend"],
    ["model_type_mismatch", "model", "#ua-gen-image"],
    ["invalid prompt", "persona", "#ua-prompt"],
    ["skill_not_selectable", "skills", "#ua-bindings-err"],
  ]) {
    const f = mount();
    try {
      f.state.draft.description = "Retained"; f.state.goTo("skills");
      const mapped = api.userAgentError(Object.assign(new Error(message), { status: 422 }));
      f.props.errors = { [mapped.field]: "Synthetic rejection" };
      await nextTick(); await nextTick();
      assert.equal(f.state.active, group, message);
      assert.ok(f.events.includes(`focus:${selector}`), message);
      assert.equal(f.state.draft.description, "Retained");
    } finally { f.app.unmount(); }
  }
});
test("first error follows field order rather than server insertion order", async () => {
  const f = mount();
  try {
    f.props.errors = { model: "Model rejected", name: "Name rejected" };
    await nextTick(); await nextTick();
    assert.equal(f.state.active, "basic");
    assert.ok(f.events.includes("focus:#ua-name"));
  } finally { f.app.unmount(); }
});
test("global and unmapped errors remain visible, including generation without a catalog", async () => {
  const rendered = await html({ genModels: {}, errors: { form: "Synthetic global failure", future: "Synthetic unknown field", gen: "Synthetic gen failure" } });
  for (const text of ["Synthetic global failure", "Synthetic unknown field", "Synthetic gen failure"])
    assert.ok(rendered.includes(text), text);
  assert.match(rendered, /role="alert"/);
});
test("busy ordinary fields and cancel expose the same lock as skills/tools/save", async () => {
  const rendered = await html({ busy: true });
  for (const id of ["ua-name", "ua-desc", "ua-prompt", "ua-model", "ua-memory", "ua-backend", "ua-gen-image"]) {
    const tag = rendered.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] ?? "";
    assert.ok(tag, id);
    assert.match(tag, ["ua-name", "ua-desc", "ua-prompt"].includes(id) ? /readonly/ : /disabled/, id);
  }
  assert.match(rendered, /<button[^>]*data-testid="ua-cancel"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="ua-cancel"/);
});
test("busy prevents submit and cancel; unlocking restores both commands", async () => {
  const f = mount({ busy: true });
  try {
    f.state.draft.name = "Fixture"; f.state.draft.model = "fixture-model";
    f.state.submit(); assert.equal(f.saves.length, 0);
    f.state.cancel(); assert.equal(f.cancels.length, 0);
    f.props.busy = false; await nextTick();
    f.state.submit(); assert.equal(f.saves.length, 1);
    f.state.cancel(); assert.equal(f.cancels.length, 1);
  } finally { f.app.unmount(); }
});
