import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import { JSDOM } from "jsdom";
import { initializeRuntimeFixture } from "./fixtures/runtimeConfig.ts";
import { ZH_STRINGS } from "../src/chat-react/islandStringsZh.ts";
import { EN_STRINGS } from "../src/chat-react/islandStringsEn.ts";

// MUYU-365 exp98 W2: the media panel the user asked for (screenshot img_b1c9f3fd6990):
// a pill switches at once from a read made when the conversation mounted, a second click leaves,
// no 切回聊天, no optional parameter boxes, required choices prefilled, the first frame comes
// from the "+" attachment, and an existing conversation binds a cataloged job tool instead of "暂无".
let vite: ViteDevServer;
let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let app: typeof import("../src/chat-react/ChatApp.tsx");
let params: typeof import("../src/chat-react/workflowParams.ts");
let settings: ReturnType<typeof import("../src/chat-react/ChatApp.tsx").useSettings>;
let response: (url: string) => unknown;
let reads: string[] = [];
let writes: { url: string; body: unknown }[] = [];
let put: (url: string, body: unknown) => Promise<unknown>;
let paged: ((url: string) => Promise<unknown>) | undefined;
let post: ((url: string, body: unknown) => unknown) | undefined;
let typed: Record<string, unknown[]>;
let disposeRuntime: () => void, disposeCatalog: () => void;
const t = (key: string) => key;

// Real exp95 schemas (exp95/evidence/schema-*.json): seedream text-to-image and jimeng image-to-video.
const seedream = { model: "doubao-seedream-5-0-260128", invocation: { toolId: 807, revision: "1" }, inputSchema: { type: "object", additionalProperties: false, required: ["prompt"],
  properties: { aspect_ratio: { type: "string" }, count: { type: "string" }, prompt: { type: "string" }, quality: { type: "string" }, web_search: { type: "string" } } } };
const jimeng = { model: "jimeng_v30_1080p", invocation: { toolId: 788, revision: "5" }, inputSchema: { type: "object", additionalProperties: false, required: ["prompt", "image_url", "duration", "resolution"],
  properties: {
    aspect_ratio: { anyOf: [{ enum: ["16:9", "4:3", "1:1"], type: "string" }, { type: "null" }] },
    duration: { enum: [5, 10], type: "integer" },
    image_url: { maxLength: 142, minLength: 15, type: "string", "x-owned-image": true },
    prompt: { maxLength: 5000, minLength: 1, type: "string" },
    resolution: { enum: ["720p", "1080p"], type: "string" },
    seed: { anyOf: [{ type: "integer" }, { type: "null" }] },
  } } };
const rows = [
  { id: 807, name: "文生图", imported: true, status: "ready", mediaModel: "doubao-seedream-5-0-260128" },
  { id: 788, name: "即梦视频", imported: true, status: "ready", mediaModel: "jimeng_v30_1080p" },
];
const base = (bound: number[] | null, editable = true) => (url: string) => ({ data: url.endsWith("execution-backends") ? [{ id: "codex", default: true }]
  : /\/catalog(\?|$)/.test(url) ? rows
  : url.endsWith("/807/schema") ? seedream : url.endsWith("/788/schema") ? jimeng
  : url.endsWith("/bindings") ? { skillIds: [], toolIds: bound ?? [], editable, revision: "3", principal: "1" }
  : { id: "7", providerId: 1, model: "chat-model", executionBackend: "codex" } });

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
  params = await vite.ssrLoadModule("/src/chat-react/workflowParams.ts") as typeof params;
  const { registerPlatformRuntime } = await vite.ssrLoadModule("/src/contracts/platform-runtime.ts");
  disposeRuntime = registerPlatformRuntime({ getAccessToken: () => "fixture", getSessionVersion: () => 1, http: {
    get: async (url: string) => { reads.push(url); return paged ? paged(url) : { data: await response(url) }; },
    put: async (url: string, body: unknown) => { writes.push({ url, body }); return { data: await put(url, body) }; },
    patch: async (url: string, body: unknown) => { writes.push({ url, body }); return { data: { data: body } }; },
    post: async (url: string, body: unknown) => { writes.push({ url, body }); if (!post) throw new Error("unexpected write"); return { data: post(url, body) }; },
  } });
  const { registerModelCatalog } = await vite.ssrLoadModule("/src/contracts/model-catalog.ts");
  disposeCatalog = registerModelCatalog({
    listProviders: async () => [{ id: 1, name: "provider", isActive: true, config: { models: ["chat-model"] } }],
    listTypedModels: async (type: string) => typed[type] ?? [],
    fetchVisibleModels: async () => [],
  });
});
after(async () => { disposeCatalog?.(); disposeRuntime?.(); await vite?.close(); });

const media = (kind: string, ...models: string[]) => models.map(model => ({ providerId: 1, model, type: kind, capabilities: [], available: true }));
const setup = () => {
  reads = []; writes = [];
  typed = { chat: media("chat", "chat-model"), image: media("image", "doubao-seedream-5-0-260128"), video: media("video", "jimeng_v30_1080p") };
  put = async () => { throw new Error("unexpected bindings write"); };
  post = undefined;
};
async function mount(element: import("react").ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return { container, render: async (next: import("react").ReactNode) => React.act(async () => root.render(next)),
    close: async () => { await React.act(async () => root.unmount()); container.remove(); } };
}
const settle = async () => { for (let turn = 0; turn < 6; turn++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const pill = (container: HTMLElement, kind: string) => container.querySelector<HTMLButtonElement>(`[data-testid="mc-gen-${kind}"]`)!;
const mode = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="mc-media-mode"]');
async function type(container: HTMLElement, text: string) {
  const input = container.querySelector("textarea")!;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const chat = (id?: string) => React.createElement(app.ChatApp, { conversationId: id, t, strings: {} as never, navigate: () => {}, create: async () => { throw new Error("no create"); } });

test("a pill switches synchronously from the mount-time read: no catalog or schema request on click", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base(null);
  const view = await mount(chat());
  try {
    await settle();
    assert.ok(reads.some(url => url.includes("/catalog")), "the media read is prefetched when the conversation mounts");
    const before = reads.length;
    await React.act(async () => pill(view.container, "image").click());   // no settle: the switch must not wait
    assert.match(mode(view.container)?.textContent ?? "", /doubao-seedream-5-0-260128/);
    assert.equal(pill(view.container, "image").getAttribute("aria-pressed"), "true");
    await settle();
    assert.deepEqual(reads.slice(before), [], "a click reuses the conversation's read");
  } finally { await view.close(); }
});

test("a click before the read lands switches at once and marks the pill busy until it resolves", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const plain = base(null);
  response = async (url: string) => { if (/\/catalog(\?|$)/.test(url)) await gate; return plain(url); };
  const view = await mount(chat());
  try {
    await settle();
    await React.act(async () => pill(view.container, "video").click());
    assert.ok(mode(view.container), "mode switched without waiting for the catalog");
    assert.equal(pill(view.container, "video").getAttribute("aria-busy"), "true");
    release();
    await settle();
    assert.equal(pill(view.container, "video").getAttribute("aria-busy"), null);
    assert.match(mode(view.container)!.textContent!, /jimeng_v30_1080p/);
  } finally { release(); await view.close(); }
});

test("clicking the selected pill again returns to chat with the chat model kept; there is no 切回聊天", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base(null);
  const view = await mount(chat());
  try {
    await settle();
    await type(view.container, "草稿");
    const chatModel = view.container.querySelector('[data-testid="mc-model"]')!.textContent;
    await React.act(async () => pill(view.container, "image").click());
    assert.ok(mode(view.container));
    assert.doesNotMatch(view.container.textContent!, /returnToChat/);
    await React.act(async () => pill(view.container, "image").click());
    assert.equal(mode(view.container), null);
    assert.equal(pill(view.container, "image").getAttribute("aria-pressed"), "false");
    assert.equal(view.container.querySelector('[data-testid="mc-model"]')!.textContent, chatModel, "the chat model is kept");
    assert.equal(view.container.querySelector("textarea")!.value, "草稿");
    assert.deepEqual(writes, []);
    assert.equal("returnToChat" in ZH_STRINGS || "returnToChat" in EN_STRINGS, false);
  } finally { await view.close(); }
});

test("text-to-image shows no parameter boxes: optional fields fold away closed and the send key is ready with text", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base(null);
  const view = await mount(chat());
  try {
    await settle();
    await type(view.container, "画一只猫");
    await React.act(async () => pill(view.container, "image").click());
    const panel = mode(view.container)!;
    const visible = [...panel.querySelectorAll("input,select")].filter(control => !control.closest("details:not([open])"));
    assert.deepEqual(visible.map(control => control.outerHTML), [], "no aspect_ratio/count/quality/web_search boxes");
    const fold = panel.querySelector("details");
    if (fold) assert.equal((fold as HTMLDetailsElement).open, false, "advanced stays folded by default");
    assert.equal(view.container.querySelector<HTMLButtonElement>('[data-testid="mc-send"]')!.disabled, false);
  } finally { await view.close(); }
});

test("image-to-video: required enums are prefilled, the first frame is not a picker but the + attachment", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base(null);
  const view = await mount(chat());
  try {
    await settle();
    await type(view.container, "让画面动起来");
    await React.act(async () => pill(view.container, "video").click());
    await settle();
    const panel = mode(view.container)!;
    const selects = [...panel.querySelectorAll<HTMLSelectElement>("select")].filter(control => !control.closest("details:not([open])"));
    assert.deepEqual(selects.map(select => select.value).sort(), ["5", "720p"], "duration and resolution prefilled from the schema");
    assert.equal(panel.querySelector('[aria-label="首帧图片"]'), null, "no owned-file picker");
    assert.match(panel.textContent!, /chatReact.mediaFrameHint/);
    assert.ok(!reads.some(url => url.includes("/api/v1/files")), "no owned file listing");
    assert.equal(view.container.querySelector<HTMLButtonElement>('[data-testid="mc-send"]')!.disabled, false, "a missing frame is reported on send, not by a disabled key");
  } finally { await view.close(); }
});

test("the first composer image becomes the owned-image argument; without one the send asks for it", () => {
  const direct = { toolId: 788, schema: jimeng, prompt: "prompt" } as never;
  const frames = params.mediaFrames(direct, [{ id: "doc", name: "a.pdf", mimeType: "application/pdf" }, { id: "img_1", name: "a.png", mimeType: "image/png" }, { id: "img_2", name: "b.png", mimeType: "image/png" }]);
  assert.deepEqual(frames, { params: { image_url: "storage-image:img_1" }, used: ["img_1"] });
  const request = params.directMediaRequest(direct, { duration: "5", resolution: "720p", ...frames.params }, "动起来");
  assert.deepEqual(request.toolInvocation.arguments, { duration: 5, resolution: "720p", image_url: "storage-image:img_1", prompt: "动起来" });
  assert.deepEqual(params.mediaFrames(direct, []), { params: {}, used: [], missing: "image_url" });
  assert.deepEqual(params.mediaFrames({ toolId: 807, schema: seedream, prompt: "prompt" } as never, [{ id: "img_1", name: "a.png", mimeType: "image/png" }]), { params: {}, used: [] });
});

test("existing conversation: a cataloged but unbound job tool is bound to it, never reported as 暂无已接通的模型", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base([]);
  put = async (_url, body) => ({ data: { skillIds: [], toolIds: (body as { toolIds: number[] }).toolIds, editable: true, revision: "4", principal: "1" } });
  const view = await mount(chat("7"));
  try {
    await settle();
    assert.doesNotMatch(pill(view.container, "video").getAttribute("aria-label") ?? "", /mediaNone/);
    await React.act(async () => pill(view.container, "video").click());
    assert.ok(mode(view.container), "switches at once");
    await settle();
    assert.deepEqual(writes, [{ url: "/api/v1/addons/conversation/7/bindings", body: { toolIds: [788], revision: "3" } }]);
    assert.match(mode(view.container)!.textContent!, /jimeng_v30_1080p/);
    assert.doesNotMatch(mode(view.container)!.textContent!, /mediaUnavailable/);
  } finally { await view.close(); }
});

test("existing conversation: nothing sends while the bind is pending, and a failed bind leaves media mode", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base([]);
  let fail!: (error: Error) => void;
  put = () => new Promise((_, reject) => { fail = reject; });
  const view = await mount(chat("7"));
  try {
    await settle();
    await type(view.container, "动起来");
    await React.act(async () => pill(view.container, "video").click());
    await settle();
    assert.equal(writes.length, 1, "one bind request");
    assert.equal(view.container.querySelector<HTMLButtonElement>('[data-testid="mc-send"]')!.disabled, true, "no send before Core has the tool");
    assert.equal(pill(view.container, "video").getAttribute("aria-busy"), "true");
    await React.act(async () => fail(new Error("409")));
    await settle();
    assert.equal(mode(view.container), null, "back to chat");
    assert.equal(view.container.querySelector("textarea")!.value, "动起来", "draft kept");
    assert.equal(writes.length, 1, "no retry");
  } finally { await view.close(); }
});

// fix-media-365: a job tool this conversation cannot bind no longer closes the model; it sends through Core's media API.
test("existing conversation that cannot be edited falls back to Core media generation, never 未启用/暂无", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base([], false);
  const view = await mount(chat("7"));
  try {
    await settle();
    await React.act(async () => pill(view.container, "video").click());
    await settle();
    const panel = mode(view.container)!;
    assert.match(panel.textContent!, /jimeng_v30_1080p/);
    assert.deepEqual([...panel.querySelectorAll("select")].map(select => select.value), ["16:9", "4", "480p"], "Core's registry choices, not the unbound tool's schema");
    assert.equal(pill(view.container, "video").getAttribute("aria-label"), null);
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});

test("nothing sendable: 暂无 only when no model is listed, and upstream outages are named as such", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup();
  const plain = base(null);
  response = (url: string) => /\/catalog(\?|$)/.test(url) ? { data: [] } : plain(url);
  typed.video = [{ providerId: 1, model: "veo-3.1", type: "video", capabilities: [], available: false, unavailableReason: "upstream_offline" }];
  const view = await mount(chat());
  try {
    await settle();
    assert.equal(pill(view.container, "image").getAttribute("aria-label"), null, "an available model without a job tool is sendable");
    assert.match(pill(view.container, "video").getAttribute("aria-label") ?? "", /chatReact.mediaUpstream/);
  } finally { await view.close(); }
});

// exp101 / fix-media-365: one upstream_offline row beside available (unconnected) models closes nothing; only when
// every option is an upstream outage is the upstream named.
test("one upstream_offline row among unconnected models leaves the kind sendable; all outages name the upstream", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup();
  const plain = base(null);
  response = (url: string) => /\/catalog(\?|$)/.test(url) ? { data: [] } : plain(url);
  typed.image = [{ providerId: 1, model: "nano-banana", type: "image", capabilities: [], available: false, unavailableReason: "upstream_offline" },
    ...media("image", "doubao-seedream-5-0-260128", "seedream-4")];
  typed.video = [{ providerId: 1, model: "veo-3.1", type: "video", capabilities: [], available: false, unavailableReason: "upstream_offline" },
    { providerId: 1, model: "veo-3", type: "video", capabilities: [], available: false, unavailableReason: "capacity" }];
  const view = await mount(chat());
  try {
    await settle();
    assert.equal(pill(view.container, "image").getAttribute("aria-label"), null);
    assert.match(pill(view.container, "video").getAttribute("aria-label") ?? "", /chatReact.mediaUpstream/, "all upstream outages still name the upstream");
    await React.act(async () => pill(view.container, "image").click());
    await settle();
    assert.match(mode(view.container)!.textContent!, /doubao-seedream-5-0-260128/, "the first available model, never the offline one");
    await React.act(async () => pill(view.container, "video").click());
    assert.doesNotMatch(mode(view.container)!.textContent!, /veo/);
  } finally { await view.close(); }
});

test("catalog pages after the first are requested together, not one after another", async () => {
  const { listToolCatalogPages } = await vite.ssrLoadModule("/src/addons/conversation/api/toolCatalog.ts");
  const started: number[] = [];
  let open = 0, peak = 0;
  paged = async (url: string) => {
    const page = Number(new URL(url, "http://x").searchParams.get("page"));
    started.push(page); open++; peak = Math.max(peak, open);
    await new Promise(resolve => setTimeout(resolve, 5));
    open--;
    return { data: { page, pageSize: 100, total: 350, hasMore: page < 4, data: [{ id: page, name: `t${page}` }] } };
  };
  try {
    const result = await listToolCatalogPages();
    assert.deepEqual(result.map((row: { id: number }) => row.id), [1, 2, 3, 4]);
    assert.equal(started[0], 1);
    assert.equal(peak, 3, "pages 2-4 in flight together");
  } finally { paged = undefined; }
});

test("design: the media panel has its own styled container, not bare inputs on the hint line", () => {
  const source = readFileSync("src/chat-react/ChatApp.tsx", "utf8");
  assert.match(source, /className="mc-media-panel"/);
  const css = readFileSync("src/chat-react/chat.css", "utf8");
  assert.match(css, /\.mc-media-panel \{[^}]*border-radius/s);
  assert.match(css, /\.mc-media-fields \{[^}]*gap/s);
});

// fix-media-365: every available image/video model is pickable. A model without a ready job tool is not greyed
// ("尚未接通" is gone); it sends through Core's media generations with the registry's own parameters. Only an
// upstream-unavailable row stays greyed with its reason.
const menuItems = (container: HTMLElement, kind: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="mc-model-menu"] [data-kind="${kind}"] [role=option]`)];
const itemName = (item: HTMLElement) => item.querySelector(".mc-menu-text")!.firstChild!.textContent;
test("fix-media: only upstream-unavailable media rows are greyed; an unconnected model sends through Core media generations", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup(); response = base(null);
  typed.image = [...media("image", "doubao-seedream-5-0-260128", "gpt-image-2"), { providerId: 1, model: "nano-banana", type: "image", capabilities: [], available: false, unavailableReason: "upstream_offline" }];
  typed.video = media("video", "jimeng_v30_1080p", "MiniMax-H3");
  post = () => ({ id: 31, status: "queued", ids: [31], conversationId: 66 });
  const navigated: string[] = [];
  const view = await mount(React.createElement(app.ChatApp, { t, strings: {} as never, navigate: (path: string) => { navigated.push(path); }, create: async () => { throw new Error("no create"); } }));
  try {
    await settle();
    // design-1123 C: the upstream-unavailable row is not listed at all; nothing else is greyed.
    assert.equal(menuItems(view.container, "image").map(itemName).includes("nano-banana"), false);
    assert.deepEqual([...menuItems(view.container, "image"), ...menuItems(view.container, "video")].filter(item => item.getAttribute("aria-disabled") === "true").map(itemName), []);
    assert.doesNotMatch(view.container.textContent!, /unavailable_unwired|unavailable_no_prompt/);
    const gpt = menuItems(view.container, "image").find(item => itemName(item) === "gpt-image-2")!;
    await React.act(async () => gpt.click());
    await settle();
    const panel = mode(view.container)!;
    assert.match(panel.textContent!, /gpt-image-2/);
    assert.doesNotMatch(panel.textContent!, /mediaUnavailable/);
    assert.deepEqual([...panel.querySelectorAll("select")].map(select => select.value), ["1:1", "1"], "aspect and count start at Core's defaults");
    await type(view.container, "一只橘猫");
    const send = view.container.querySelector<HTMLButtonElement>('[data-testid="mc-send"]')!;
    assert.equal(send.disabled, false);
    await React.act(async () => send.click());
    await settle();
    assert.deepEqual(writes, [{ url: "/api/v1/addons/media/generations", body: { kind: "image", providerId: 1, model: "gpt-image-2", prompt: "一只橘猫", conversationId: 0, aspect: "1:1", count: 1 } }]);
    assert.deepEqual(navigated, ["/c/66"]);
  } finally { await view.close(); }
});

test("fix-media: a pill with no job tool for its kind still preselects the first available model; 暂无 only when nothing is listed", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  setup();
  const plain = base(null);
  response = (url: string) => /\/catalog(\?|$)/.test(url) ? { data: [] } : plain(url);
  typed.image = [];
  typed.video = [{ providerId: 1, model: "veo-3.1", type: "video", capabilities: [], available: false, unavailableReason: "upstream_offline" }, ...media("video", "MiniMax-H3")];
  const view = await mount(chat());
  try {
    await settle();
    assert.equal(pill(view.container, "video").getAttribute("aria-disabled"), "false");
    await React.act(async () => pill(view.container, "video").click());
    await settle();
    const panel = mode(view.container)!;
    assert.match(panel.textContent!, /MiniMax-H3/);
    assert.deepEqual([...panel.querySelectorAll("select")].map(select => select.value), ["16:9", "4", "480p"], "video keeps its required aspect/duration/resolution choices");
    assert.equal(pill(view.container, "image").disabled, true, "no image models: the image pill is closed");
    assert.deepEqual(writes, []);
  } finally { await view.close(); }
});
