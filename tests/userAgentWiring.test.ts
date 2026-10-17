// UA-RELEASE-NOW (UA-FINAL-REVIEW-1921 N-1): the merge-conflict wiring between AgentList and AgentCard.
// Real AgentList + AgentCard (script setup + their own templates compiled at runtime), a tiny tree renderer instead of DOM,
// so clicks and the file input go through the real props/emits in BOTH groups (enabled and disabled).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { compile, createRenderer, getCurrentInstance, h, nextTick, ssrContextKey, type Component } from "vue";
import { parse } from "vue/compiler-sfc";
import { createI18n } from "vue-i18n";
import { routeLocationKey, routerKey } from "vue-router";
import { createServer, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";

type N = { tag?: string; text?: string; props: Record<string, any>; children: N[]; parent: N | null };
const node = (o: Partial<N>): N => ({ props: {}, children: [], parent: null, ...o });
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
const byId = (root: N, id: string) => all(root, (n) => n.props["data-testid"] === id);
const one = (root: N, id: string) => { const r = byId(root, id); assert.equal(r.length, 1, `exactly one ${id}`); return r[0]; };
const textOf = (n: N): string => (n.text ?? "") + n.children.map(textOf).join("");

const withTemplate = (comp: any, file: string) => {
  const tpl = parse(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).descriptor.template!.content;
  const render = compile(tpl) as any;
  // <script setup> bindings are not on the runtime-compiled proxy; resolve template identifiers in setupState first.
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

let vite: ViteDevServer;
let unregister: () => void;
let zh: any;
let List: Component;
let Card: Component;
const calls: { method: string; url: string; body?: unknown }[] = [];
const toasts: string[] = [];
let serve: Record<string, unknown> = {};
let adminMode = false; // UA-EDIT-PERM-1110: same file drives admin and ordinary-user renders
let query: Record<string, string> = {};
const replaced: unknown[] = [];
const fakeHttp = Object.fromEntries(["get", "post", "patch", "delete"].map((m) => [m, async (url: string, body?: unknown) => {
  calls.push({ method: m, url, body });
  const r = serve[`${m} ${url}`];
  return { data: { data: r ?? null } };
}]));

before(async () => {
  vite = await createServer({
    configFile: false, envFile: false, plugins: [vue()],
    resolve: { alias: { "@": new URL("../src", import.meta.url).pathname } },
    appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  unregister = registerPlatformRuntime({
    http: fakeHttp, isInShell: () => adminMode, useEmbeddedAuthorization: () => ({ permissions: { value: [] }, can: () => adminMode }),
  } as any);
  zh = (await vite.ssrLoadModule("/src/i18n/zh.ts")).default;
  List = withTemplate((await vite.ssrLoadModule("/src/addons/conversation/views/AgentList.vue")).default, "addons/conversation/views/AgentList.vue");
  Card = withTemplate((await vite.ssrLoadModule("/src/addons/conversation/components/AgentCard.vue")).default, "addons/conversation/components/AgentCard.vue");
  const el = () => ({ style: {}, textContent: "", remove() {}, appendChild(c: { textContent: string }) { if (c.textContent) toasts.push(c.textContent); } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
  Object.defineProperty(globalThis, "document", { configurable: true,
    value: { activeElement: null, createElement: el, body: el(), querySelector: () => null } });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({ width: 64, height: 64, close() {} }) });
});
after(async () => {
  unregister?.(); await vite.close();
  for (const k of ["window", "document", "createImageBitmap"]) Reflect.deleteProperty(globalThis, k);
});

const MINE = "/api/v1/addons/agent/mine";
const DEFS = `${MINE}/definitions`;
const card = (id: number, extra: Record<string, unknown> = {}) => ({ templateId: id, name: `a${id}`, slug: `s${id}`, description: "",
  disabled: false, instanceId: null, sessionCount: 1, lastSessionAt: null, config: { model: "m1" }, ...extra });
// System card 1 (owned:false), my enabled card 9, my disabled (used) card 12.
const routes = {
  [`get ${MINE}`]: [card(1, { owned: false }), card(9, { owned: true }), card(12, { owned: true, disabled: true })],
  [`get ${DEFS}`]: [{ id: 9, name: "a9", isActive: true }, { id: 12, name: "a12", isActive: false }],
  [`get ${MINE}/models`]: [{ model: "m1" }],
  [`patch ${DEFS}/9`]: {}, [`patch ${DEFS}/12`]: {}, [`delete ${DEFS}/9`]: {}, [`delete ${DEFS}/12`]: {},
  [`post ${DEFS}/9/avatar`]: { fileId: "f9", path: "/api/v1/avatars/f9" },
  [`post ${DEFS}/12/avatar`]: { fileId: "f12", path: "/api/v1/avatars/f12" },
};
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
const stub = (tag: string) => ({ props: ["to"], setup: (p: any, { slots }: any) => () => h(tag, { to: p.to }, slots.default?.()) });

async function mountList(opts: { admin?: boolean; query?: Record<string, string> } = {}) {
  adminMode = !!opts.admin; query = opts.query ?? {}; replaced.length = 0;
  serve = routes;
  calls.length = 0; toasts.length = 0;
  let instance: any = null;
  const root = node({ tag: "root" });
  const app = renderer.createApp({ render: () => h(List, { onVnodeMounted: (v: any) => { instance = v.component; } }) });
  app.use(createI18n({ legacy: false, locale: "zh", missingWarn: false, fallbackWarn: false, messages: { zh } }));
  app.provide(ssrContextKey, {});
  app.provide(routeLocationKey, { query } as any);
  app.provide(routerKey, { replace: async (to: unknown) => { replaced.push(to); } } as any);
  app.component("AgentCard", Card);
  app.component("RouterLink", stub("a"));
  app.component("UserAgentWizard", stub("wizard"));
  app.mount(root);
  await settle();
  const s = instance!.setupState as any;
  one(root, "agent-list-inactive-toggle").props.onClick();
  await settle();
  const cardOf = (id: number) => {
    const r = all(root, (n) => n.props["data-template-id"] === id);
    assert.equal(r.length, 1, `card ${id} rendered once`);
    return r[0];
  };
  return { app, root, s, cardOf };
}
const writes = () => calls.filter((c) => c.method !== "get").map((c) => `${c.method} ${c.url}`);
const group = (root: N, id: string) => one(root, id);

describe("AgentList ↔ AgentCard wiring in both groups (UA-FINAL-REVIEW-1921 W1–W4, W7)", () => {
  test("fixture: card 9 is in the enabled group, card 12 in the (expanded) disabled group, system card 1 enabled", async () => {
    const { app, root, s } = await mountList();
    try {
      assert.equal(s.showInactive, true);
      const ids = (g: N) => all(g, (n) => n.props["data-testid"] === "agent-card").map((n) => n.props["data-template-id"]);
      assert.deepEqual(ids(group(root, "agent-list-active")), [1, 9]);
      assert.deepEqual(ids(group(root, "agent-list-inactive")), [12]);
    } finally { app.unmount(); }
  });

  for (const [id, label, toggleBody] of [[9, "enabled", { isActive: false }], [12, "disabled", { isActive: true }]] as const) {
    test(`${label} group: my card gets :owned and edit/toggle/delete reach the list handlers`, async () => {
      const { app, s, cardOf } = await mountList();
      try {
        const c = cardOf(id);
        assert.equal(byId(c, "agent-badge-owned").length, 1, "owned badge (needs :owned)");
        one(c, "agent-own-edit").props.onClick();
        assert.equal(s.wizard?.initial?.id, id, "edit opens the wizard for this card");
        s.wizard = null;
        one(cardOf(id), "agent-own-toggle").props.onClick();
        await settle();
        assert.deepEqual(writes(), [`patch ${DEFS}/${id}`]);
        assert.deepEqual(calls.find((x) => x.method === "patch")!.body, toggleBody);
        calls.length = 0;
        one(cardOf(id), "agent-own-delete").props.onClick();
        await settle();
        assert.deepEqual(writes(), [`delete ${DEFS}/${id}`], "delete button emits remove → list deletes after confirm");
        assert.ok(toasts.includes(zh.agents.mine.deleted));
      } finally { app.unmount(); }
    });

    test(`${label} group: finished avatar upload notifies the list (config.avatar updated, success toast)`, async () => {
      const { app, s, cardOf } = await mountList();
      try {
        const input = all(one(cardOf(id), "agent-card-avatar"), (n) => n.tag === "input")[0];
        assert.ok(input, "file input rendered for my card");
        const file = new File([new Uint8Array(256)], "a.png", { type: "image/png" });
        input.props.onChange({ target: { files: [file], value: "a.png" } });
        await settle();
        assert.deepEqual(writes(), [`post ${DEFS}/${id}/avatar`]);
        assert.equal(s.agents.find((a: any) => a.templateId === id).config.avatar, `/api/v1/avatars/f${id}`, "list applied the new avatar");
        assert.ok(toasts.includes(zh.agents.avatarUpdated));
      } finally { app.unmount(); }
    });
  }

  test("system card: no owned badge, no own actions, no avatar upload", async () => {
    const { app, cardOf } = await mountList();
    try {
      const c = cardOf(1);
      for (const t of ["agent-badge-owned", "agent-own-edit", "agent-own-toggle", "agent-own-delete", "agent-card-avatar"]) {
        assert.equal(byId(c, t).length, 0, t);
      }
      assert.match(textOf(c), /a1/);
    } finally { app.unmount(); }
  });
});

// UA-EDIT-PERM-1110: editing my own agent never needs the admin console, for admins and ordinary users alike.
describe("my own agent: one edit entry, the owner wizard (UA-EDIT-PERM-1110)", () => {
  const edits = (c: N) => all(c, (n) => n.props["data-testid"] === "agent-card-edit" || n.props["data-testid"] === "agent-own-edit");
  for (const admin of [false, true]) {
    test(`${admin ? "admin" : "ordinary user"}: my cards offer only the owner edit; no link into /admin`, async () => {
      const { app, s, cardOf } = await mountList({ admin });
      try {
        for (const id of [9, 12]) {
          const c = cardOf(id);
          assert.deepEqual(edits(c).map((n) => n.props["data-testid"]), ["agent-own-edit"], `card ${id}`);
          assert.equal(all(c, (n) => String(n.props.to ?? "").startsWith("/admin")).length, 0, `card ${id} admin link`);
          one(c, "agent-own-edit").props.onClick();
          assert.equal(s.wizard?.initial?.id, id);
          s.wizard = null;
        }
        // system definition: admin keeps the admin editor, an ordinary user gets no edit at all
        const sys = edits(cardOf(1));
        assert.deepEqual(sys.map((n) => n.props.to), admin ? ["/admin/agents?edit=1"] : []);
      } finally { app.unmount(); }
    });
  }

  test("/agents?edit=<my id> opens the owner wizard once and clears the query", async () => {
    const { app, s } = await mountList({ query: { edit: "12" } });
    try {
      assert.equal(s.wizard?.initial?.id, 12);
      assert.deepEqual(replaced, [{ query: {} }]);
      assert.deepEqual(writes(), [], "opening the wizard writes nothing");
    } finally { app.unmount(); }
  });

  for (const id of ["1", "999", "x"]) {
    test(`/agents?edit=${id} (system / foreign-or-missing / junk) never opens the wizard`, async () => {
      const { app, s } = await mountList({ admin: true, query: { edit: id } });
      try {
        assert.equal(s.wizard, null);
        assert.deepEqual(writes(), []);
      } finally { app.unmount(); }
    });
  }
});
