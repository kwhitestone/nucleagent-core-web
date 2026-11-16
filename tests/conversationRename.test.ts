import assert from "node:assert/strict";
import { before, test } from "node:test";
import { JSDOM } from "jsdom";

// MUYU-410: inline rename in the conversation header (OWUI ChatItem.svelte:452-488).
// Real Vue DOM mount in jsdom; vue is imported only after the DOM globals exist.
const dom = new JSDOM("<!doctype html><body></body>");
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "KeyboardEvent", "MouseEvent", "SVGElement"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as any)[key] });
}

let vue: typeof import("vue");
let Title: import("vue").Component;
let i18n: any;
before(async () => {
  vue = await import("vue");
  const { createI18n } = await import("vue-i18n");
  const { loadComponent } = await import("./vueComponentHarness.ts");
  i18n = createI18n({ legacy: false, locale: "en", messages: { en: { common: { untitled: "Untitled" }, conversation: { rename: { label: "Rename" } } } } });
  Title = loadComponent(new URL("../src/addons/conversation/components/ConversationTitle.vue", import.meta.url));
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function mount(props: Record<string, unknown>) {
  const host = document.createElement("div");
  document.body.append(host);
  const app = vue.createApp(Title, props);
  app.use(i18n);
  app.mount(host);
  return { host, unmount: () => { app.unmount(); host.remove(); } };
}
const key = (el: Element, k: string, extra: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }));
const strong = (host: Element) => host.querySelector("[data-testid=conv-title]")!;
const input = (host: Element) => host.querySelector<HTMLInputElement>("[data-testid=conv-title-input]");

test("double-click edits, Enter saves trimmed title once and shows it", async () => {
  const saved: string[] = [];
  const { host, unmount } = mount({ title: "auto first line", save: async (t: string) => { saved.push(t); } });
  strong(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await vue.nextTick();
  const field = input(host)!;
  assert.equal(field.value, "auto first line");
  assert.equal(document.activeElement, field);
  assert.equal(field.maxLength, 80);
  field.value = "  季度报告  ";
  field.dispatchEvent(new Event("input"));
  key(field, "Enter");
  field.dispatchEvent(new Event("blur")); // blur after Enter must not save twice
  await flush();
  assert.deepEqual(saved, ["季度报告"]);
  assert.equal(input(host), null);
  assert.equal(strong(host).textContent, "季度报告");
  unmount();
});

test("Escape, blank, unchanged and IME-composing Enter never save", async () => {
  const saved: string[] = [];
  const { host, unmount } = mount({ title: "keep", save: async (t: string) => { saved.push(t); } });
  for (const [value, finish] of [["new", "Escape"], ["   ", "Enter"], ["keep", "Enter"]] as const) {
    strong(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vue.nextTick();
    const field = input(host)!;
    field.value = value;
    field.dispatchEvent(new Event("input"));
    key(field, finish);
    await flush();
    assert.equal(input(host), null, `${finish} closes editor`);
  }
  strong(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await vue.nextTick();
  const field = input(host)!;
  field.value = "拼音";
  field.dispatchEvent(new Event("input"));
  key(field, "Enter", { isComposing: true });
  await flush();
  assert.ok(input(host), "composing Enter keeps editing");
  assert.deepEqual(saved, []);
  assert.equal(strong(host)?.textContent ?? "keep", "keep");
  unmount();
});

test("failed save restores the previous title", async () => {
  const { host, unmount } = mount({ title: "old", save: async () => { throw new Error("500"); } });
  strong(host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await vue.nextTick();
  const field = input(host)!;
  field.value = "new";
  field.dispatchEvent(new Event("input"));
  field.dispatchEvent(new Event("blur"));
  await flush();
  assert.equal(strong(host).textContent, "old");
  unmount();
});

test("store.rename PATCHes only the title, patches the listed row, and leaves it on failure", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  const calls: Array<[string, unknown]> = [];
  let fail = false;
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  const unregister = registerPlatformRuntime({
    http: {
      get: async () => ({ data: { code: 0, data: [{ id: 5, title: "auto", status: "completed" }], hasMore: false } }),
      patch: async (path: string, body: { title: string }) => {
        calls.push([path, body]);
        if (fail) throw new Error("500");
        return { data: { code: 0, data: { id: 5, title: body.title.trim(), status: "completed" } } };
      },
    },
    getAccessToken: () => "t", getSessionVersion: () => 1,
  });
  try {
    const { createPinia } = await vite.ssrLoadModule("pinia");
    const { useConversationStore } = await vite.ssrLoadModule("/src/addons/conversation/store/conversation.ts");
    const store = useConversationStore(createPinia());
    await store.load(true);
    await store.rename(5, "新名");
    assert.deepEqual(calls, [["/api/v1/addons/conversation/5", { title: "新名" }]]);
    assert.equal(store.conversations[0].title, "新名");
    fail = true;
    await assert.rejects(store.rename(5, "坏"));
    assert.equal(store.conversations[0].title, "新名");
  } finally { unregister(); await vite.close(); }
});
