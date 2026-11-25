// MUYU-365 exp85: a tool in the composer is an authorization for the agent, not a user-filled form.
// Picking it only adds its id to the conversation's tool set (POST /conversation toolIds, or the session
// bindings PUT); the model derives and passes every argument. Native STT/TTS keep their material picker.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";

let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let response: (url: string) => unknown;
let reads: string[] = [];
let writes: { method: string; url: string; body: unknown }[] = [];
let disposeRuntime: () => void;
let disposeCatalog: () => void;
let SESSION_CHANGE_EVENT: string;
const t = (key: string) => key;

const catalog = [
  { id: 37, name: "飞书读取文档", imported: true, status: "ready" },
  { id: 38, name: "网页搜索", imported: true, status: "ready" },
  { id: 39, name: "暂停中", imported: true, status: "held" },
  { id: 9, name: "图片", imported: true, status: "ready", mediaModel: "image-model" },
  { id: 72, name: "语音转写", imported: false, status: "ready", nativeCapability: "nucleagent.audio.stt.v1", nativeModel: "whisper-1" },
];
let bindings = { skillIds: [3], toolIds: [38], editable: true, revision: "1", principal: "11" };
const base = (url: string) => ({ data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
  : /\/tool\/catalog(\?|$)/.test(url) ? catalog
  : url.endsWith("/bindings") ? bindings
  : url.endsWith("model-selection") ? { executionBackend: "codex", providerId: 1, model: "chat-model", resolved: true }
  : url.endsWith("model-preferences") ? { profileId: "", effort: "" }
  : url.endsWith("model-profiles") ? []
  : /\/api\/v1\/files\?/.test(url) ? { owner: "user:11", items: [], hasMore: false }
  : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex", status: "completed" } });

before(async () => {
  const dom = new JSDOM("", { url: "https://test.example/" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, MutationObserver: dom.window.MutationObserver, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame: (run: () => void) => setTimeout(run, 0), cancelAnimationFrame: clearTimeout });
  vite = await createServer({ appType: "custom", optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
  await initializeRuntimeFixture(vite);
  React = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  app = await vite.ssrLoadModule("/src/chat-react/ChatApp.tsx") as typeof app;
  const runtime = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  SESSION_CHANGE_EVENT = runtime.SESSION_CHANGE_EVENT;
  disposeRuntime = runtime.registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string) => { reads.push(url); return { data: response(url) }; },
    put: async (url: string, body: { toolIds: number[] }) => {
      writes.push({ method: "PUT", url, body });
      // Core refuses any id that is gone or not selectable (svc/tool_binding.go validateToolIDs), never loosened.
      if (body.toolIds.some((id) => !catalog.some((tool) => tool.id === id && tool.status === "ready"))) throw Object.assign(new Error("invalid tool: 工具不存在或不可选"), { status: 400 });
      bindings = { ...bindings, toolIds: body.toolIds, revision: String(Number(bindings.revision) + 1) };
      return { data: { data: bindings } };
    },
    post: async (url: string, body: unknown) => {
      writes.push({ method: "POST", url, body });
      if (url.endsWith("/bindings/sync")) return { data: { data: bindings } };
      throw new Error("unexpected write");
    },
    patch: async (url: string, body: unknown) => { writes.push({ method: "PATCH", url, body }); throw new Error("unexpected write"); },
  } });
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = registerModelCatalog({
    listProviders: async () => [{ id: 1, name: "provider", isActive: true, config: { models: ["chat-model"] } }],
    listTypedModels: async (type: string) => ["chat", "image", "video"].includes(type) ? [{ providerId: 1, model: `${type}-model`, type, capabilities: [] }] : [],
    fetchVisibleModels: async () => [],
  });
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); });

const settle = async () => { for (let turn = 0; turn < 6; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
async function mount(conversationId?: string) {
  reads = []; writes = []; response = base;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const created: Record<string, unknown>[] = [];
  const render = (id?: string) => React.act(async () => root.render(React.createElement(app.ChatApp, { t, strings: {} as never, conversationId: id,
    navigate: () => {}, create: async (payload: Record<string, unknown>) => { created.push(payload); return { id: "55" } as never; } } as never)));
  await render(conversationId);
  await settle();
  const q = <E extends Element = HTMLElement>(selector: string) => container.querySelector<E & HTMLElement>(selector);
  const more = () => q<HTMLButtonElement>('[aria-label="chatReact.addTools"]')!;
  const grant = (name: string) => [...container.querySelectorAll<HTMLButtonElement>(".mc-tools-panel [aria-pressed]")].find((b) => b.textContent?.includes(name));
  return {
    container, created, q, more, grant, render,
    openTools: async () => {
      await React.act(async () => more().click());
      const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.getAttribute("aria-label") === "chatReact.toolGrant");
      assert.ok(item, "tool entry in the + menu");
      await React.act(async () => item.click());
      await settle();
    },
    click: async (button: HTMLElement | null | undefined) => { assert.ok(button); await React.act(async () => button.click()); await settle(); },
    type: async (text: string) => {
      const input = q<HTMLTextAreaElement>("textarea")!;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
    chips: () => [...container.querySelectorAll<HTMLElement>('[data-testid="mc-tool-grants"] .mc-chip')].map((chip) => chip.textContent),
    close: async () => { await React.act(async () => root.unmount()); container.remove(); },
  };
}

test("picking a tool only enables it: no schema read, no parameter field, no run button; the chip is visible and removable", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await mount();
  try {
    await view.type("读一下这个飞书文档并总结");
    await view.openTools();
    const panel = view.q(".mc-tools-panel")!;
    assert.ok(panel && !panel.hidden);
    // Selectable chat tools only: held and media job tools are not offered as grants.
    assert.ok(view.grant("飞书读取文档"));
    assert.ok(view.grant("网页搜索"));
    assert.equal(view.grant("暂停中"), undefined);
    assert.ok(view.grant("图片"));
    assert.equal(document.activeElement, view.grant("飞书读取文档"), "focus moves to the first tool");
    // MUYU-365 exp98: media job schemas are prefetched when the conversation mounts; enabling a grant adds none.
    const before = reads.length;
    await view.click(view.grant("飞书读取文档"));
    assert.equal(view.grant("飞书读取文档")!.getAttribute("aria-pressed"), "true");
    assert.equal(reads.slice(before).filter((url) => url.includes("/schema")).length, 0, "enabling never loads a parameter schema");
    assert.equal(panel.querySelectorAll("input:not([type=checkbox]):not([type=search]), textarea").length, 0, "no parameter inputs");
    assert.doesNotMatch(view.container.textContent!, /document_id|workflowHint|workflowExecutionModel/);
    assert.equal(panel.querySelector(".mc-grants form, .mc-grants input, .mc-grants select"), null, "the grant list has no form");
    assert.equal(panel.querySelector<HTMLDetailsElement>("details.mc-workflow")!.open, false, "native audio stays folded under its own entry");
    assert.deepEqual(view.chips(), ["飞书读取文档"]);
    assert.equal(view.q('[data-testid="mc-tool-grants"] .mc-grants-label')!.textContent, "chatReact.toolGrantsEnabled", "visible label: 已启用工具：");
    assert.equal(view.q<HTMLTextAreaElement>("textarea")!.value, "读一下这个飞书文档并总结", "draft kept");
    // Remove one chip: gone, and focus goes back to the input.
    await view.click(view.q('[data-testid="mc-tool-grants"] [aria-label="common.disable"]'));
    assert.deepEqual(view.chips(), []);
    assert.equal(document.activeElement, view.q("textarea"));
    assert.deepEqual(writes, [], "a new chat writes nothing until it is sent");
  } finally { await view.close(); }
});

test("a new chat sends the enabled set as toolIds with the user's words only; nothing enabled keeps today's body", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await mount();
  try {
    await view.type("总结文档 ABC");
    await React.act(async () => view.q<HTMLButtonElement>('[data-testid="mc-send"]')!.click());
    await settle();
    assert.equal(view.created.length, 1);
    assert.equal("toolIds" in view.created[0], false, "no grants: request body unchanged");
    assert.equal("toolInvocation" in view.created[0], false);

    await view.openTools();
    await view.click(view.grant("图片"));
    await view.click(view.grant("网页搜索"));
    await view.click(view.grant("网页搜索"));
    await view.type("总结文档 ABC");
    await React.act(async () => view.q<HTMLButtonElement>('[data-testid="mc-send"]')!.click());
    await settle();
    assert.equal(view.created.length, 2);
    assert.deepEqual(view.created[1].toolIds, [9]);
    assert.equal(view.created[1].input, "总结文档 ABC");
    assert.equal("toolInvocation" in view.created[1], false, "the model passes the arguments, never the form");
    assert.equal("arguments" in view.created[1], false);
  } finally { await view.close(); }
});

test("an existing conversation reads and writes its bindings; revoke keeps every other bound id", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  bindings = { skillIds: [3], toolIds: [38, 9], editable: true, revision: "1", principal: "11" };
  const view = await mount("7");
  try {
    assert.deepEqual(view.chips(), ["网页搜索", "图片"]);
    await view.openTools();
    assert.equal(view.grant("网页搜索")!.getAttribute("aria-pressed"), "true");
    await view.click(view.grant("飞书读取文档"));
    const puts = writes.filter((w) => w.method === "PUT");
    assert.equal(puts.length, 1);
    assert.match(puts[0].url, /\/conversation\/7\/bindings$/);
    assert.deepEqual(puts[0].body, { toolIds: [38, 9, 37], revision: "1" }, "only toolIds + revision; skills untouched");
    assert.deepEqual(view.chips(), ["飞书读取文档", "网页搜索", "图片"], "catalog order");
    const chip = [...view.container.querySelectorAll('[data-testid="mc-tool-grants"] .mc-chip')].find((c) => c.textContent === "网页搜索");
    await view.click(chip?.querySelector<HTMLElement>('[aria-label="common.disable"]'));
    assert.deepEqual(writes.filter((w) => w.method === "PUT")[1].body, { toolIds: [9, 37], revision: "2" }, "every other still valid id is kept");
    assert.deepEqual(view.chips(), ["飞书读取文档", "图片"]);
  } finally { await view.close(); bindings = { skillIds: [3], toolIds: [38], editable: true, revision: "1", principal: "11" }; }
});

// MUYU-365 TEST 1280 conversation 1530: its bound tool 790 became unpickable; the save resent it and Core said 400.
test("a conversation whose bound tool is gone or paused saves only the valid set, says how many were removed, and keeps it on reload", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  bindings = { skillIds: [], toolIds: [38, 39, 501], editable: true, revision: "1", principal: "11" };
  const view = await mount("7");
  try {
    assert.deepEqual(view.chips(), ["网页搜索"], "paused (39) and missing (501) tools are not shown");
    await view.openTools();
    await view.click(view.grant("飞书读取文档"));
    const puts = writes.filter((w) => w.method === "PUT");
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].body, { toolIds: [38, 37], revision: "1" }, "stale ids dropped, the valid bound 38 kept");
    assert.doesNotMatch(document.body.textContent!, /common\.bindingsSaveFailed/);
    assert.match(document.body.textContent!, /chatReact\.staleRemoved/, "one plain-words note about the removed tools");
    assert.deepEqual(view.chips(), ["飞书读取文档", "网页搜索"]);
  } finally { await view.close(); }
  const again = await mount("7");
  try {
    assert.deepEqual(bindings.toolIds, [38, 37]);
    assert.deepEqual(again.chips(), ["飞书读取文档", "网页搜索"], "the new pick survives a reload");
  } finally { await again.close(); bindings = { skillIds: [3], toolIds: [38], editable: true, revision: "1", principal: "11" }; }
});

test("a non-editable conversation shows its tools read-only and never writes", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  bindings = { skillIds: [], toolIds: [38], editable: false, revision: "4", principal: "11" };
  const view = await mount("7");
  try {
    assert.deepEqual(view.chips(), ["网页搜索"]);
    assert.equal(view.q('[data-testid="mc-tool-grants"] [aria-label="common.disable"]'), null);
    await view.openTools();
    assert.equal(view.grant("飞书读取文档")!.disabled, true);
    assert.deepEqual(writes.filter((w) => w.method === "PUT"), []);
  } finally { await view.close(); bindings = { skillIds: [3], toolIds: [38], editable: true, revision: "1", principal: "11" }; }
});

test("native STT keeps its own audio file picker; keyboard close restores focus; session change clears grants", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  const view = await mount();
  try {
    await view.type("草稿");
    await view.openTools();
    assert.ok(view.q(".mc-tools-panel details.mc-workflow"), "native audio form stays available");
    assert.equal(view.grant("语音转写"), undefined, "native audio is user material, not a grant");
    await view.click(view.grant("网页搜索"));
    await React.act(async () => view.grant("网页搜索")!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(view.q(".mc-tools-panel")!.hidden, true);
    assert.equal(document.activeElement, view.more());
    assert.deepEqual(view.chips(), ["网页搜索"]);
    assert.equal(view.q<HTMLTextAreaElement>("textarea")!.value, "草稿");
    await React.act(async () => window.dispatchEvent(new window.Event(SESSION_CHANGE_EVENT)));
    await settle();
    assert.deepEqual(view.chips(), []);
  } finally { await view.close(); }
});
