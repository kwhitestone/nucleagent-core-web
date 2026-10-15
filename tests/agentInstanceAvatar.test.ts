// UA-AVATAR-DETAIL-FIX-0036: the detail page header shows the uploaded avatar (same rule as AgentCard),
// falls back to the initial when there is none or it fails to load, and never keeps the previous agent's image.
// Real AgentInstance.vue (script setup + its own template compiled at runtime) on a tiny tree renderer, no DOM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { compile, createRenderer, getCurrentInstance, h, nextTick, reactive, ssrContextKey, type Component } from "vue";
import { parse } from "vue/compiler-sfc";
import { createI18n } from "vue-i18n";
import { createPinia } from "pinia";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { runtimeFixture } from "./fixtures/runtimeConfig.ts";

type N = { tag?: string; text?: string; props: Record<string, any>; children: N[]; parent: N | null };
// v-model (compose textarea) and the auto-focus touch these; the header avatar does not.
const noop = () => {};
const node = (o: Partial<N>): N => ({ props: {}, children: [], parent: null, addEventListener: noop, removeEventListener: noop, focus: noop, ...o } as N);
const renderer = createRenderer<N, N>({
  createElement: (tag) => node({ tag }),
  createText: (text) => node({ text }),
  createComment: (text) => node({ text: "", tag: "!" + text }),
  setText: (n, text) => { n.text = text; },
  setElementText: (n, text) => { n.children = [node({ text, parent: n })]; },
  patchProp: (el, key, _prev, next) => { el.props[key] = next; },
  insert: (child, parent, anchor) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(i < 0 ? parent.children.length : i, 0, child);
    child.parent = parent;
  },
  remove: (child) => { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  parentNode: (n) => n.parent,
  nextSibling: (n) => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] ?? null : null),
});
const all = (root: N, ok: (n: N) => boolean): N[] => [...(ok(root) ? [root] : []), ...root.children.flatMap((c) => all(c, ok))];
const textOf = (n: N): string => (n.text ?? "") + n.children.map(textOf).join("");

const withTemplate = (comp: any, file: string) => {
  const tpl = parse(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).descriptor.template!.content;
  const render = compile(tpl) as any;
  return { ...comp, ssrRender: undefined, render(ctx: any, cache: any) {
    const st = getCurrentInstance()!.setupState as any;
    const own = (k: PropertyKey) => typeof k === "string" && Object.prototype.hasOwnProperty.call(st, k);
    return render(new Proxy(ctx, {
      has: (t, k) => own(k) || Reflect.has(t, k),
      get: (t, k) => (k === Symbol.unscopables ? undefined : own(k) ? st[k] : Reflect.get(t, k)),
      set: (t, k, v) => (own(k) ? ((st[k] = v), true) : Reflect.set(t, k, v)),
    }), cache);
  } };
};

let STORAGE = "";
const MINE = "/api/v1/addons/agent/mine";
const agent = (id: number, avatar?: string) => ({ templateId: id, name: `Bot${id}`, slug: `s${id}`, description: "", disabled: false,
  instanceId: null, sessionCount: 0, lastSessionAt: null, memory: null, config: avatar === undefined ? { model: "m1" } : { model: "m1", avatar } });
let serve: Record<string, unknown> = {};
let vite: ViteDevServer;
let unregister: () => void;
let View: Component;

before(async () => {
  vite = await createServer({
    configFile: false, envFile: false, plugins: [vue()],
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: { get: async (url: string) => ({ data: { code: 0, data: serve[url] ?? null } }) },
    isInShell: () => false, useEmbeddedAuthorization: () => ({ permissions: { value: [] }, can: () => false }),
  } as any);
  // Same runtime-config path the app uses (validated, https-only storage origin).
  const rc = await vite.ssrLoadModule("/src/runtimeConfig.ts");
  const config = runtimeFixture();
  STORAGE = config.VITE_STORAGE_URL;
  await rc.loadRuntimeConfig(config.VITE_CORE_WEB_URL, (async () => new Response(JSON.stringify(config))) as typeof fetch);
  assert.equal(rc.configValue("VITE_STORAGE_URL"), STORAGE);
  View = withTemplate((await vite.ssrLoadModule("/src/addons/conversation/views/AgentInstance.vue")).default, "addons/conversation/views/AgentInstance.vue");
});
after(async () => { unregister?.(); await vite.close(); });

const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
const stub = (tag: string) => ({ props: ["to"], setup: (_p: unknown, { slots }: any) => () => h(tag, slots.default?.()) });

async function mount(templateId: string) {
  const props = reactive({ templateId });
  const root = node({ tag: "root" });
  const app = renderer.createApp({ render: () => h(View, props) });
  app.use(createI18n({ legacy: false, locale: "zh", missingWarn: false, fallbackWarn: false, messages: { zh: {} } }));
  app.use(createPinia());
  app.provide(ssrContextKey, {});
  app.component("RouterLink", stub("a"));
  app.component("AgentEffective", stub("effective"));
  app.mount(root);
  await settle();
  const head = () => { const r = all(root, (n) => n.props.class === "agent-avatar"); assert.equal(r.length, 1, "one header avatar"); return r[0]; };
  const img = () => all(head(), (n) => n.tag === "img")[0];
  return { app, props, head, img };
}

describe("AgentInstance header avatar (UA-AVATAR-DETAIL-FIX-0036)", () => {
  test("uploaded storage path renders as an https image via the storage origin", async () => {
    serve = { [`${MINE}/9`]: agent(9, "/api/v1/avatars/f9") };
    const { app, img, head } = await mount("9");
    try {
      assert.ok(img(), "header shows an <img> after upload");
      assert.equal(img().props.src, `${STORAGE}/api/v1/avatars/f9`);
      assert.doesNotMatch(textOf(head()), /B/, "no initial next to the image");
    } finally { app.unmount(); }
  });

  test("no avatar, or a non-https / credentialed value: initial fallback, no <img>", async () => {
    for (const avatar of [undefined, "", "http://cdn.example.com/a.png", "https://u:p@cdn.example.com/a.png", "javascript:alert(1)"]) {
      serve = { [`${MINE}/9`]: agent(9, avatar) };
      const { app, img, head } = await mount("9");
      try {
        assert.equal(img()?.props.src, undefined, `no image for ${String(avatar)}`);
        assert.equal(textOf(head()).trim(), "B", `initial for ${String(avatar)}`);
      } finally { app.unmount(); }
    }
  });

  test("load failure falls back to the initial", async () => {
    serve = { [`${MINE}/9`]: agent(9, "/api/v1/avatars/f9") };
    const { app, img, head } = await mount("9");
    try {
      img().props.onError();
      await settle();
      assert.equal(img()?.props.src, undefined, "broken image removed");
      assert.equal(textOf(head()).trim(), "B");
    } finally { app.unmount(); }
  });

  test("switching agents never keeps the previous avatar (nor its failure)", async () => {
    serve = { [`${MINE}/9`]: agent(9, "/api/v1/avatars/f9"), [`${MINE}/12`]: agent(12), [`${MINE}/13`]: agent(13, "/api/v1/avatars/f13") };
    const { app, props, img, head } = await mount("9");
    try {
      assert.equal(img()?.props.src, `${STORAGE}/api/v1/avatars/f9`);
      props.templateId = "12";
      await settle();
      assert.equal(img()?.props.src, undefined, "agent 12 has no avatar: 9's image must not stay");
      assert.equal(textOf(head()).trim(), "B");
      props.templateId = "9";
      await settle();
      img().props.onError();
      await settle();
      assert.equal(img()?.props.src, undefined);
      props.templateId = "13";
      await settle();
      assert.equal(img()?.props.src, `${STORAGE}/api/v1/avatars/f13`, "9's load failure does not hide 13's image");
    } finally { app.unmount(); }
  });
});
